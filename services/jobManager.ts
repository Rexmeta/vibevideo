// Background video-batch job manager: concurrency, per-model rate
// limits, pause/resume/abort, resume-after-reload.
import {
  Scene,
  AIModel,
  StyleSheet,
  ProjectStats,
  GenerationRun,
  OperationRecord,
  Project,
  VideoMeta,
} from '../types';
import { runVideoGeneration } from './generationCommands';
import { normalizeGenerationError, throwGenerationFailure } from './generationContract';
import type { GenerationError } from '../types';
import {
  getProjectFromCloud,
  getAllProjectsFromCloud,
  listProjectsWithActiveGenerationRun,
  updateProjectFields,
  updateProjectGenerationRun,
  sanitizeSceneFieldForFirestore,
  sceneMapKey,
} from './storageService';
import { saveMedia } from './mediaCache';
import { listPacks } from './contextPackService';
import { uploadQueue } from './uploadQueue';
import { getVideoPricePerCallUsd } from './pricing';

// Zero-padded 2-digit scene index used as the map key for both
// generation_run.operations and saved_scenes_map. Re-export of
// storageService.sceneMapKey so call-sites stay terse.
const opKey = sceneMapKey;

export type JobStage = 'video';
export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'long-wait';

export interface JobSceneState {
  idx: number;
  // 'long-wait' = Veo poll exceeded the 30-min budget but the operation
  //               is still being tracked; the user can wait or abandon.
  // 'uploading' = clip generated, durable upload queue is retrying.
  status:
    | 'pending'
    | 'running'
    | 'done'
    | 'failed'
    | 'long-wait'
    | 'uploading';
  error?: string;
  generationError?: GenerationError;
  durationMs?: number;
  // Veo long-running operation handle, persisted as soon as submit
  // returns. Surfaced in the dock so a tab close + reopen keeps polling.
  operationName?: string;
  pollAttempts?: number;
  // Set after a fresh session picked up a previously-submitted operation.
  resumed?: boolean;
  uploadAttempts?: number;
  uploadEntryId?: string;
}

export interface JobState {
  id: string;
  projectId: string;
  projectTitle: string;
  userId: string;
  stage: JobStage;
  status: JobStatus;
  total: number;
  completed: number;
  failed: number;
  modelLabel: string;
  modelId?: string;
  provider?: string;
  scenes: JobSceneState[];
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  lastError?: string;
  contextPackId?: string;
  contextPackName?: string;
}

export type JobListener = (jobs: JobState[]) => void;

const CONCURRENCY_KEY = 'vibe_job_concurrency';
const PROCESSED_INTERRUPT_KEY = 'vibe_job_interrupt_marked';

const clampConcurrency = (n: number): number => Math.max(1, Math.min(3, Math.round(n)));

interface PauseHandle {
  promise: Promise<void>;
  resolve: () => void;
}

class JobManager {
  private jobs: Map<string, JobState> = new Map();
  private listeners: Set<JobListener> = new Set();
  private abortControllers: Map<string, AbortController> = new Map();
  private pauseHandles: Map<string, PauseHandle> = new Map();
  private pausedFromQueued: Map<string, boolean> = new Map();
  private runningCount = 0;
  private concurrency = 2;

  private workSpecs: Map<
    string,
    {
      scenes: Partial<Scene>[];
      aspectRatio: '16:9' | '9:16' | '1:1' | '3:4';
      model?: AIModel;
      characterProfile?: string;
      styleSheet?: StyleSheet;
      negativePrompt?: string;
      characterReferenceImage?: string;
      onSceneUpdate?: (idx: number, updates: Partial<Scene>) => void;
      onStatsDelta?: (delta: Partial<ProjectStats>) => void;
      // Pre-loaded operations (keyed by zero-padded scene index) for
      // resumed runs. The job's per-scene loop checks here before
      // calling generateSceneVideo and skips submit when present.
      existingOperations?: Record<string, OperationRecord>;
    }
  > = new Map();

  // Map an upload-queue entry id back to (jobId, sceneIdx) so the queue's
  // success/failure events can flip per-scene state in the dock.
  private uploadEntryIndex: Map<string, { jobId: string; sceneIdx: number }> = new Map();
  private uploadUnsub: (() => void) | null = null;

  private rateBudget: Map<string, { tokensPerMinute: number; recent: number[] }> =
    new Map();

  constructor() {
    try {
      const saved = localStorage.getItem(CONCURRENCY_KEY);
      if (saved) this.concurrency = clampConcurrency(parseInt(saved, 10));
    } catch {}
    // Subscribe to upload queue once: when a previously-failed upload
    // eventually succeeds, flip the matching scene from blob: URL to the
    // final https URL so the wizard sees a stable "uploaded" state.
    this.uploadUnsub = uploadQueue.subscribe(e => this.onUploadEvent(e));
  }

  private onUploadEvent(e: import('./uploadQueue').UploadEvent) {
    const link = this.uploadEntryIndex.get(e.id);
    if (!link) {
      // Resumed entry from a previous session: still patch the scene
      // map so the dock badge clears next time the project is opened.
      if (e.status === 'done' && e.finalUrl) {
        // (uploadQueue itself patches saved_scenes_map fields; nothing to do.)
      }
      return;
    }
    const { jobId, sceneIdx } = link;
    const job = this.jobs.get(jobId);
    const spec = this.workSpecs.get(jobId);
    if (!job || !spec) return;
    const sState = job.scenes.find(s => s.idx === sceneIdx);
    if (!sState) return;
    sState.uploadAttempts = e.attempts;
    if (e.status === 'done') {
      this.uploadEntryIndex.delete(e.id);
      sState.status = 'done';
      const updates: Partial<Scene> = {
        video_path: e.finalUrl,
        video_meta: {
          ...(spec.scenes[sceneIdx]?.video_meta || {}),
          uploadStatus: 'ok',
          uploadAttempts: e.attempts,
        },
      };
      spec.scenes[sceneIdx] = { ...(spec.scenes[sceneIdx] || {}), ...updates };
      try { spec.onSceneUpdate?.(sceneIdx, updates); } catch {}
      this.persistSceneUpdate(job, sceneIdx, updates).catch(() => {});
      this.recomputeJobStatus(jobId);
    } else if (e.status === 'failed') {
      const generationError = e.generationError || normalizeGenerationError(e.error, {
        provider: 'Firebase',
        operation: e.id,
        kind: 'upload',
      });
      sState.error = generationError.message;
      sState.generationError = generationError;
      if (!generationError.retryable) {
        sState.status = 'failed';
        job.completed = Math.max(0, job.completed - 1);
        job.failed += 1;
        this.uploadEntryIndex.delete(e.id);
      }
      const updates: Partial<Scene> = {
        video_meta: {
          ...(spec.scenes[sceneIdx]?.video_meta || {}),
          uploadStatus: generationError.retryable ? 'pending-upload' : 'upload-failed',
          uploadAttempts: e.attempts,
          uploadLastError: generationError.message,
        },
      };
      spec.scenes[sceneIdx] = { ...(spec.scenes[sceneIdx] || {}), ...updates };
      try { spec.onSceneUpdate?.(sceneIdx, updates); } catch {}
      if (!generationError.retryable) {
        this.persistSceneUpdate(job, sceneIdx, updates).catch(() => {});
        this.recomputeJobStatus(jobId);
      }
    }
    job.updatedAt = Date.now();
    this.emit();
  }

  // Re-evaluate a job's terminal status after an async event (upload done,
  // long-wait flip). If everything settled, mark completed; if any
  // long-wait remain, keep 'long-wait' status.
  private recomputeJobStatus(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status === 'cancelled' || job.status === 'failed' || job.status === 'paused') return;
    const stillUploading = job.scenes.some(s => s.status === 'uploading');
    const stillRunning = job.scenes.some(s => s.status === 'running' || s.status === 'pending');
    const longWaiting = job.scenes.some(s => s.status === 'long-wait');
    if (stillRunning || stillUploading) return;
    let persistedStatus: GenerationRun['status'] | null = null;
    if (longWaiting) {
      job.status = 'long-wait';
      persistedStatus = 'long-wait';
    } else if (job.completed === job.total) {
      job.status = 'completed';
      persistedStatus = 'completed';
    } else if (job.failed > 0) {
      job.status = 'failed';
      persistedStatus = 'failed';
    }
    job.endedAt = Date.now();
    // Mirror the terminal flip into Firestore so reload/other devices
    // don't see a stale 'running' run after async uploads settle
    // (task #83 acceptance: clear status visibility, no phantom runs).
    if (persistedStatus) {
      this.persistRun(job, persistedStatus).catch(e =>
        console.warn('[JobManager] recomputeJobStatus persistRun failed:', e)
      );
    }
    this.emit();
  }

  // ---------- Subscriptions ----------
  subscribe(fn: JobListener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    const snap = this.snapshot();
    this.listeners.forEach(l => {
      try {
        l(snap);
      } catch (e) {
        console.warn('[JobManager] listener error:', e);
      }
    });
  }

  snapshot(): JobState[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  getJob(id: string): JobState | undefined {
    return this.jobs.get(id);
  }


  findByProject(projectId: string): JobState | undefined {
    let latest: JobState | undefined;
    for (const j of this.jobs.values()) {
      if (j.projectId !== projectId) continue;
      if (!latest || j.startedAt > latest.startedAt) latest = j;
    }
    return latest;
  }

  // ---------- Concurrency ----------
  getConcurrency(): number {
    return this.concurrency;
  }

  setConcurrency(n: number) {
    this.concurrency = clampConcurrency(n);
    try {
      localStorage.setItem(CONCURRENCY_KEY, String(this.concurrency));
    } catch {}

    this.tryDispatch();
  }

  // ---------- Per-model rate limit ----------
  /**
   * Configure the per-model rate budget. Defaults to 1/min.
   */
  setRate(modelKey: string, tokensPerMinute: number) {
    const existing = this.rateBudget.get(modelKey);
    this.rateBudget.set(modelKey, {
      tokensPerMinute,
      recent: existing?.recent || [],
    });
  }

  /** Public: block until a rate-limit token is available for the given model. */
  async acquireRateToken(modelKey: string, signal?: AbortSignal): Promise<void> {
    return this.waitForToken(modelKey, signal);
  }

  private async waitForToken(modelKey: string, signal?: AbortSignal): Promise<void> {
    const ensure = () => {
      let bucket = this.rateBudget.get(modelKey);
      if (!bucket) {
        bucket = { tokensPerMinute: 1, recent: [] };
        this.rateBudget.set(modelKey, bucket);
      }
      return bucket;
    };
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const bucket = ensure();
      const now = Date.now();

      bucket.recent = bucket.recent.filter(t => now - t < 60_000);
      if (bucket.recent.length < bucket.tokensPerMinute) {
        bucket.recent.push(now);
        return;
      }
      // Wake periodically so the abort signal can interrupt us.
      const oldest = bucket.recent[0];
      const waitMs = Math.max(500, 60_000 - (now - oldest) + 250);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, Math.min(1000, waitMs));
        const onAbort = () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

  // ---------- Job lifecycle ----------
  enqueueVideoBatch(opts: {
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
    onSceneUpdate?: (idx: number, updates: Partial<Scene>) => void;
    onStatsDelta?: (delta: Partial<ProjectStats>) => void;
    // Pre-loaded Veo operations from a persisted generation_run, keyed
    // by zero-padded scene index. Scenes with an entry here skip the
    // submit phase and resume polling.
    existingOperations?: Record<string, OperationRecord>;
  }): string {
    const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const candidateIdxs: number[] = [];
    opts.scenes.forEach((s, i) => {
      const inFilter = !opts.onlyIndices || opts.onlyIndices.includes(i);
      if (!inFilter) return;
      if (s.video_path && s.video_path.startsWith('http')) return;
      // Skip scenes whose clip has already been generated and is only
      // waiting on the durable upload queue — re-running Veo here would
      // duplicate cost and clobber the pending upload.
      if (s.video_meta?.uploadStatus === 'pending-upload') return;
      candidateIdxs.push(i);
    });

    const sceneStates: JobSceneState[] = candidateIdxs.map(i => {
      const existing = opts.existingOperations?.[opKey(i)];
      return {
        idx: i,
        status: 'pending',
        operationName: existing?.name,
        resumed: !!existing,
        pollAttempts: existing?.attempts || 0,
      };
    });

    const job: JobState = {
      id,
      projectId: opts.projectId,
      projectTitle: opts.projectTitle || '제목 없음',
      userId: opts.userId,
      stage: 'video',
      status: 'queued',
      total: sceneStates.length,
      completed: 0,
      failed: 0,
      modelLabel: opts.model?.name || '기본 비디오 모델',
      modelId: opts.model?.modelId,
      provider: opts.model?.provider,
      scenes: sceneStates,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      contextPackId: opts.contextPackId,
      contextPackName: opts.contextPackName,
    };

    if (sceneStates.length === 0) {
      job.status = 'completed';
      job.endedAt = Date.now();
      this.jobs.set(id, job);
      this.emit();
      return id;
    }

    this.jobs.set(id, job);
    this.workSpecs.set(id, {
      scenes: opts.scenes,
      aspectRatio: opts.aspectRatio,
      model: opts.model,
      characterProfile: opts.characterProfile,
      styleSheet: opts.styleSheet,
      negativePrompt: opts.negativePrompt,
      characterReferenceImage: opts.characterReferenceImage,
      onSceneUpdate: opts.onSceneUpdate,
      onStatsDelta: opts.onStatsDelta,
      existingOperations: opts.existingOperations,
    });
    this.abortControllers.set(id, new AbortController());

    this.persistRun(job, 'running').catch(e =>
      console.warn('[JobManager] persistRun failed:', e)
    );
    this.emit();
    this.tryDispatch();
    return id;
  }

  /**
   * Rebind per-scene callbacks for an in-flight job (used when wizard remounts).
   */
  rebindCallbacks(
    jobId: string,
    cbs: {
      onSceneUpdate?: (idx: number, updates: Partial<Scene>) => void;
      onStatsDelta?: (delta: Partial<ProjectStats>) => void;
    }
  ) {
    const spec = this.workSpecs.get(jobId);
    if (!spec) return;
    spec.onSceneUpdate = cbs.onSceneUpdate;
    spec.onStatsDelta = cbs.onStatsDelta;
  }

  cancel(jobId: string) {
    const ctrl = this.abortControllers.get(jobId);
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status === 'completed' || job.status === 'failed') return;
    job.status = 'cancelled';
    job.endedAt = Date.now();
    job.updatedAt = Date.now();
    this.jobs.set(jobId, job);

    this.releasePause(jobId);
    if (ctrl) ctrl.abort();
    this.persistRun(job, 'cancelled').catch(() => {});
    this.emit();
  }

  pause(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status !== 'running' && job.status !== 'queued') return;
    if (this.pauseHandles.has(jobId)) return;
    const wasQueued = job.status === 'queued';
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    this.pauseHandles.set(jobId, { promise, resolve });
    this.pausedFromQueued.set(jobId, wasQueued);
    job.status = 'paused';
    job.updatedAt = Date.now();
    this.jobs.set(jobId, job);
    this.persistRun(job, 'running').catch(() => {});
    this.emit();
  }

  resume(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.status !== 'paused') return;
    const wasQueued = this.pausedFromQueued.get(jobId) === true;
    this.pausedFromQueued.delete(jobId);
    if (wasQueued) {
      job.status = 'queued';
      job.updatedAt = Date.now();
      this.jobs.set(jobId, job);
      this.releasePause(jobId);
      this.persistRun(job, 'running').catch(() => {});
      this.tryDispatch();
      return;
    }
    job.status = 'running';
    job.updatedAt = Date.now();
    this.jobs.set(jobId, job);
    this.releasePause(jobId);
    this.persistRun(job, 'running').catch(() => {});
    this.emit();
  }

  private releasePause(jobId: string) {
    const h = this.pauseHandles.get(jobId);
    if (h) {
      h.resolve();
      this.pauseHandles.delete(jobId);
    }
  }

  private async waitIfPaused(jobId: string): Promise<void> {
    const h = this.pauseHandles.get(jobId);
    if (!h) return;
    await h.promise;
  }

  /** Re-enqueue work for an interrupted project, restoring its model from the persisted run. */
  async resumeInterrupted(opts: {
    projectId: string;
    userId: string;
    onSceneUpdate?: (idx: number, updates: Partial<Scene>) => void;
    onStatsDelta?: (delta: Partial<ProjectStats>) => void;
    overrides?: {
      model?: AIModel;
      characterProfile?: string;
      styleSheet?: StyleSheet;
      negativePrompt?: string;
      characterReferenceImage?: string;
    };
  }): Promise<string | null> {
    const proj = await getProjectFromCloud(opts.projectId);
    if (!proj) return null;
    this.removePhantomFor(opts.projectId);
    const scenes = proj.saved_scenes || [];
    const aspectRatio = (proj.aspect_ratio || '16:9') as '16:9' | '9:16' | '1:1' | '3:4';

    let model: AIModel | undefined = opts.overrides?.model;
    if (!model && proj.generation_run?.videoModelId) {
      model = {
        id: proj.generation_run.videoModelId,
        name: proj.generation_run.videoModelLabel || '비디오 모델',
        provider: proj.generation_run.videoProvider,
        modelId: proj.generation_run.videoModelId,
        type: 'video',
      } as AIModel;
    }

    let contextPackName: string | undefined;
    if (proj.linked_context_pack_id) {
      try {
        const packs = await listPacks(opts.userId);
        contextPackName = packs.find(p => p.id === proj.linked_context_pack_id)?.name;
      } catch {}
    }

    const id = this.enqueueVideoBatch({
      projectId: opts.projectId,
      projectTitle: proj.title || '제목 없음',
      userId: opts.userId,
      scenes,
      aspectRatio,
      model,
      characterProfile: opts.overrides?.characterProfile ?? proj.character_profile,
      styleSheet: opts.overrides?.styleSheet ?? proj.style_sheet,
      negativePrompt: opts.overrides?.negativePrompt ?? proj.negative_prompt,
      characterReferenceImage:
        opts.overrides?.characterReferenceImage ?? proj.character_reference_image,
      contextPackId: proj.linked_context_pack_id,
      contextPackName,
      onSceneUpdate: opts.onSceneUpdate,
      onStatsDelta: opts.onStatsDelta,
      existingOperations: proj.generation_run?.operations,
    });
    const job = this.jobs.get(id);
    if (job && job.total === 0) {
      try {
        await updateProjectGenerationRun(opts.projectId, null);
      } catch {}
      return null;
    }
    return id;
  }

  /**
   * Abandon tracking of a long-wait scene. Clears the persisted Veo
   * operation handle and marks the scene as failed so the user can
   * retry from scratch later.
   */
  async abandonLongWait(projectId: string, sceneIdx: number): Promise<void> {
    const job = Array.from(this.jobs.values()).find(j => j.projectId === projectId);
    if (job) {
      const sState = job.scenes.find(s => s.idx === sceneIdx);
      if (sState && sState.status === 'long-wait') {
        sState.status = 'failed';
        sState.error = '추적 중단';
        job.failed++;
        this.recomputeJobStatus(job.id);
      }
    }
    try {
      const proj = await getProjectFromCloud(projectId);
      const base = proj?.generation_run;
      if (base) {
        const ops = { ...(base.operations || {}) };
        delete ops[opKey(sceneIdx)];
        const longWaitIndices = (base.longWaitIndices || []).filter(i => i !== sceneIdx);
        await updateProjectGenerationRun(projectId, {
          ...base,
          operations: Object.keys(ops).length > 0 ? ops : undefined,
          longWaitIndices: longWaitIndices.length > 0 ? longWaitIndices : undefined,
          updatedAt: new Date().toISOString(),
        });
      }
      // Clear the per-scene long-wait flag so the Step 5 badge doesn't
      // linger on reload / other devices.
      try {
        const k = sceneMapKey(sceneIdx);
        await updateProjectFields(projectId, {
          [`saved_scenes_map.${k}.video_meta.longWait`]: false,
          [`saved_scenes_map.${k}.video_meta.operationName`]: null,
        });
      } catch {}
    } catch (e) {
      console.warn('[JobManager] abandonLongWait failed:', e);
    }
  }

  /**
   * Manually re-attach the poller to a long-wait scene's persisted Veo
   * operation. Equivalent to "계속 추적": resumes polling immediately
   * without forcing the user to reload the tab.
   */
  async continueLongWait(opts: {
    projectId: string;
    userId: string;
    sceneIdx: number;
    onSceneUpdate?: (idx: number, updates: Partial<Scene>) => void;
    onStatsDelta?: (delta: Partial<ProjectStats>) => void;
  }): Promise<string | null> {
    const proj = await getProjectFromCloud(opts.projectId);
    if (!proj) return null;
    const op = proj.generation_run?.operations?.[opKey(opts.sceneIdx)];
    if (!op) return null;
    // Drop the local long-wait scene state so the new job can claim
    // the slot fresh.
    const existingJob = this.findByProject(opts.projectId);
    if (existingJob) {
      const sState = existingJob.scenes.find(s => s.idx === opts.sceneIdx);
      if (sState && sState.status === 'long-wait') {
        sState.status = 'pending';
        sState.error = undefined;
      }
    }
    // Clear the persisted longWait flag so badges hide while we poll.
    try {
      const k = sceneMapKey(opts.sceneIdx);
      await updateProjectFields(opts.projectId, {
        [`saved_scenes_map.${k}.video_meta.longWait`]: false,
      });
    } catch {}

    const scenes = proj.saved_scenes || [];
    const aspectRatio = (proj.aspect_ratio || '16:9') as '16:9' | '9:16' | '1:1' | '3:4';
    let model: AIModel | undefined;
    if (proj.generation_run?.videoModelId) {
      model = {
        id: proj.generation_run.videoModelId,
        name: proj.generation_run.videoModelLabel || '비디오 모델',
        provider: proj.generation_run.videoProvider,
        modelId: proj.generation_run.videoModelId,
        type: 'video',
      } as AIModel;
    }
    return this.enqueueVideoBatch({
      projectId: opts.projectId,
      projectTitle: proj.title || '제목 없음',
      userId: opts.userId,
      scenes,
      aspectRatio,
      model,
      characterProfile: proj.character_profile,
      styleSheet: proj.style_sheet,
      negativePrompt: proj.negative_prompt,
      characterReferenceImage: proj.character_reference_image,
      contextPackId: proj.linked_context_pack_id,
      onSceneUpdate: opts.onSceneUpdate,
      onStatsDelta: opts.onStatsDelta,
      existingOperations: { [opKey(opts.sceneIdx)]: op },
      onlyIndices: [opts.sceneIdx],
    });
  }

  /**
   * Force the durable upload queue to retry every pending entry for
   * the given project right now (skipping the backoff delay).
   */
  async retryUploadsNow(projectId: string): Promise<void> {
    try {
      await uploadQueue.retryProjectNow(projectId);
    } catch (e) {
      console.warn('[JobManager] retryUploadsNow failed:', e);
    }
  }

  /**
   * After auth, scan persisted projects for runs with pending Veo
   * operations and auto-resume polling for those scenes only. Other
   * interrupted scenes still require an explicit user click.
   */
  async autoResumePendingOperations(userId: string): Promise<void> {
    // Source of truth: query Firestore directly for projects whose
    // generation_run.status is in an active state. The slim project
    // list cache (cards) often omits generation_run entirely, which
    // would otherwise make recovery silently no-op (task #83 #1).
    let candidates: Project[] = [];
    try {
      candidates = await listProjectsWithActiveGenerationRun(userId);
    } catch (e) {
      console.warn('[JobManager] autoResumePendingOperations query failed:', e);
    }
    // Fallback: if the indexed query is unavailable, fall back to the
    // slim list and refetch full docs for projects with any hint of an
    // active run. Better than nothing.
    if (candidates.length === 0) {
      let projects: Project[] = [];
      try {
        projects = await getAllProjectsFromCloud(userId);
      } catch {}
      for (const p of projects) {
        const run = p.generation_run;
        const seemsActive =
          !!run && (run.status === 'running' || run.status === 'interrupted' || run.status === 'long-wait' || (run.operations && Object.keys(run.operations).length > 0));
        if (!seemsActive) continue;
        let full: Project | null | undefined = p;
        if (!run?.operations || Object.keys(run.operations).length === 0) {
          try { full = await getProjectFromCloud(p.id); } catch { continue; }
        }
        if (full) candidates.push(full);
      }
    }
    for (const p of candidates) {
      if (!p.id) {
        console.warn('[JobManager] auto-resume skipped: project missing id', p);
        continue;
      }
      const ops = p.generation_run?.operations;
      if (!ops || Object.keys(ops).length === 0) continue;
      // Task #83: do NOT auto-resume scenes already classified as
      // long-wait — those are awaiting an explicit "계속 추적" /
      // "추적 중단" decision from the user. If every persisted op is
      // long-wait, skip the project entirely.
      const longWaitSet = new Set(p.generation_run?.longWaitIndices || []);
      const hasResumable = Object.entries(ops).some(([, op]) => {
        const sceneIdx = op.sceneIdx;
        if (typeof sceneIdx === 'number' && longWaitSet.has(sceneIdx)) return false;
        if (op.status === 'long-wait') return false;
        return true;
      });
      if (!hasResumable) continue;
      // Only an *active* (non-phantom) job should block auto-resume.
      // Phantom 'interrupted' cards from loadInterruptedFromProjects()
      // are stale UI state and must not prevent recovery — task #83
      // primary criterion is automatic resume after tab close.
      const existing = this.findByProject(p.id);
      if (existing && existing.status !== 'interrupted') continue;
      try {
        await this.resumeInterrupted({ projectId: p.id, userId });
      } catch (e) {
        console.warn(`[JobManager] auto-resume for ${p.id} failed:`, e);
      }
    }
  }

  /**
   * Drop any phantom 'interrupted' card hydrated for the given project.
   */
  private removePhantomFor(projectId: string) {
    let changed = false;
    for (const [id, j] of this.jobs.entries()) {
      if (j.projectId === projectId && j.status === 'interrupted') {
        this.jobs.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** Hydrate the dock with phantom cards for projects with interrupted/stale runs. */
  async loadInterruptedFromProjects(userId: string): Promise<void> {
    let projects: Project[] = [];
    try {
      projects = await getAllProjectsFromCloud(userId);
    } catch (e) {
      console.warn('[JobManager] loadInterruptedFromProjects fetch failed:', e);
      return;
    }
    // A fresh load means no in-tab worker is touching any 'running' run.
    let breadcrumbIds = new Set<string>();
    try {
      const raw = sessionStorage.getItem(PROCESSED_INTERRUPT_KEY);
      if (raw) breadcrumbIds = new Set(JSON.parse(raw) as string[]);
      sessionStorage.removeItem(PROCESSED_INTERRUPT_KEY);
    } catch {}

    const interrupted = projects.filter(p => {
      const run = p.generation_run;
      if (!run) return false;
      if (run.status === 'interrupted') return true;
      if (run.status === 'running') return true;
      // Task #83: hydrate long-wait runs too so the dock keeps showing
      // the "계속 추적 / 추적 중단" controls across reloads.
      if (run.status === 'long-wait') return true;
      if (breadcrumbIds.has(p.id)) return true;
      return false;
    });
    if (interrupted.length === 0) return;

    // Persist the derived 'interrupted' status so subsequent loads are stable.
    for (const p of interrupted) {
      const r = p.generation_run!;
      // Preserve 'long-wait' so the explicit user-decision state isn't
      // downgraded to 'interrupted'.
      if (r.status !== 'interrupted' && r.status !== 'long-wait') {
        updateProjectGenerationRun(p.id, { ...r, status: 'interrupted', updatedAt: new Date().toISOString() }).catch(() => {});
      }
    }

    let packsByProject: Map<string, string> | undefined;
    if (interrupted.some(p => p.linked_context_pack_id)) {
      try {
        const packs = await listPacks(userId);
        packsByProject = new Map(packs.map(p => [p.id, p.name]));
      } catch {}
    }

    let added = false;
    for (const p of interrupted) {
      if (this.findByProject(p.id)) continue;
      const run = p.generation_run!;
      const startedAt = Date.parse(run.startedAt) || Date.now();
      const updatedAt = Date.parse(run.updatedAt) || startedAt;
      const phantom: JobState = {
        id: `phantom-${p.id}`,
        projectId: p.id,
        projectTitle: p.title || '제목 없음',
        userId,
        stage: 'video',
        status: run.status === 'long-wait' ? 'long-wait' : 'interrupted',
        total: run.total,
        completed: run.completed,
        failed: run.failed,
        modelLabel: run.videoModelLabel || '비디오 모델',
        modelId: run.videoModelId,
        provider: run.videoProvider,
        // Hydrate scene placeholders for long-wait indices so the dock's
        // "계속 추적 / 추적 중단" buttons can target a sceneIdx after a
        // reload (otherwise scenes is empty and the buttons no-op).
        scenes: (run.longWaitIndices || []).map(idx => ({
          idx,
          status: 'long-wait' as const,
          error: '장시간 대기',
          operationName: run.operations?.[opKey(idx)]?.name,
          pollAttempts: run.operations?.[opKey(idx)]?.attempts || 0,
        })),
        startedAt,
        updatedAt,
        endedAt: updatedAt,
        contextPackId: p.linked_context_pack_id,
        contextPackName: p.linked_context_pack_id
          ? packsByProject?.get(p.linked_context_pack_id)
          : undefined,
      };
      this.jobs.set(phantom.id, phantom);
      added = true;
    }
    if (added) this.emit();
  }

  /** Clear completed/failed/cancelled jobs from the dock. */
  clearFinished() {
    let changed = false;
    for (const [id, j] of this.jobs.entries()) {
      if (
        j.status === 'completed' ||
        j.status === 'failed' ||
        j.status === 'cancelled'
      ) {
        this.jobs.delete(id);
        this.workSpecs.delete(id);
        this.abortControllers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  // ---------- Scheduler ----------
  private tryDispatch() {
    while (this.runningCount < this.concurrency) {
      const next = Array.from(this.jobs.values())
        .filter(j => j.status === 'queued')
        .sort((a, b) => a.startedAt - b.startedAt)[0];
      if (!next) break;
      next.status = 'running';
      next.updatedAt = Date.now();
      this.runningCount++;
      this.runJob(next.id).finally(() => {
        this.runningCount = Math.max(0, this.runningCount - 1);
        this.tryDispatch();
      });
    }
    this.emit();
  }

  private async runJob(jobId: string) {
    const job = this.jobs.get(jobId);
    const spec = this.workSpecs.get(jobId);
    const ctrl = this.abortControllers.get(jobId);
    if (!job || !spec || !ctrl) return;
    const signal = ctrl.signal;
    const modelKey = spec.model?.modelId || spec.model?.id || 'default-video';

    for (const sState of job.scenes) {
      if (signal.aborted) {
        sState.status = 'failed';
        sState.error = '취소됨';
        break;
      }
      await this.waitIfPaused(jobId);
      if (signal.aborted) {
        sState.status = 'failed';
        sState.error = '취소됨';
        break;
      }
      if (sState.status !== 'pending') continue;

      sState.status = 'running';
      job.updatedAt = Date.now();
      this.emit();

      const sceneStart = Date.now();
      const existing = spec.existingOperations?.[opKey(sState.idx)];
      try {
        await this.waitForToken(modelKey, signal);
        const s = spec.scenes[sState.idx];
        if (!s) throw new Error(`Scene ${sState.idx} not found`);
        const seedImage = s.image_path;
        const prevContext =
          sState.idx > 0 ? spec.scenes[sState.idx - 1]?.visual_prompt : undefined;

        const result = throwGenerationFailure(await runVideoGeneration({
          prompt: s.visual_prompt!,
          imageSource: seedImage,
          aspectRatio: spec.aspectRatio,
          model: spec.model,
          audioScript: s.script_segment || s.audio_script,
          characterProfile: spec.characterProfile || undefined,
          previousSceneContext: prevContext,
          sceneIndex: sState.idx,
          options: {
            scene: s,
            styleSheet: spec.styleSheet,
            negativePrompt: spec.negativePrompt || s.negativePrompt,
            referenceImage: spec.characterReferenceImage,
            seedPreference: s.videoSeedPreference,
            signal,
            existingOperation: existing?.name ? { name: existing.name } : undefined,
            onOperationSubmitted: (op) => {
              sState.operationName = op.name;
              const rec: OperationRecord = {
                name: op.name,
                sceneIdx: sState.idx,
                modelId: spec.model?.modelId,
                provider: spec.model?.provider,
                submittedAt: new Date().toISOString(),
                attempts: 0,
                status: 'pending',
              };
              this.persistOperation(job, sState.idx, rec).catch(() => {});
              this.emit();
            },
            onPollProgress: (info) => {
              sState.pollAttempts = info.attempts;
              if (info.attempts % 5 === 0) this.emit();
            },
          },
        }));
        if (signal.aborted) {
          sState.status = 'failed';
          sState.error = '취소됨';
          break;
        }
        if (!result?.videoUrl) throw new Error('비디오 결과가 비어 있습니다');

        spec.onStatsDelta?.(result.stats);

        const resp = await fetch(result.videoUrl);
        if (!resp.ok) throw new Error(`Video fetch failed: ${resp.status}`);
        const blob = await resp.blob();

        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          await saveMedia(job.projectId, sState.idx, 'video', dataUrl);
        } catch (cacheErr) {
          console.warn(`[JobManager] scene ${sState.idx} cache save failed:`, cacheErr);
        }

        const storagePath = `users/${job.userId}/projects/${job.projectId}/videos/s${sState.idx}.mp4`;
        const baseMeta: VideoMeta = {
          modelId: result.actualModelId || spec.model?.modelId,
          provider: spec.model?.provider,
          aspectRatio: spec.aspectRatio,
          seedSource: result.seedSource,
          seedAssetPath: result.seedAssetPath,
          operationName: result.operationName,
          pollAttempts: result.pollAttempts,
          generatedAt: new Date().toISOString(),
          generationDurationMs: Date.now() - sceneStart,
          costUsd: getVideoPricePerCallUsd(result.actualModelId || spec.model?.modelId),
          videoCast: result.videoCast,
          videoCastAttached: result.videoCastAttached,
          resumed: sState.resumed || undefined,
          uploadStatus: 'pending-upload',
        };

        const localUrl = URL.createObjectURL(blob);
        const updates: Partial<Scene> = {
          seedSource: result.seedSource,
          videoCast: result.videoCast,
          videoCastAttached: result.videoCastAttached,
          videoSeedPreferenceUsed: s.videoSeedPreference || 'scene-image',
          video_path: localUrl,
          video_meta: baseMeta,
        };
        spec.scenes[sState.idx] = { ...s, ...updates };
        spec.onSceneUpdate?.(sState.idx, updates);

        // Enqueue durable upload. The queue persists the blob to
        // IndexedDB and retries with backoff across reloads. On
        // success, the queue patches saved_scenes_map fields; the
        // local subscription (onUploadEvent) flips video_path to
        // the final https URL in-memory.
        const entryId = await uploadQueue.enqueue({
          projectId: job.projectId,
          userId: job.userId,
          sceneIdx: sState.idx,
          destPath: storagePath,
          blob,
        });
        sState.uploadEntryId = entryId;
        sState.uploadAttempts = 0;
        this.uploadEntryIndex.set(entryId, { jobId, sceneIdx: sState.idx });

        // Persist scene-level metadata (without final URL) so a reload
        // can synthesise an "uploading" badge from cloud state.
        this.persistSceneUpdate(job, sState.idx, {
          seedSource: result.seedSource,
          videoCast: result.videoCast,
          videoCastAttached: result.videoCastAttached,
          videoSeedPreferenceUsed: updates.videoSeedPreferenceUsed,
          video_meta: { ...baseMeta, uploadStatus: 'pending-upload' },
        }).catch(e => console.warn('[JobManager] persistSceneUpdate failed:', e));

        // Clear the persisted operation now that the clip has been
        // produced — the upload queue takes over from here.
        this.persistOperation(job, sState.idx, null).catch(() => {});

        sState.status = 'uploading';
        sState.durationMs = Date.now() - sceneStart;
        job.completed++;
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal.aborted) {
          sState.status = 'failed';
          sState.error = '취소됨';
          break;
        }
        // Long-wait: the operation has been submitted (and persisted via
        // onOperationSubmitted) but hasn't completed within the 30-min
        // budget. Don't count as failed; the user can manually resume
        // polling later.
        if (err?.name === 'VeoLongWaitError' || err?.code === 'VEO_LONG_WAIT') {
          const opName = err.operationName || sState.operationName;
          sState.status = 'long-wait';
          sState.error = '장시간 대기';
          sState.durationMs = Date.now() - sceneStart;
          if (opName) {
            const rec: OperationRecord = {
              name: opName,
              sceneIdx: sState.idx,
              modelId: spec.model?.modelId,
              provider: spec.model?.provider,
              submittedAt: existing?.submittedAt || new Date().toISOString(),
              attempts: sState.pollAttempts || 0,
              status: 'long-wait',
              lastPolledAt: new Date().toISOString(),
            };
            this.persistOperation(job, sState.idx, rec).catch(() => {});
          }
          // Persist a scene-level long-wait flag so Step 5's badge is
          // driven by cloud state (works on reload + cross-device).
          this.persistSceneUpdate(job, sState.idx, {
            video_meta: {
              ...(spec.scenes[sState.idx]?.video_meta || {}),
              longWait: true,
              operationName: opName,
              pollAttempts: sState.pollAttempts || 0,
              modelId: spec.model?.modelId,
              provider: spec.model?.provider,
            },
          } as Partial<Scene>).catch(() => {});
          // Mirror in mutable scene + notify wizard so the badge appears
          // immediately (no reload required).
          try {
            const merged: Partial<Scene> = {
              video_meta: {
                ...(spec.scenes[sState.idx]?.video_meta || {}),
                longWait: true,
                operationName: opName,
                pollAttempts: sState.pollAttempts || 0,
              },
            };
            spec.scenes[sState.idx] = { ...(spec.scenes[sState.idx] || {}), ...merged };
            spec.onSceneUpdate?.(sState.idx, merged);
          } catch {}
          job.updatedAt = Date.now();
          this.persistRun(job, 'running').catch(() => {});
          this.emit();
          continue;
        }
        const normalized = normalizeGenerationError(err, {
          provider: spec.model?.provider || 'Google',
          operation: job.id,
        });
        console.error(`[JobManager] scene ${sState.idx} failed:`, normalized.code, normalized.message);
        sState.status = 'failed';
        sState.error = normalized.message;
        sState.generationError = normalized;
        sState.durationMs = Date.now() - sceneStart;
        job.failed++;
        job.lastError = normalized.message;
      }
      job.updatedAt = Date.now();
      this.persistRun(job, 'running').catch(() => {});
      this.emit();
    }


    if (job.status === 'cancelled') {
      // already handled
    } else if (signal.aborted) {
      job.status = 'cancelled';
    } else {
      const longWaiting = job.scenes.some(s => s.status === 'long-wait');
      const stillUploading = job.scenes.some(s => s.status === 'uploading');
      if (longWaiting) {
        job.status = 'long-wait';
      } else if (stillUploading) {
        // Keep the job 'running' (visually) until the upload queue
        // settles. recomputeJobStatus will flip to completed/long-wait
        // when uploads drain.
        job.status = 'running';
      } else if (job.failed === 0 && job.completed === job.total) {
        job.status = 'completed';
      } else if (job.completed === 0) {
        job.status = 'failed';
      } else {
        job.status = 'completed';
      }
    }
    job.endedAt = Date.now();
    job.updatedAt = Date.now();
    const persistedStatus: GenerationRun['status'] =
      job.status === 'cancelled'
        ? 'cancelled'
        : job.status === 'long-wait'
          ? 'long-wait'
          : job.status === 'running'
            ? 'running'
            : job.failed > 0 && job.completed === 0
              ? 'failed'
              : 'completed';
    this.persistRun(job, persistedStatus).catch(() => {});
    this.emit();
  }

  // ---------- Persistence helpers ----------
  private buildRun(
    job: JobState,
    status: GenerationRun['status']
  ): GenerationRun {
    const failedIndices = job.scenes
      .filter(s => s.status === 'failed')
      .map(s => s.idx);
    const longWaitIndices = job.scenes
      .filter(s => s.status === 'long-wait')
      .map(s => s.idx);
    const pendingUploadIndices = job.scenes
      .filter(s => s.status === 'uploading')
      .map(s => s.idx);
    // Preserve any operations stamped via persistOperation. We can't
    // read them back from the cloud here, so the merge happens in
    // persistOperation/persistRun by reading the existing run first.
    return {
      id: job.id,
      status,
      stage: 'video',
      startedAt: new Date(job.startedAt).toISOString(),
      updatedAt: new Date().toISOString(),
      total: job.total,
      completed: job.completed,
      failed: job.failed,
      failedIndices: failedIndices.length > 0 ? failedIndices : undefined,
      longWaitIndices: longWaitIndices.length > 0 ? longWaitIndices : undefined,
      pendingUploadIndices:
        pendingUploadIndices.length > 0 ? pendingUploadIndices : undefined,
      videoModelId: job.modelId,
      videoProvider: job.provider,
      videoModelLabel: job.modelLabel,
    };
  }

  private async persistRun(
    job: JobState,
    status: GenerationRun['status']
  ): Promise<void> {
    if (!job.projectId) return;
    try {
      // Merge with the existing run so we don't clobber the operations
      // map that persistOperation maintains in parallel.
      const existing = await getProjectFromCloud(job.projectId).catch(() => null);
      const next = this.buildRun(job, status);
      if (existing?.generation_run?.operations) {
        next.operations = existing.generation_run.operations;
      }
      await updateProjectGenerationRun(job.projectId, next);
    } catch (e) {
      console.warn('[JobManager] persistRun failed:', e);
    }
  }

  // Persist (or clear, when record === null) a single OperationRecord
  // under generation_run.operations[<paddedIdx>]. Used to make Veo
  // long-running operations resumable across page reloads.
  private async persistOperation(
    job: JobState,
    sceneIdx: number,
    record: OperationRecord | null
  ): Promise<void> {
    if (!job.projectId) return;
    try {
      const proj = await getProjectFromCloud(job.projectId);
      const base = proj?.generation_run || this.buildRun(job, 'running');
      const ops: Record<string, OperationRecord> = { ...(base.operations || {}) };
      const key = opKey(sceneIdx);
      if (record === null) {
        delete ops[key];
      } else {
        ops[key] = record;
      }
      const next: GenerationRun = {
        ...base,
        operations: Object.keys(ops).length > 0 ? ops : undefined,
        updatedAt: new Date().toISOString(),
      };
      await updateProjectGenerationRun(job.projectId, next);
    } catch (e) {
      console.warn('[JobManager] persistOperation failed:', e);
    }
  }

  // Persist a partial scene update using dotted `saved_scenes_map.<idx>.<field>`
  // paths, which is the source of truth read by getProjectFromCloud. Falls
  // back to a full saved_scenes write only if the dotted patch fails (e.g.
  // legacy doc that has no map yet).
  private async persistSceneUpdate(
    job: JobState,
    idx: number,
    updates: Partial<Scene>
  ): Promise<void> {
    if (!job.projectId) return;
    const key = sceneMapKey(idx);
    const patch: Record<string, any> = {};
    for (const [field, value] of Object.entries(updates)) {
      const sv = sanitizeSceneFieldForFirestore(field, value);
      if (sv === undefined) continue;
      // For nested objects (video_meta), expand to one dotted path per
      // leaf so partial updates don't clobber unrelated keys.
      if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
        for (const [subField, subValue] of Object.entries(sv)) {
          if (subValue === undefined) continue;
          patch[`saved_scenes_map.${key}.${field}.${subField}`] = subValue;
        }
      } else {
        patch[`saved_scenes_map.${key}.${field}`] = sv;
      }
    }
    if (Object.keys(patch).length === 0) return;
    try {
      await updateProjectFields(job.projectId, patch);
    } catch (e) {
      console.warn('[JobManager] persistSceneUpdate (dotted) failed, falling back:', e);
      try {
        const proj = await getProjectFromCloud(job.projectId);
        if (!proj) return;
        const scenes = proj.saved_scenes ? [...proj.saved_scenes] : [];
        while (scenes.length <= idx) scenes.push({} as Scene);
        scenes[idx] = { ...(scenes[idx] || {}), ...updates } as Scene;
        await updateProjectFields(job.projectId, { saved_scenes: scenes });
      } catch (e2) {
        console.warn('[JobManager] persistSceneUpdate fallback failed:', e2);
      }
    }
  }

  /**
   * Snapshot of every running/queued/paused job (for the unload handler).
   */
  inFlight(): JobState[] {
    return Array.from(this.jobs.values()).filter(
      j => j.status === 'running' || j.status === 'queued' || j.status === 'paused'
    );
  }

  /**
   * Mark a job's project as interrupted (best-effort, fire-and-forget).
   * Patches only the status/updatedAt fields via dotted paths so the
   * persisted `generation_run.operations` registry is preserved — losing
   * it would break task #83's auto-resume on tab reopen.
   */
  async markInterrupted(job: JobState): Promise<void> {
    if (!job.projectId) return;
    try {
      await updateProjectFields(job.projectId, {
        'generation_run.status': 'interrupted',
        'generation_run.updatedAt': new Date().toISOString(),
      });
    } catch {}
  }
}

export const jobManager = new JobManager();

// Mark in-flight jobs as 'interrupted' on unload so the next session can
// show "이어서 진행".
if (typeof window !== 'undefined') {
  const handler = () => {
    try {
      const inFlight = jobManager.inFlight();
      if (inFlight.length === 0) return;
      try {
        sessionStorage.setItem(
          PROCESSED_INTERRUPT_KEY,
          JSON.stringify(inFlight.map(j => j.projectId))
        );
      } catch {}
      for (const j of inFlight) {
        jobManager.markInterrupted(j).catch(() => {});
      }
    } catch {}
  };
  window.addEventListener('beforeunload', handler);
}
