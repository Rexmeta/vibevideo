import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  createFirestoreGenerationJobPersistence,
  type GenerationJobPersistence,
} from '../services/storageService';
import type { GenerationJob } from '../services/generationJob';

const PROJECT_ID = 'demo-vibevideo';
const hasFirestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const firestoreDescribe = hasFirestoreEmulator ? describe : describe.skip;

let testEnv: RulesTestEnvironment;

const makeJob = (
  projectId: string,
  capability: GenerationJob['capability'],
  suffix: string,
): GenerationJob => ({
  jobId: `job-${suffix}`,
  intentId: `intent-${suffix}`,
  idempotencyKey: `key-${suffix}`,
  commandId: `command-${suffix}`,
  projectId,
  sceneIndex: 0,
  capability,
  provider: 'Google',
  model: capability === 'image' ? 'imagen' : 'gemini-tts',
  status: 'queued',
  attempts: 1,
  createdAt: Date.now(),
});

const seedProject = async (projectId: string, userId: string): Promise<void> => {
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.firestore().doc(`projects/${projectId}`).set({
      user_id: userId,
    });
  });
};

const clientsFor = (
  userId: string,
): [GenerationJobPersistence, GenerationJobPersistence] => {
  const first = testEnv.authenticatedContext(userId).firestore();
  const second = testEnv.authenticatedContext(userId).firestore();
  type ModularFirestore = Parameters<typeof createFirestoreGenerationJobPersistence>[0];
  const firstDelegate = (first as unknown as { _delegate: ModularFirestore })._delegate;
  const secondDelegate = (second as unknown as { _delegate: ModularFirestore })._delegate;
  return [
    createFirestoreGenerationJobPersistence(firstDelegate),
    createFirestoreGenerationJobPersistence(secondDelegate),
  ];
};

beforeAll(async () => {
  if (!hasFirestoreEmulator) return;
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  if (hasFirestoreEmulator) await testEnv.clearFirestore();
});

afterAll(async () => {
  if (hasFirestoreEmulator) await testEnv.cleanup();
});

firestoreDescribe('cloud-synced generation job persistence', () => {
  it.each(['image', 'audio'] as const)(
    'lets only one authenticated tab claim the same %s job',
    async capability => {
      const projectId = `race-${capability}-${Date.now()}`;
      await seedProject(projectId, 'owner-a');
      const [first, second] = clientsFor('owner-a');
      const job = makeJob(projectId, capability, `${capability}-${Date.now()}`);

      const [firstClaim, secondClaim] = await Promise.all([
        first.claimGenerationJob(job, 'tab-a'),
        second.claimGenerationJob(job, 'tab-b'),
      ]);

      expect([firstClaim.acquired, secondClaim.acquired].filter(Boolean)).toHaveLength(1);
      expect(firstClaim.record.jobId).toBe(secondClaim.record.jobId);
      expect(firstClaim.record.ownerId === 'tab-a' || firstClaim.record.ownerId === 'tab-b')
        .toBe(true);
    },
  );

  it('reclaims an expired lease and fences a stale completion', async () => {
    const projectId = `expiry-${Date.now()}`;
    await seedProject(projectId, 'owner-a');
    const [first, second] = clientsFor('owner-a');
    const job = makeJob(projectId, 'image', `expiry-${Date.now()}`);

    await first.claimGenerationJob(job, 'tab-a');
    await first.updateGenerationJobRecord(
      projectId,
      job.idempotencyKey,
      'tab-a',
      { leaseUntil: Date.now() - 1 },
    );

    const takeover = await second.claimGenerationJob(job, 'tab-b');
    expect(takeover.acquired).toBe(true);
    expect(takeover.record.attempts).toBe(2);

    await expect(
      first.updateGenerationJobRecord(
        projectId,
        job.idempotencyKey,
        'tab-a',
        { status: 'completed', result: { value: 'stale' } },
      ),
    ).resolves.toBeUndefined();

    await second.updateGenerationJobRecord(
      projectId,
      job.idempotencyKey,
      'tab-b',
      { status: 'completed', result: { value: 'shared-result' }, leaseUntil: 0 },
    );
    const restored = await second.getGenerationJobRecord(projectId, job.idempotencyKey);
    expect(restored).toMatchObject({
      ownerId: 'tab-b',
      status: 'completed',
      result: { value: 'shared-result' },
    });
  });

  it("rejects a claim against another user's project", async () => {
    const projectId = `rules-${Date.now()}`;
    await seedProject(projectId, 'owner-a');
    const [attacker] = clientsFor('owner-b');
    const job = makeJob(projectId, 'audio', `rules-${Date.now()}`);

    await expect(attacker.claimGenerationJob(job, 'attacker-tab'))
      .rejects.toMatchObject({ code: 'permission-denied' });

    await testEnv.withSecurityRulesDisabled(async context => {
      const snapshot = await context.firestore()
        .doc(`projects/${projectId}/generation_jobs/${job.idempotencyKey}`)
        .get();
      expect(snapshot.exists).toBe(false);
    });
  });
});