import { describe, expect, it } from 'vitest';
import {
  createGenerationJob,
  mapRuntimeJobStatus,
  syncGenerationJobFromRuntime,
} from '../services/generationJob';
import { createGenerationIntent } from '../services/generationIntent';
import type { JobState } from '../services/jobManager';

const intent = createGenerationIntent({
  projectId: 'project-1',
  sceneId: 'scene-1',
  sceneIndex: 0,
  provider: 'Google',
  model: 'veo',
  scene: { id: 'scene-1', project_id: 'project-1', script_segment: 'hello' },
  aspectRatio: '16:9',
});

const runtime = (status: JobState['status'], sceneStatus: JobState['scenes'][number]['status']): JobState => ({
  id: 'runtime-1',
  projectId: 'project-1',
  projectTitle: 'Project',
  userId: 'user-1',
  stage: 'video',
  status,
  total: 1,
  completed: sceneStatus === 'done' ? 1 : 0,
  failed: sceneStatus === 'failed' ? 1 : 0,
  modelLabel: 'Veo',
  scenes: [{ idx: 0, status: sceneStatus }],
  startedAt: 10,
  updatedAt: 20,
  endedAt: ['completed', 'failed', 'cancelled'].includes(status) ? 20 : undefined,
});

describe('generation job domain mapping', () => {
  it('keeps command, intent, idempotency and job identities separate', () => {
    const job = createGenerationJob(intent, 'command-1', 0);
    expect(new Set([
      job.commandId,
      job.intentId,
      job.idempotencyKey,
      job.jobId,
    ]).size).toBe(4);
  });

  it.each([
    ['queued', 'pending', 'queued'],
    ['running', 'running', 'running'],
    ['running', 'uploading', 'uploading'],
    ['completed', 'done', 'completed'],
    ['failed', 'failed', 'failed'],
    ['cancelled', 'failed', 'cancelled'],
    ['interrupted', 'pending', 'interrupted'],
  ] as const)('maps %s/%s to %s', (jobStatus, sceneStatus, expected) => {
    expect(mapRuntimeJobStatus(runtime(jobStatus, sceneStatus), 0)).toBe(expected);
  });

  it('maps an operation handle to provider_pending without replacing runtime state', () => {
    const job = createGenerationJob(intent, 'command-1', 0);
    const state = runtime('running', 'running');
    state.scenes[0].operationName = 'operations/123';
    const updated = syncGenerationJobFromRuntime(job, state);
    expect(updated).toMatchObject({
      status: 'provider_pending',
      providerOperationId: 'operations/123',
    });
  });
});
