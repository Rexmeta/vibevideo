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

  resetRecovery(userId?: string): void {
    const invalidate = (id: string) => {
      this.recoveryEpochByUser.set(id, (this.recoveryEpochByUser.get(id) || 0) + 1);
    };
    if (userId) {
      invalidate(userId);
      return;
    }
    for (const id of this.recoveryByUser.keys()) invalidate(id);
  }

  private isRecoveryCurrent(userId: string, epoch: number): boolean {
    return (this.recoveryEpochByUser.get(userId) || 0) === epoch;
  }

  private async runRecovery(
    userId: string,
    cloudSyncEnabled: boolean,
    epoch: number,
  ): Promise<void> {
    try {
      await uploadQueue.resumeAll();
    } catch (error) {
      console.warn('[JobOrchestrator] upload replay failed:', error);
    }
    if (!this.isRecoveryCurrent(userId, epoch)) return;
    if (cloudSyncEnabled) {
      try {
        await jobManager.autoResumePendingOperations(userId);
      } catch (error) {
        console.warn('[JobOrchestrator] operation resume failed:', error);
      }
    }
    if (!this.isRecoveryCurrent(userId, epoch)) return;
    try {
      await jobManager.loadInterruptedFromProjects(userId);
    } catch (error) {
      console.warn('[JobOrchestrator] interrupted-state recovery failed:', error);
    }
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