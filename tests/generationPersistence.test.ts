import { describe, expect, it } from 'vitest';
import {
  claimGenerationJob,
  getGenerationJobRecord,
  updateGenerationJobRecord,
} from '../services/storageService';
import type { GenerationJob } from '../services/generationJob';

const makeJob = (projectId: string): GenerationJob => ({
  jobId: `job-${projectId}`,
  intentId: `intent-${projectId}`,
  idempotencyKey: `key-${projectId}`,
  commandId: 'command-1',
  projectId,
  sceneIndex: 0,
  capability: 'image',
  provider: 'Google',
  model: 'imagen',
  status: 'queued',
  attempts: 1,
  createdAt: Date.now(),
});

describe('durable generation job persistence', () => {
  it('atomically gives one of two tabs the initial lease', async () => {
    const job = makeJob(`race-${Date.now()}-${Math.random()}`);
    const [first, second] = await Promise.all([
      claimGenerationJob(job, 'tab-a'),
      claimGenerationJob(job, 'tab-b'),
    ]);

    expect([first.acquired, second.acquired].filter(Boolean)).toHaveLength(1);
    expect(first.record.jobId).toBe(second.record.jobId);
    expect(first.record.ownerId === 'tab-a' || first.record.ownerId === 'tab-b').toBe(true);
  });

  it('reconnects to the completed result and fences a stale owner after expiry', async () => {
    const job = makeJob(`expiry-${Date.now()}-${Math.random()}`);
    const first = await claimGenerationJob(job, 'tab-a');
    await updateGenerationJobRecord(job.projectId, job.idempotencyKey, 'tab-a', {
      leaseUntil: Date.now() - 1,
    });

    const takeover = await claimGenerationJob(job, 'tab-b');
    expect(takeover.acquired).toBe(true);
    expect(takeover.record.attempts).toBe(2);
    await expect(
      updateGenerationJobRecord(job.projectId, job.idempotencyKey, 'tab-a', {
        status: 'completed',
        result: { value: 'stale' },
      }),
    ).resolves.toBeUndefined();

    await updateGenerationJobRecord(job.projectId, job.idempotencyKey, 'tab-b', {
      status: 'completed',
      result: { value: 'shared-result' },
      leaseUntil: 0,
    });
    const restored = await getGenerationJobRecord(job.projectId, job.idempotencyKey);
    expect(restored).toMatchObject({
      ownerId: 'tab-b',
      status: 'completed',
      result: { value: 'shared-result' },
    });
    expect(first.record.jobId).toBe(restored?.jobId);
  });
});