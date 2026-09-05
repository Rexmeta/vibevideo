import type { GenerationError } from '../types';
import type { JobState } from './jobManager';
import type { GenerationIntent } from './generationIntent';

export type GenerationJobStatus =
  | 'queued'
  | 'running'
  | 'provider_pending'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface GenerationJob {
  jobId: string;
  intentId: string;
  idempotencyKey: string;
  commandId: string;
  projectId: string;
  sceneId?: string;
  sceneIndex: number;
  capability: GenerationIntent['capability'];
  provider: string;
  model: string;
  status: GenerationJobStatus;
  attempts: number;
  providerOperationId?: string;
  result?: {
    assetUrl?: string;
    storagePath?: string;
    /** JSON-safe result payload used when a reconnecting tab can reuse it. */
    value?: unknown;
  };
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
  /** Internal link to the existing browser runtime execution. */
  runtimeJobId?: string;
}

export const createGenerationJob = (
  intent: GenerationIntent,
  commandId: string,
  sceneIndex: number,
): GenerationJob => ({
  jobId: `generation-job-${crypto.randomUUID()}`,
  intentId: intent.intentId,
  idempotencyKey: intent.idempotencyKey,
  commandId,
  projectId: intent.projectId,
  sceneId: intent.sceneId,
  sceneIndex,
  capability: intent.capability,
  provider: intent.provider,
  model: intent.model,
  status: 'queued',
  attempts: 1,
  createdAt: Date.now(),
});

export const mapRuntimeJobStatus = (
  runtime: JobState,
  sceneIndex: number,
): GenerationJobStatus => {
  const scene = runtime.scenes.find(item => item.idx === sceneIndex);
  if (runtime.status === 'cancelled') return 'cancelled';
  if (runtime.status === 'interrupted' || runtime.status === 'long-wait') return 'interrupted';
  if (scene?.status === 'uploading') return 'uploading';
  if (scene?.status === 'done') return 'completed';
  if (scene?.status === 'failed') return 'failed';
  if (scene?.operationName) return 'provider_pending';
  if (scene?.status === 'running' || runtime.status === 'running') return 'running';
  if (runtime.status === 'failed') return 'failed';
  if (runtime.status === 'completed') return 'completed';
  return 'queued';
};

export const syncGenerationJobFromRuntime = (
  generationJob: GenerationJob,
  runtime: JobState,
): GenerationJob => {
  const scene = runtime.scenes.find(item => item.idx === generationJob.sceneIndex);
  const status = mapRuntimeJobStatus(runtime, generationJob.sceneIndex);
  const error = scene?.generationError as GenerationError | undefined;
  return {
    ...generationJob,
    status,
    providerOperationId: scene?.operationName || generationJob.providerOperationId,
    error: scene?.error
      ? {
          code: error?.code || 'UNKNOWN',
          message: scene.error,
          retryable: error?.retryable,
        }
      : undefined,
    startedAt: status === 'queued' ? generationJob.startedAt : generationJob.startedAt || runtime.startedAt,
    completedAt: status === 'completed' ? runtime.endedAt || runtime.updatedAt : undefined,
    failedAt: status === 'failed' ? runtime.endedAt || runtime.updatedAt : undefined,
  };
};