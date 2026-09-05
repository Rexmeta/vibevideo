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
import {
  createGenerationIntent,
  type GenerationIntent,
} from './generationIntent';
import {
  createGenerationJob,
  syncGenerationJobFromRuntime,
  type GenerationJob,
} from './generationJob';

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

export interface VideoGenerationSubmission {
  runtimeJobId: GenerationCommandId;
  generationJobs: GenerationJob[];
  reused: boolean;
}

export interface VideoGenerationSubmitOptions {
  explicitRegeneration?: boolean;
}

/**
 * Runtime-neutral application port for long-running generation work.
 * Browser polling, upload replay and operation persistence stay behind this
 * boundary so consumers can later use a worker-backed adapter unchanged.
 */
export interface JobOrchestrator {
  submit(command: VideoJobCommand): GenerationCommandId;
  batch(command: VideoJobCommand): GenerationCommandId;
  submitVideoGeneration(
    command: VideoJobCommand,
    options?: VideoGenerationSubmitOptions,
  ): Promise<VideoGenerationSubmission>;
  generationSnapshot(): GenerationJob[];
  getGenerationJob(jobId: string): GenerationJob | undefined;
  findGenerationJob(projectId: string, sceneIndex: number): GenerationJob | undefined;
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
  private static readonly MAX_RETAINED_GENERATION_JOBS = 500;
  private static readonly MAX_RETAINED_RUNTIME_SNAPSHOTS = 250;
  private recoveryByUser = new Map<string, { epoch: number; promise: Promise<void> }>();
  private recoveryEpochByUser = new Map<string, number>();
  private recoveryFailures = new Map<string, Map<RecoveryStage, RecoveryFailure>>();
  private recoveryListeners = new Map<string, Set<RecoveryListener>>();
  private retryByUserStage = new Map<string, Promise<void>>();
  private generationJobsByKey = new Map<string, GenerationJob>();
  private generationJobsById = new Map<string, GenerationJob>();
  private inFlightByKey = new Map<string, Promise<VideoGenerationSubmission>>();
  private recoveredJobsByScene = new Map<string, GenerationJob>();
  private runtimeSnapshotsById = new Map<GenerationCommandId, JobState>();
  private domainSyncUnsubscribe: (() => void) | null = null;

  private ensureDomainSync(): void {
    if (this.domainSyncUnsubscribe) return;
    this.domainSyncUnsubscribe = jobManager.subscribe(runtimeJobs => {
      for (const runtime of runtimeJobs) {
        this.runtimeSnapshotsById.set(runtime.id, runtime);
        for (const domainJob of this.generationJobsById.values()) {
          if (domainJob.runtimeJobId !== runtime.id) continue;
          const updated = syncGenerationJobFromRuntime(domainJob, runtime);
          this.generationJobsById.set(updated.jobId, updated);
          this.generationJobsByKey.set(updated.idempotencyKey, updated);
          if (['completed', 'failed', 'cancelled'].includes(updated.status)) {
            const recoveredKey = this.recoveredSceneKey(updated.projectId, updated.sceneIndex);
            if (this.recoveredJobsByScene.get(recoveredKey)?.jobId === updated.jobId) {
              this.recoveredJobsByScene.delete(recoveredKey);
            }
          }
        }
      }
      this.pruneRetainedState();
    });
  }

  submit(command: VideoJobCommand): GenerationCommandId {
    const onlyIndices = command.input.onlyIndices;
    if (!onlyIndices || onlyIndices.length !== 1) {
      throw new Error('submit requires exactly one scene index');
    }
    return this.submitNow(command).runtimeJobId;
  }

  batch(command: VideoJobCommand): GenerationCommandId {
    return this.submitNow(command).runtimeJobId;
  }

  /**
   * Authoritative UI submission boundary. Locks are registered before work is
   * queued, so concurrent calls with the same key share one submission.
   */
  submitVideoGeneration(
    command: VideoJobCommand,
    options: VideoGenerationSubmitOptions = {},
  ): Promise<VideoGenerationSubmission> {
    const intents = this.createIntents(command, options);
    const existingLocks = Array.from(new Set(
      intents
        .map(({ intent }) => this.inFlightByKey.get(intent.idempotencyKey))
        .filter((lock): lock is Promise<VideoGenerationSubmission> => !!lock),
    ));
    if (existingLocks.length > 0) {
      return Promise.all(existingLocks).then(() =>
        this.submitPrepared(command, intents, options),
      );
    }

    let resolveSubmission!: (value: VideoGenerationSubmission) => void;
    let rejectSubmission!: (reason?: unknown) => void;
    const promise = new Promise<VideoGenerationSubmission>((resolve, reject) => {
      resolveSubmission = resolve;
      rejectSubmission = reject;
    });

    const lockKeys = intents
      .filter(({ intent }) => {
        const existing = this.generationJobsByKey.get(intent.idempotencyKey);
        return !existing || (existing.status === 'failed' && existing.error?.retryable === true);
      })
      .map(({ intent }) => intent.idempotencyKey);

    if (lockKeys.length === 0) {
      return Promise.resolve(this.submitPrepared(command, intents, options));
    }

    // Register every key before yielding. This is the atomic check/register
    // point for the browser runtime.
    lockKeys.forEach(key => this.inFlightByKey.set(key, promise));
    queueMicrotask(() => {
      try {
        resolveSubmission(this.submitPrepared(command, intents, options));
      } catch (error) {
        rejectSubmission(error);
      } finally {
        lockKeys.forEach(key => {
          if (this.inFlightByKey.get(key) === promise) this.inFlightByKey.delete(key);
        });
      }
    });
    return promise;
  }

  generationSnapshot(): GenerationJob[] {
    return Array.from(this.generationJobsById.values())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getGenerationJob(jobId: string): GenerationJob | undefined {
    return this.generationJobsById.get(jobId);
  }

  findGenerationJob(projectId: string, sceneIndex: number): GenerationJob | undefined {
    return this.generationSnapshot().find(job =>
      job.projectId === projectId && job.sceneIndex === sceneIndex,
    );
  }

  private createIntents(
    command: VideoJobCommand,
    options: VideoGenerationSubmitOptions,
  ): Array<{ sceneIndex: number; intent: GenerationIntent }> {
    const indices = command.input.onlyIndices || command.input.scenes.map((_, index) => index);
    const provider = command.provider || command.input.model?.provider || 'Google';
    const model = command.modelId || command.input.model?.modelId || command.input.model?.id || 'default-video';
    return indices.map(sceneIndex => {
      const scene = command.input.scenes[sceneIndex] || {};
      return {
        sceneIndex,
        intent: createGenerationIntent({
          projectId: command.input.projectId,
          sceneId: scene.id,
          sceneIndex,
          provider,
          model,
          scene,
          previousScenePrompt: sceneIndex > 0
            ? command.input.scenes[sceneIndex - 1]?.visual_prompt
            : undefined,
          aspectRatio: command.input.aspectRatio,
          characterProfile: command.input.characterProfile,
          styleSheet: command.input.styleSheet,
          negativePrompt: command.input.negativePrompt || scene.negativePrompt,
          characterReferenceImage: command.input.characterReferenceImage,
          explicitRegeneration: options.explicitRegeneration,
        }),
      };
    });
  }

  private submitPrepared(
    command: VideoJobCommand,
    intents: Array<{ sceneIndex: number; intent: GenerationIntent }>,
    options: VideoGenerationSubmitOptions = {},
  ): VideoGenerationSubmission {
    const jobs: GenerationJob[] = [];
    const submitIndices: number[] = [];
    let reused = true;

    for (const { sceneIndex, intent } of intents) {
      const recoveredKey = this.recoveredSceneKey(command.input.projectId, sceneIndex);
      const existing = this.generationJobsByKey.get(intent.idempotencyKey) ||
        (!options.explicitRegeneration
          ? this.recoveredJobsByScene.get(recoveredKey)
          : undefined);
      if (!existing) {
        const created = createGenerationJob(intent, command.id, sceneIndex);
        this.generationJobsByKey.set(intent.idempotencyKey, created);
        this.generationJobsById.set(created.jobId, created);
        jobs.push(created);
        submitIndices.push(sceneIndex);
        reused = false;
      } else if (existing.status === 'failed' && existing.error?.retryable === true) {
        const retrying: GenerationJob = {
          ...existing,
          status: 'queued',
          attempts: existing.attempts + 1,
          error: undefined,
          failedAt: undefined,
          commandId: command.id,
        };
        this.generationJobsByKey.set(intent.idempotencyKey, retrying);
        this.generationJobsById.set(retrying.jobId, retrying);
        jobs.push(retrying);
        submitIndices.push(sceneIndex);
        reused = false;
      } else {
        jobs.push(existing);
      }
    }

    let runtimeJobId = jobs.find(job => job.runtimeJobId)?.runtimeJobId;
    if (submitIndices.length > 0) {
      this.ensureDomainSync();
      const scenes = options.explicitRegeneration
        ? command.input.scenes.map((scene, index) =>
            submitIndices.includes(index)
              ? { ...scene, video_path: undefined }
              : scene,
          )
        : command.input.scenes;
      runtimeJobId = jobManager.enqueueVideoBatch({
        ...command.input,
        scenes,
        onlyIndices: submitIndices,
      });
      for (const job of jobs) {
        if (!submitIndices.includes(job.sceneIndex)) continue;
        const linked = { ...job, runtimeJobId };
        this.generationJobsByKey.set(linked.idempotencyKey, linked);
        this.generationJobsById.set(linked.jobId, linked);
        const index = jobs.findIndex(item => item.jobId === linked.jobId);
        if (index >= 0) jobs[index] = linked;
      }
    }

    if (!runtimeJobId) {
      throw new Error('Generation job is missing its runtime execution link');
    }
    this.pruneRetainedState();
    return { runtimeJobId, generationJobs: jobs, reused };
  }

  private submitNow(
    command: VideoJobCommand,
    options: VideoGenerationSubmitOptions = {},
  ): VideoGenerationSubmission {
    return this.submitPrepared(command, this.createIntents(command, options), options);
  }

  private linkRecoveredRuntime(runtimeJobId: string, runtimeSnapshot?: JobState): void {
    const runtime = runtimeSnapshot || jobManager.getJob(runtimeJobId);
    if (!runtime) return;
    this.ensureDomainSync();
    if (this.generationSnapshot().some(job => job.runtimeJobId === runtimeJobId)) return;
    for (const scene of runtime.scenes) {
      const existing = this.findGenerationJob(runtime.projectId, scene.idx);
      if (existing) {
        const relinked = syncGenerationJobFromRuntime(
          { ...existing, runtimeJobId },
          runtime,
        );
        this.generationJobsByKey.set(relinked.idempotencyKey, relinked);
        this.generationJobsById.set(relinked.jobId, relinked);
        continue;
      }
      const intent = createGenerationIntent({
        projectId: runtime.projectId,
        sceneIndex: scene.idx,
        provider: runtime.provider || 'Google',
        model: runtime.modelId || runtime.modelLabel || 'default-video',
        scene: {},
        aspectRatio: '16:9',
      });
      const created = createGenerationJob(intent, `recovery-${runtimeJobId}`, scene.idx);
      const linked = syncGenerationJobFromRuntime(
        { ...created, runtimeJobId },
        runtime,
      );
      this.generationJobsByKey.set(linked.idempotencyKey, linked);
      this.generationJobsById.set(linked.jobId, linked);
      // A fresh session cannot reconstruct every original generation input
      // from JobState alone. Conservatively lock the recovered project/scene
      // so an equivalent UI submission cannot start a second provider call.
      // Explicit regeneration intentionally bypasses this lock.
      this.recoveredJobsByScene.set(
        this.recoveredSceneKey(runtime.projectId, scene.idx),
        linked,
      );
    }
    this.runtimeSnapshotsById.set(runtimeJobId, runtime);
    this.pruneRetainedState();
  }

  private linkUnmappedRuntimeJobs(): void {
    for (const runtime of jobManager.snapshot()) {
      this.linkRecoveredRuntime(runtime.id, runtime);
    }
  }

  private recoveredSceneKey(projectId: string, sceneIndex: number): string {
    return `${projectId}:${sceneIndex}`;
  }

  private pruneRetainedState(): void {
    const terminal = new Set(['completed', 'failed', 'cancelled']);
    if (this.generationJobsById.size > BrowserJobOrchestrator.MAX_RETAINED_GENERATION_JOBS) {
      const removable = Array.from(this.generationJobsById.values())
        .filter(job => terminal.has(job.status))
        .sort((a, b) => a.createdAt - b.createdAt);
      const removeCount = this.generationJobsById.size -
        BrowserJobOrchestrator.MAX_RETAINED_GENERATION_JOBS;
      for (const job of removable.slice(0, removeCount)) {
        this.generationJobsById.delete(job.jobId);
        if (this.generationJobsByKey.get(job.idempotencyKey)?.jobId === job.jobId) {
          this.generationJobsByKey.delete(job.idempotencyKey);
        }
        const recoveredKey = this.recoveredSceneKey(job.projectId, job.sceneIndex);
        if (this.recoveredJobsByScene.get(recoveredKey)?.jobId === job.jobId) {
          this.recoveredJobsByScene.delete(recoveredKey);
        }
      }
    }
    if (this.runtimeSnapshotsById.size > BrowserJobOrchestrator.MAX_RETAINED_RUNTIME_SNAPSHOTS) {
      const linkedRuntimeIds = new Set(
        Array.from(this.generationJobsById.values())
          .map(job => job.runtimeJobId)
          .filter((id): id is string => !!id),
      );
      const removable = Array.from(this.runtimeSnapshotsById.values())
        .filter(runtime => terminal.has(runtime.status) && !linkedRuntimeIds.has(runtime.id))
        .sort((a, b) => a.updatedAt - b.updatedAt);
      const removeCount = this.runtimeSnapshotsById.size -
        BrowserJobOrchestrator.MAX_RETAINED_RUNTIME_SNAPSHOTS;
      for (const runtime of removable.slice(0, removeCount)) {
        this.runtimeSnapshotsById.delete(runtime.id);
      }
    }
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
    return jobManager.getJob(commandId) || this.runtimeSnapshotsById.get(commandId);
  }

  findByProject(projectId: string): JobState | undefined {
    return jobManager.findByProject(projectId);
  }

  waitForTerminal(
    commandId: GenerationCommandId,
    listener?: (job: JobState) => void,
  ): Promise<JobState | undefined> {
    const current = this.get(commandId);
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

  async resume(command: ResumeJobCommand): Promise<GenerationCommandId | null> {
    const runtimeJobId = await jobManager.resumeInterrupted(command);
    if (runtimeJobId) this.linkRecoveredRuntime(runtimeJobId);
    return runtimeJobId;
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
      if (stage !== 'uploads') this.linkUnmappedRuntimeJobs();
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

  async continueLongWait(command: LongWaitCommand): Promise<GenerationCommandId | null> {
    const runtimeJobId = await jobManager.continueLongWait(command);
    if (runtimeJobId) this.linkRecoveredRuntime(runtimeJobId);
    return runtimeJobId;
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