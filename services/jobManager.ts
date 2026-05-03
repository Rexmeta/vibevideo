// Background video-batch job manager: concurrency, per-model rate
// limits, pause/resume/abort, resume-after-reload.
import {
  Scene,
  AIModel,
  StyleSheet,
  ProjectStats,
  GenerationRun,
  Project,
} from '../types';
import { generateSceneVideo } from './geminiService';
import {
  uploadFileToCloud,
  getProjectFromCloud,
  getAllProjectsFromCloud,
  updateProjectFields,
  updateProjectGenerationRun,
} from './storageService';
import { saveMedia } from './mediaCache';
import { listPacks } from './contextPackService';

export type JobStage = 'video';
export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface JobSceneState {
  idx: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  error?: string;
  durationMs?: number;
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
    }
  > = new Map();

  private rateBudget: Map<string, { tokensPerMinute: number; recent: number[] }> =
    new Map();

  constructor() {
    try {
      const saved = localStorage.getItem(CONCURRENCY_KEY);
      if (saved) this.concurrency = clampConcurrency(parseInt(saved, 10));
    } catch {}
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
  }): string {
    const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const candidateIdxs: number[] = [];
    opts.scenes.forEach((s, i) => {
      const inFilter = !opts.onlyIndices || opts.onlyIndices.includes(i);
      if (!inFilter) return;
      if (s.video_path && s.video_path.startsWith('http')) return;
      candidateIdxs.push(i);
    });

    const sceneStates: JobSceneState[] = candidateIdxs.map(i => ({
      idx: i,
      status: 'pending',
    }));

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
      if (breadcrumbIds.has(p.id)) return true;
      return false;
    });
    if (interrupted.length === 0) return;

    // Persist the derived 'interrupted' status so subsequent loads are stable.
    for (const p of interrupted) {
      const r = p.generation_run!;
      if (r.status !== 'interrupted') {
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
        status: 'interrupted',
        total: run.total,
        completed: run.completed,
        failed: run.failed,
        modelLabel: run.videoModelLabel || '비디오 모델',
        modelId: run.videoModelId,
        provider: run.videoProvider,
        scenes: [],
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
      try {
        await this.waitForToken(modelKey, signal);
        const s = spec.scenes[sState.idx];
        if (!s) throw new Error(`Scene ${sState.idx} not found`);
        const seedImage = s.image_path;
        const prevContext =
          sState.idx > 0 ? spec.scenes[sState.idx - 1]?.visual_prompt : undefined;
        const result = await generateSceneVideo(
          s.visual_prompt!,
          seedImage,
          spec.aspectRatio,
          spec.model?.modelId,
          spec.model?.provider,
          s.script_segment || s.audio_script,
          spec.characterProfile || undefined,
          prevContext,
          sState.idx,
          {
            scene: s,
            styleSheet: spec.styleSheet,
            negativePrompt: spec.negativePrompt || s.negativePrompt,
            referenceImage: spec.characterReferenceImage,
            seedPreference: s.videoSeedPreference,
            signal,
          }
        );
        if (signal.aborted) {
          sState.status = 'failed';
          sState.error = '취소됨';
          break;
        }
        if (result?.videoUrl) {
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
            console.warn(
              `[JobManager] scene ${sState.idx} cache save failed:`,
              cacheErr
            );
          }

          // Upload to cloud — keep an httpUrl for the project document.
          let finalUrl: string | undefined;
          try {
            finalUrl = await uploadFileToCloud(
              `users/${job.userId}/projects/${job.projectId}/videos/s${sState.idx}.mp4`,
              blob,
              'blob'
            );
          } catch (uploadErr) {
            console.warn(
              `[JobManager] scene ${sState.idx} upload failed:`,
              uploadErr
            );
          }

          // Update mutable scene + propagate to subscriber (wizard).
          const updates: Partial<Scene> = {
            seedSource: result.seedSource,
            videoCast: result.videoCast,
            videoCastAttached: result.videoCastAttached,
            videoSeedPreferenceUsed: s.videoSeedPreference || 'scene-image',
          };
          if (finalUrl) {
            updates.video_path = finalUrl;
          } else {
            // Upload failed: show blob URL in-tab, but don't persist it
            // so the scene stays resumable on next load.
            updates.video_path = URL.createObjectURL(blob);
          }
          spec.scenes[sState.idx] = { ...s, ...updates };
          spec.onSceneUpdate?.(sState.idx, updates);

          if (finalUrl) {
            this.persistSceneUpdate(job, sState.idx, updates).catch(e =>
              console.warn('[JobManager] persistSceneUpdate failed:', e)
            );
          }

          sState.status = 'done';
          sState.durationMs = Date.now() - sceneStart;
          job.completed++;
        } else {
          throw new Error('비디오 결과가 비어 있습니다');
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal.aborted) {
          sState.status = 'failed';
          sState.error = '취소됨';
          break;
        }
        const msg = err?.message || String(err);
        console.error(`[JobManager] scene ${sState.idx} failed:`, msg);
        sState.status = 'failed';
        sState.error = msg;
        sState.durationMs = Date.now() - sceneStart;
        job.failed++;
        job.lastError = msg;
      }
      job.updatedAt = Date.now();
      this.persistRun(job, 'running').catch(() => {});
      this.emit();
    }


    if (job.status === 'cancelled') {
      // already handled
    } else if (signal.aborted) {
      job.status = 'cancelled';
    } else if (job.failed === 0 && job.completed === job.total) {
      job.status = 'completed';
    } else if (job.completed === 0) {
      job.status = 'failed';
    } else {
      job.status = 'completed';
    }
    job.endedAt = Date.now();
    job.updatedAt = Date.now();
    this.persistRun(
      job,
      job.status === 'cancelled' ? 'cancelled' : job.failed > 0 && job.completed === 0 ? 'failed' : 'completed'
    ).catch(() => {});
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
      await updateProjectGenerationRun(job.projectId, this.buildRun(job, status));
    } catch (e) {
      console.warn('[JobManager] persistRun failed:', e);
    }
  }

  private async persistSceneUpdate(
    job: JobState,
    idx: number,
    updates: Partial<Scene>
  ): Promise<void> {
    if (!job.projectId) return;
    try {
      const proj = await getProjectFromCloud(job.projectId);
      if (!proj) return;
      const scenes = proj.saved_scenes ? [...proj.saved_scenes] : [];
      while (scenes.length <= idx) scenes.push({} as Scene);
      scenes[idx] = { ...(scenes[idx] || {}), ...updates } as Scene;
      await updateProjectFields(job.projectId, { saved_scenes: scenes });
    } catch (e) {
      console.warn('[JobManager] persistSceneUpdate failed:', e);
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

  /** Mark a job's project as interrupted (best-effort, fire-and-forget). */
  async markInterrupted(job: JobState): Promise<void> {
    if (!job.projectId) return;
    try {
      await updateProjectGenerationRun(job.projectId, this.buildRun(job, 'interrupted'));
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
