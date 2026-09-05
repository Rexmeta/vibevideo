import type {
  AIModel,
  GenerationCommand,
  GenerationCommandId,
  OperationRecord,
  ProjectStats,
  Scene,
  StyleSheet,
} from '../types';
import {
  jobManager,
  type JobListener,
  type JobState,
} from './jobManager';
import {
  uploadQueue,
  type UploadEntry,
  type UploadEvent,
} from './uploadQueue';

export type { JobSceneState, JobState } from './jobManager';
export type { UploadEntry, UploadEvent } from './uploadQueue';

export interface VideoJobCallbacks {
  onSceneUpdate?: (idx: number, updates: Partial<Scene>) => void;
  onStatsDelta?: (delta: Partial<ProjectStats>) => void;
}

export interface VideoJobInput extends VideoJobCallbacks {
  projectId: string;
  projectTitle: string;
  userId: string;
  scenes: Partial<Scene>[];
  aspectRatio: '16:9' | '9:16' | '1:1' | '3:4';
  model?: AIModel;
  characterProfile?: string;
  styleSheet?: StyleSheet;
  negativePrompt?: string;
  characterReferenceImage?: string;
  contextPackId?: string;
  contextPackName?: string;
  onlyIndices?: number[];
  existingOperations?: Record<string, OperationRecord>;
}

export type VideoJobCommand = GenerationCommand<VideoJobInput> & {
  capability: 'video';
};

export interface ResumeJobCommand extends VideoJobCallbacks {
  projectId: string;
  userId: string;
  overrides?: {
    model?: AIModel;
    characterProfile?: string;
    styleSheet?: StyleSheet;
    negativePrompt?: string;
    characterReferenceImage?: string;
  };
}

export interface LongWaitCommand {
  projectId: string;
  userId: string;
  sceneIdx: number;
}

export type JobTerminalStatus = 'completed' | 'failed' | 'cancelled' | 'long-wait';
export type RecoveryStage = 'uploads' | 'operations' | 'interrupted';
export interface RecoveryFailure {
  stage: RecoveryStage;
  message: string;
  retrying: boolean;
}
export interface RecoveryState {
  userId: string;
  failures: RecoveryFailure[];
}
export type RecoveryListener = (state: RecoveryState | null) => void;

/**
 * Runtime-neutral application port for long-running generation work.
 * Browser polling, upload replay and operation persistence stay behind this
 * boundary so consumers can later use a worker-backed adapter unchanged.
 */
export interface JobOrchestrator {
  submit(command: VideoJobCommand): GenerationCommandId;
  batch(command: VideoJobCommand): GenerationCommandId;
  subscribe(listener: JobListener): () => void;
  subscribeUploads(listener: (event: UploadEvent) => void): () => void;
  snapshot(): JobState[];
  pendingUploads(): UploadEntry[];
  get(commandId: GenerationCommandId): JobState | undefined;
  findByProject(projectId: string): JobState | undefined;
  waitForTerminal(commandId: GenerationCommandId, listener?: (job: JobState) => void): Promise<JobState | undefined>;
  bind(commandId: GenerationCommandId, callbacks: VideoJobCallbacks): void;
  resume(command: ResumeJobCommand): Promise<GenerationCommandId | null>;
  resumePaused(commandId: GenerationCommandId): void;
  cancel(commandId: GenerationCommandId): void;
  pause(commandId: GenerationCommandId): void;
  recover(userId: string, cloudSyncEnabled: boolean): Promise<void>;
  subscribeRecovery(userId: string, listener: RecoveryListener): () => void;
  retryRecovery(userId: string, stage: RecoveryStage): Promise<void>;
  resetRecovery(userId?: string): void;
  continueLongWait(command: LongWaitCommand): Promise<GenerationCommandId | null>;
  abandonLongWait(projectId: string, sceneIdx: number): Promise<void>;
  retryUploads(projectId: string): void;
  clearFinished(): void;
  getConcurrency(): number;
  setConcurrency(value: number): void;
}

const terminalStatuses = new Set<JobState['status']>([
  'completed',
  'failed',
  'cancelled',
  'long-wait',
]);

export class BrowserJobOrchestrator implements JobOrchestrator {
  private recoveryByUser = new Map<string, { epoch: number; promise: Promise<void> }>();
  private recoveryEpochByUser = new Map<string, number>();
  private recoveryFailures = new Map<string, Map<RecoveryStage, RecoveryFailure>>();
  private recoveryListeners = new Map<string, Set<RecoveryListener>>();
  private retryByUserStage = new Map<string, Promise<void>>();

  submit(command: VideoJobCommand): GenerationCommandId {
    const onlyIndices = command.input.onlyIndices;
    if (!onlyIndices || onlyIndices.length !== 1) {
      throw new Error('submit requires exactly one scene index');
    }
    return jobManager.enqueueVideoBatch(command.input);
  }

  batch(command: VideoJobCommand): GenerationCommandId {
    return jobManager.enqueueVideoBatch(command.input);
  }

  subscribe(listener: JobListener): () => void {
    return jobManager.subscribe(listener);
  }

  subscribeUploads(listener: (event: UploadEvent) => void): () => void {
    return uploadQueue.subscribe(listener);
  }

  snapshot(): JobState[] {
    return jobManager.snapshot();
  }

  pendingUploads(): UploadEntry[] {
    return uploadQueue.pending();
  }

  get(commandId: GenerationCommandId): JobState | undefined {
    return jobManager.getJob(commandId);
  }

  findByProject(projectId: string): JobState | undefined {
    return jobManager.findByProject(projectId);
  }

  waitForTerminal(
    commandId: GenerationCommandId,
    listener?: (job: JobState) => void,
  ): Promise<JobState | undefined> {
    const current = jobManager.getJob(commandId);
    if (current && terminalStatuses.has(current.status)) {
      listener?.(current);
      return Promise.resolve(current);
    }
    return new Promise(resolve => {
      let cleanupRequested = false;
      let unsubscribe = () => {
        cleanupRequested = true;
      };
      const cleanup = jobManager.subscribe(jobs => {
        const job = jobs.find(item => item.id === commandId);
        if (!job) return;
        listener?.(job);
        if (terminalStatuses.has(job.status)) {
          unsubscribe();
          resolve(job);
        }
      });
      unsubscribe = cleanup;
      if (cleanupRequested) cleanup();
    });
  }

  bind(
    commandId: GenerationCommandId,
    callbacks: VideoJobCallbacks,
  ): void {
    jobManager.rebindCallbacks(commandId, callbacks);
  }

  resume(command: ResumeJobCommand): Promise<GenerationCommandId | null> {
    return jobManager.resumeInterrupted(command);
  }

  resumePaused(commandId: GenerationCommandId): void {
    jobManager.resume(commandId);
  }

  cancel(commandId: GenerationCommandId): void {
    jobManager.cancel(commandId);
  }

  pause(commandId: GenerationCommandId): void {
    jobManager.pause(commandId);
  }

  recover(userId: string, cloudSyncEnabled: boolean): Promise<void> {
    const epoch = this.recoveryEpochByUser.get(userId) || 0;
    const existing = this.recoveryByUser.get(userId);
    if (existing?.epoch === epoch) return existing.promise;
    // A same-user sign-in immediately after sign-out waits for the invalidated
    // recovery to settle before starting. This prevents overlapping operation
    // resume calls even though the legacy manager itself has no abort signal.
    const recovery = existing
      ? existing.promise
          .catch(() => {})
          .then(() => this.runRecovery(userId, cloudSyncEnabled, epoch))
      : this.runRecovery(userId, cloudSyncEnabled, epoch);
    this.recoveryByUser.set(userId, { epoch, promise: recovery });
    return recovery;
  }

  subscribeRecovery(userId: string, listener: RecoveryListener): () => void {
    const listeners = this.recoveryListeners.get(userId) || new Set<RecoveryListener>();
    listeners.add(listener);
    this.recoveryListeners.set(userId, listeners);
    listener(this.getRecoveryState(userId));
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.recoveryListeners.delete(userId);
    };
  }

  retryRecovery(userId: string, stage: RecoveryStage): Promise<void> {
    const failure = this.recoveryFailures.get(userId)?.get(stage);
    if (!failure) return Promise.resolve();
    const key = `${userId}:${stage}`;
    const existing = this.retryByUserStage.get(key);
    if (existing) return existing;
    const epoch = this.recoveryEpochByUser.get(userId) || 0;
    this.setRecoveryFailure(userId, stage, { ...failure, retrying: true }, epoch);
    const retry = this.runRecoveryStage(userId, stage, epoch)
      .finally(() => this.retryByUserStage.delete(key));
    this.retryByUserStage.set(key, retry);
    return retry;
  }

  resetRecovery(userId?: string): void {
    const invalidate = (id: string) => {
      this.recoveryEpochByUser.set(id, (this.recoveryEpochByUser.get(id) || 0) + 1);
    };
    if (userId) {
      invalidate(userId);
      this.clearRecoveryState(userId);
      return;
    }
    const ids = new Set([
      ...this.recoveryByUser.keys(),
      ...this.recoveryFailures.keys(),
      ...this.recoveryListeners.keys(),
    ]);
    for (const id of ids) {
      invalidate(id);
      this.clearRecoveryState(id);
    }
  }

  private isRecoveryCurrent(userId: string, epoch: number): boolean {
    return (this.recoveryEpochByUser.get(userId) || 0) === epoch;
  }

  private async runRecovery(
    userId: string,
    cloudSyncEnabled: boolean,
    epoch: number,
  ): Promise<void> {
    this.recoveryFailures.delete(userId);
    this.emitRecovery(userId);
    await this.runRecoveryStage(userId, 'uploads', epoch);
    if (!this.isRecoveryCurrent(userId, epoch)) return;
    if (cloudSyncEnabled) {
      await this.runRecoveryStage(userId, 'operations', epoch);
    }
    if (!this.isRecoveryCurrent(userId, epoch)) return;
    await this.runRecoveryStage(userId, 'interrupted', epoch);
  }

  private async runRecoveryStage(userId: string, stage: RecoveryStage, epoch: number): Promise<void> {
    try {
      if (stage === 'uploads') await uploadQueue.resumeAll();
      else if (stage === 'operations') await jobManager.autoResumePendingOperations(userId);
      else await jobManager.loadInterruptedFromProjects(userId);
      this.setRecoveryFailure(userId, stage, null, epoch);
    } catch (error) {
      console.warn(`[JobOrchestrator] ${stage} recovery failed:`, error);
      this.setRecoveryFailure(userId, stage, {
        stage,
        retrying: false,
        message: this.recoveryMessage(stage),
      }, epoch);
    }
  }

  private recoveryMessage(stage: RecoveryStage): string {
    if (stage === 'uploads') return '중단된 파일 업로드를 복구하지 못했습니다.';
    if (stage === 'operations') return '진행 중이던 생성 작업을 다시 연결하지 못했습니다.';
    return '중단된 작업 목록을 불러오지 못했습니다.';
  }

  private setRecoveryFailure(
    userId: string,
    stage: RecoveryStage,
    failure: RecoveryFailure | null,
    epoch: number,
  ): void {
    if (!this.isRecoveryCurrent(userId, epoch)) return;
    const failures = this.recoveryFailures.get(userId) || new Map<RecoveryStage, RecoveryFailure>();
    if (failure) failures.set(stage, failure);
    else failures.delete(stage);
    if (failures.size > 0) this.recoveryFailures.set(userId, failures);
    else this.recoveryFailures.delete(userId);
    this.emitRecovery(userId);
  }

  private getRecoveryState(userId: string): RecoveryState | null {
    const failures = this.recoveryFailures.get(userId);
    return failures?.size ? { userId, failures: Array.from(failures.values()) } : null;
  }

  private emitRecovery(userId: string): void {
    const state = this.getRecoveryState(userId);
    this.recoveryListeners.get(userId)?.forEach(listener => listener(state));
  }

  private clearRecoveryState(userId: string): void {
    this.recoveryFailures.delete(userId);
    this.emitRecovery(userId);
  }

  continueLongWait(command: LongWaitCommand): Promise<GenerationCommandId | null> {
    return jobManager.continueLongWait(command);
  }

  abandonLongWait(projectId: string, sceneIdx: number): Promise<void> {
    return jobManager.abandonLongWait(projectId, sceneIdx);
  }

  retryUploads(projectId: string): void {
    jobManager.retryUploadsNow(projectId);
  }

  clearFinished(): void {
    jobManager.clearFinished();
  }

  getConcurrency(): number {
    return jobManager.getConcurrency();
  }

  setConcurrency(value: number): void {
    jobManager.setConcurrency(value);
  }
}

export const jobOrchestrator: JobOrchestrator = new BrowserJobOrchestrator();