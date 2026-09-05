import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const listeners = new Set<(jobs: any[]) => void>();
  return {
    listeners,
    enqueueVideoBatch: vi.fn(() => 'job-1'),
    subscribe: vi.fn((listener: (jobs: any[]) => void) => {
      listeners.add(listener);
      listener([]);
      return () => listeners.delete(listener);
    }),
    getJob: vi.fn(),
    snapshot: vi.fn(() => []),
    pending: vi.fn(() => []),
    subscribeUploads: vi.fn(() => () => {}),
    resumeAll: vi.fn(),
    resumeInterrupted: vi.fn(),
    autoResumePendingOperations: vi.fn(),
    loadInterruptedFromProjects: vi.fn(),
  };
});

vi.mock('../services/jobManager', () => ({
  jobManager: {
    enqueueVideoBatch: mocks.enqueueVideoBatch,
    subscribe: mocks.subscribe,
    snapshot: mocks.snapshot,
    getJob: mocks.getJob,
    findByProject: vi.fn(),
    rebindCallbacks: vi.fn(),
    resumeInterrupted: mocks.resumeInterrupted,
    resume: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    autoResumePendingOperations: mocks.autoResumePendingOperations,
    loadInterruptedFromProjects: mocks.loadInterruptedFromProjects,
    continueLongWait: vi.fn(),
    abandonLongWait: vi.fn(),
    retryUploadsNow: vi.fn(),
    clearFinished: vi.fn(),
    getConcurrency: vi.fn(() => 2),
    setConcurrency: vi.fn(),
  },
}));

vi.mock('../services/uploadQueue', () => ({
  uploadQueue: {
    subscribe: mocks.subscribeUploads,
    pending: mocks.pending,
    resumeAll: mocks.resumeAll,
  },
}));

import { BrowserJobOrchestrator } from '../services/jobOrchestrator';

const input = {
  projectId: 'project-1',
  projectTitle: 'Project',
  userId: 'user-1',
  scenes: [{ id: 'scene-1' }],
  aspectRatio: '16:9' as const,
};

describe('browser job orchestrator lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.getJob.mockReturnValue(undefined);
    mocks.resumeAll.mockResolvedValue(undefined);
    mocks.resumeInterrupted.mockResolvedValue(null);
    mocks.autoResumePendingOperations.mockResolvedValue(undefined);
    mocks.loadInterruptedFromProjects.mockResolvedValue(undefined);
  });

  it.each(['image', 'audio'] as const)(
    'deduplicates concurrent and completed %s submissions',
    async capability => {
      const orchestrator = new BrowserJobOrchestrator();
      let resolve!: (value: string) => void;
      const provider = vi.fn(() => new Promise<string>(done => { resolve = done; }));
      const command = {
        id: `${capability}-1`,
        projectId: 'project-1',
        sceneId: 'scene-1',
        sceneIndex: 0,
        capability,
        provider: 'Google',
        model: `default-${capability}`,
        input: { prompt: 'same input' },
        execute: provider,
      };
      const firstPromise = orchestrator.submitAssetGeneration(command);
      const duplicatePromise = orchestrator.submitAssetGeneration({ ...command, id: `${capability}-2` });
      expect(provider).toHaveBeenCalledOnce();
      resolve('asset');
      const [first, duplicate] = await Promise.all([firstPromise, duplicatePromise]);
      expect(duplicate.reused).toBe(true);
      orchestrator.acknowledgeAssetPersistence(first.generationJob.jobId);
      const completed = await orchestrator.submitAssetGeneration({ ...command, id: `${capability}-3` });

      expect(duplicate.generationJob.jobId).toBe(first.generationJob.jobId);
      expect(completed.generationJob.jobId).toBe(first.generationJob.jobId);
      expect(completed).toMatchObject({ reused: true });
      expect(completed.value).toBeUndefined();
      expect(provider).toHaveBeenCalledOnce();
    },
  );

  it('retries a transient image failure in the same job and regenerates into a new job', async () => {
    const orchestrator = new BrowserJobOrchestrator();
    const transient = Object.assign(new Error('503 unavailable'), {
      code: 'PROVIDER_TRANSIENT',
      retryable: true,
    });
    const provider = vi.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce('retry-result')
      .mockResolvedValueOnce('regenerated-result');
    const command = {
      id: 'image-attempt-1',
      projectId: 'project-1',
      sceneIndex: 0,
      capability: 'image' as const,
      provider: 'Google',
      model: 'imagen',
      input: { prompt: 'cat' },
      execute: provider,
    };

    await expect(orchestrator.submitAssetGeneration(command)).rejects.toThrow();
    const retried = await orchestrator.submitAssetGeneration({ ...command, id: 'image-attempt-2' });
    const regenerated = await orchestrator.submitAssetGeneration(
      { ...command, id: 'image-regenerate' },
      { explicitRegeneration: true },
    );

    expect(retried.generationJob.attempts).toBe(2);
    expect(regenerated.generationJob.jobId).not.toBe(retried.generationJob.jobId);
    expect(provider).toHaveBeenCalledTimes(3);
  });

  it('keeps explicit regeneration authoritative when the original finishes later', async () => {
    const orchestrator = new BrowserJobOrchestrator();
    let finishOriginal!: (value: string) => void;
    let finishRegeneration!: (value: string) => void;
    const command = {
      id: 'image-original',
      projectId: 'project-1',
      sceneIndex: 0,
      capability: 'image' as const,
      provider: 'Google',
      model: 'imagen',
      input: { prompt: 'cat' },
      execute: () => new Promise<string>(resolve => { finishOriginal = resolve; }),
    };
    const originalPromise = orchestrator.submitAssetGeneration(command);
    const regeneratedPromise = orchestrator.submitAssetGeneration({
      ...command,
      id: 'image-regenerated',
      execute: () => new Promise<string>(resolve => { finishRegeneration = resolve; }),
    }, { explicitRegeneration: true });

    finishRegeneration('new');
    const regenerated = await regeneratedPromise;
    finishOriginal('old');
    const original = await originalPromise;

    expect(orchestrator.isLatestAssetGeneration(regenerated.generationJob.jobId)).toBe(true);
    expect(orchestrator.isLatestAssetGeneration(original.generationJob.jobId)).toBe(false);
  });

  it('rejects an unknown persisted upload job after a newer scoped generation starts', async () => {
    const orchestrator = new BrowserJobOrchestrator();
    const persisted = {
      jobId: 'generation-job-from-prior-session',
      projectId: 'project-1',
      sceneIndex: 0,
      capability: 'audio' as const,
    };
    expect(orchestrator.canPersistAssetGeneration(persisted)).toBe(true);

    await orchestrator.submitAssetGeneration({
      id: 'new-audio-generation',
      projectId: persisted.projectId,
      sceneIndex: persisted.sceneIndex,
      capability: persisted.capability,
      provider: 'Google',
      model: 'default-audio',
      input: { text: 'new audio' },
      execute: async () => 'new',
    }, { explicitRegeneration: true });

    expect(orchestrator.canPersistAssetGeneration(persisted)).toBe(false);
  });

  it('routes equivalent single and batch commands through one browser lifecycle', () => {
    const orchestrator = new BrowserJobOrchestrator();
    const singleInput = { ...input, onlyIndices: [0] };

    expect(orchestrator.submit({
      id: 'command-single',
      capability: 'video',
      input: singleInput,
    })).toBe('job-1');
    expect(orchestrator.batch({
      id: 'command-batch',
      capability: 'video',
      input,
    })).toBe('job-1');
    expect(mocks.enqueueVideoBatch).toHaveBeenCalledOnce();
    expect(mocks.enqueueVideoBatch).toHaveBeenCalledWith(singleInput);
  });

  it('atomically deduplicates concurrent submissions with the same key', async () => {
    const orchestrator = new BrowserJobOrchestrator();
    const command = {
      id: 'command-concurrent',
      capability: 'video' as const,
      provider: 'Google',
      modelId: 'veo',
      input: { ...input, onlyIndices: [0] },
    };

    const [first, second] = await Promise.all([
      orchestrator.submitVideoGeneration(command),
      orchestrator.submitVideoGeneration({ ...command, id: 'command-concurrent-2' }),
    ]);

    expect(mocks.enqueueVideoBatch).toHaveBeenCalledOnce();
    expect(second.runtimeJobId).toBe(first.runtimeJobId);
    expect(second.generationJobs[0].jobId).toBe(first.generationJobs[0].jobId);
    expect(orchestrator.generationSnapshot()).toHaveLength(1);
  });

  it('keeps completed generation identity after runtime jobs are cleared', async () => {
    const orchestrator = new BrowserJobOrchestrator();
    const command = {
      id: 'command-completed',
      capability: 'video' as const,
      input: { ...input, onlyIndices: [0] },
    };
    const first = await orchestrator.submitVideoGeneration(command);
    mocks.listeners.forEach(listener => listener([{
      id: first.runtimeJobId,
      status: 'completed',
      scenes: [{ idx: 0, status: 'done' }],
      startedAt: 1,
      updatedAt: 2,
      endedAt: 2,
    }]));
    orchestrator.clearFinished();
    const duplicate = await orchestrator.submitVideoGeneration({
      ...command,
      id: 'command-after-clear',
    });

    expect(mocks.enqueueVideoBatch).toHaveBeenCalledOnce();
    expect(duplicate.generationJobs[0]).toMatchObject({
      jobId: first.generationJobs[0].jobId,
      status: 'completed',
    });
    await expect(orchestrator.waitForTerminal(duplicate.runtimeJobId)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  it('creates a new intent and job for explicit regeneration', async () => {
    mocks.enqueueVideoBatch
      .mockReturnValueOnce('runtime-1')
      .mockReturnValueOnce('runtime-2');
    const orchestrator = new BrowserJobOrchestrator();
    const command = {
      id: 'command-original',
      capability: 'video' as const,
      input: {
        ...input,
        scenes: [{ id: 'scene-1', video_path: 'https://cdn.example.com/old.mp4' }],
        onlyIndices: [0],
      },
    };
    const original = await orchestrator.submitVideoGeneration(command);
    const regenerated = await orchestrator.submitVideoGeneration(
      { ...command, id: 'command-regenerate' },
      { explicitRegeneration: true },
    );

    expect(mocks.enqueueVideoBatch).toHaveBeenCalledTimes(2);
    expect(regenerated.generationJobs[0].jobId).not.toBe(original.generationJobs[0].jobId);
    expect(regenerated.generationJobs[0].intentId).not.toBe(original.generationJobs[0].intentId);
    expect(mocks.enqueueVideoBatch).toHaveBeenLastCalledWith(expect.objectContaining({
      scenes: [expect.objectContaining({ video_path: undefined })],
    }));
  });

  it('submits only missing scene identities when a batch partially overlaps', async () => {
    mocks.enqueueVideoBatch
      .mockReturnValueOnce('runtime-scene-0')
      .mockReturnValueOnce('runtime-scene-1');
    const orchestrator = new BrowserJobOrchestrator();
    const scenes = [
      { id: 'scene-1', visual_prompt: 'one' },
      { id: 'scene-2', visual_prompt: 'two' },
    ];
    await orchestrator.submitVideoGeneration({
      id: 'command-single-first',
      capability: 'video',
      input: { ...input, scenes, onlyIndices: [0] },
    });
    const batch = await orchestrator.submitVideoGeneration({
      id: 'command-overlapping-batch',
      capability: 'video',
      input: { ...input, scenes, onlyIndices: [0, 1] },
    });

    expect(mocks.enqueueVideoBatch).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueVideoBatch).toHaveBeenLastCalledWith(expect.objectContaining({
      onlyIndices: [1],
    }));
    expect(batch.generationJobs).toHaveLength(2);
    expect(new Set(batch.generationJobs.map(job => job.jobId)).size).toBe(2);
    expect(batch.runtimeJobId).toBe('runtime-scene-1');
  });

  it('links resumed runtime work into the generation job domain view', async () => {
    const resumedRuntime = {
      id: 'runtime-resumed',
      projectId: 'project-1',
      projectTitle: 'Project',
      userId: 'user-1',
      stage: 'video',
      status: 'running',
      total: 1,
      completed: 0,
      failed: 0,
      modelLabel: 'Veo',
      modelId: 'veo',
      provider: 'Google',
      scenes: [{ idx: 0, status: 'running', operationName: 'operations/1' }],
      startedAt: 1,
      updatedAt: 2,
    };
    mocks.resumeInterrupted.mockResolvedValueOnce('runtime-resumed');
    mocks.getJob.mockReturnValueOnce(resumedRuntime);
    const orchestrator = new BrowserJobOrchestrator();

    await expect(orchestrator.resume({
      projectId: 'project-1',
      userId: 'user-1',
    })).resolves.toBe('runtime-resumed');

    expect(orchestrator.findGenerationJob('project-1', 0)).toMatchObject({
      runtimeJobId: 'runtime-resumed',
      status: 'provider_pending',
      providerOperationId: 'operations/1',
    });
  });

  it('relinks an existing generation identity to its resumed runtime', async () => {
    mocks.enqueueVideoBatch.mockReturnValueOnce('runtime-original');
    const orchestrator = new BrowserJobOrchestrator();
    const command = {
      id: 'command-original',
      capability: 'video' as const,
      input: { ...input, onlyIndices: [0] },
    };
    const original = await orchestrator.submitVideoGeneration(command);
    const resumedRuntime = {
      id: 'runtime-resumed',
      projectId: 'project-1',
      projectTitle: 'Project',
      userId: 'user-1',
      stage: 'video',
      status: 'running',
      total: 1,
      completed: 0,
      failed: 0,
      modelLabel: 'Veo',
      scenes: [{ idx: 0, status: 'running', operationName: 'operations/1' }],
      startedAt: 2,
      updatedAt: 3,
    };
    mocks.resumeInterrupted.mockResolvedValueOnce('runtime-resumed');
    mocks.getJob.mockReturnValueOnce(resumedRuntime);

    await orchestrator.resume({ projectId: 'project-1', userId: 'user-1' });
    const duplicate = await orchestrator.submitVideoGeneration({
      ...command,
      id: 'command-after-resume',
    });

    expect(mocks.enqueueVideoBatch).toHaveBeenCalledOnce();
    expect(duplicate.generationJobs[0].jobId).toBe(original.generationJobs[0].jobId);
    expect(duplicate.runtimeJobId).toBe('runtime-resumed');
  });

  it('conservatively locks a recovered scene when original inputs are unavailable', async () => {
    const recoveredRuntime = {
      id: 'runtime-after-reload',
      projectId: 'project-1',
      projectTitle: 'Project',
      userId: 'user-1',
      stage: 'video',
      status: 'running',
      total: 1,
      completed: 0,
      failed: 0,
      modelLabel: 'Veo',
      modelId: 'veo',
      provider: 'Google',
      scenes: [{ idx: 0, status: 'running', operationName: 'operations/recovered' }],
      startedAt: 1,
      updatedAt: 2,
    };
    mocks.snapshot.mockReturnValue([recoveredRuntime]);
    const orchestrator = new BrowserJobOrchestrator();
    await orchestrator.recover('user-1', false);

    const duplicate = await orchestrator.submitVideoGeneration({
      id: 'command-after-reload',
      capability: 'video',
      provider: 'Google',
      modelId: 'veo',
      input: {
        ...input,
        aspectRatio: '9:16',
        scenes: [{ id: 'scene-1', visual_prompt: 'persisted prompt' }],
        onlyIndices: [0],
      },
    });

    expect(mocks.enqueueVideoBatch).not.toHaveBeenCalled();
    expect(duplicate.runtimeJobId).toBe('runtime-after-reload');
  });

  it('releases a conservative recovery lock after recovered work is terminal', async () => {
    const recoveredRuntime = {
      id: 'runtime-recovered-terminal',
      projectId: 'project-1',
      projectTitle: 'Project',
      userId: 'user-1',
      stage: 'video',
      status: 'running',
      total: 1,
      completed: 0,
      failed: 0,
      modelLabel: 'Veo',
      scenes: [{ idx: 0, status: 'running', operationName: 'operations/recovered' }],
      startedAt: 1,
      updatedAt: 2,
    };
    mocks.snapshot.mockReturnValue([recoveredRuntime]);
    const orchestrator = new BrowserJobOrchestrator();
    await orchestrator.recover('user-1', false);
    mocks.listeners.forEach(listener => listener([{
      ...recoveredRuntime,
      status: 'completed',
      completed: 1,
      scenes: [{ idx: 0, status: 'done' }],
      updatedAt: 3,
      endedAt: 3,
    }]));

    const next = await orchestrator.submitVideoGeneration({
      id: 'command-new-input',
      capability: 'video',
      input: {
        ...input,
        scenes: [{ id: 'scene-1', visual_prompt: 'new prompt' }],
        onlyIndices: [0],
      },
    });

    expect(mocks.enqueueVideoBatch).toHaveBeenCalledOnce();
    expect(next.runtimeJobId).toBe('job-1');
  });

  it('retries a retryable failure inside the same generation job', async () => {
    mocks.enqueueVideoBatch
      .mockReturnValueOnce('runtime-1')
      .mockReturnValueOnce('runtime-2');
    const orchestrator = new BrowserJobOrchestrator();
    const command = {
      id: 'command-attempt-1',
      capability: 'video' as const,
      input: { ...input, onlyIndices: [0] },
    };
    const first = await orchestrator.submitVideoGeneration(command);
    mocks.listeners.forEach(listener => listener([{
      id: first.runtimeJobId,
      status: 'failed',
      scenes: [{
        idx: 0,
        status: 'failed',
        error: 'temporarily unavailable',
        generationError: {
          code: 'PROVIDER_TRANSIENT',
          message: 'temporarily unavailable',
          retryable: true,
        },
      }],
      startedAt: 1,
      updatedAt: 2,
      endedAt: 2,
    }]));

    const retried = await orchestrator.submitVideoGeneration({
      ...command,
      id: 'command-attempt-2',
    });
    expect(mocks.enqueueVideoBatch).toHaveBeenCalledTimes(2);
    expect(retried.generationJobs[0]).toMatchObject({
      jobId: first.generationJobs[0].jobId,
      attempts: 2,
      runtimeJobId: 'runtime-2',
    });
  });

  it('requires explicit regeneration after a terminal failure', async () => {
    const orchestrator = new BrowserJobOrchestrator();
    const command = {
      id: 'command-terminal',
      capability: 'video' as const,
      input: { ...input, onlyIndices: [0] },
    };
    const first = await orchestrator.submitVideoGeneration(command);
    mocks.listeners.forEach(listener => listener([{
      id: first.runtimeJobId,
      status: 'failed',
      scenes: [{
        idx: 0,
        status: 'failed',
        error: 'invalid input',
        generationError: {
          code: 'INVALID_INPUT',
          message: 'invalid input',
          retryable: false,
        },
      }],
      startedAt: 1,
      updatedAt: 2,
      endedAt: 2,
    }]));
    const duplicate = await orchestrator.submitVideoGeneration({
      ...command,
      id: 'command-terminal-repeat',
    });
    expect(mocks.enqueueVideoBatch).toHaveBeenCalledOnce();
    expect(duplicate.generationJobs[0].jobId).toBe(first.generationJobs[0].jobId);
  });

  it('replays uploads before operation resume and interrupted hydration', async () => {
    const order: string[] = [];
    mocks.resumeAll.mockImplementation(async () => { order.push('uploads'); });
    mocks.autoResumePendingOperations.mockImplementation(async () => { order.push('operations'); });
    mocks.loadInterruptedFromProjects.mockImplementation(async () => { order.push('interrupted'); });

    await new BrowserJobOrchestrator().recover('user-1', true);

    expect(order).toEqual(['uploads', 'operations', 'interrupted']);
  });

  it('deduplicates repeated recovery callbacks for the same signed-in user', async () => {
    let release!: () => void;
    mocks.resumeAll.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const orchestrator = new BrowserJobOrchestrator();

    const first = orchestrator.recover('user-1', true);
    const repeated = orchestrator.recover('user-1', true);
    expect(repeated).toBe(first);
    expect(mocks.resumeAll).toHaveBeenCalledOnce();
    release();
    await first;
    await orchestrator.recover('user-1', true);

    expect(mocks.resumeAll).toHaveBeenCalledOnce();
    expect(mocks.autoResumePendingOperations).toHaveBeenCalledOnce();
  });

  it('serializes a same-user sign-in after sign-out and invalidates the old recovery', async () => {
    let releaseFirst!: () => void;
    let first = true;
    mocks.resumeAll.mockImplementation(() => {
      if (first) {
        first = false;
        return new Promise<void>(resolve => { releaseFirst = resolve; });
      }
      return Promise.resolve();
    });
    const orchestrator = new BrowserJobOrchestrator();
    const signedOutRecovery = orchestrator.recover('user-1', true);
    orchestrator.resetRecovery('user-1');
    const signedBackInRecovery = orchestrator.recover('user-1', true);

    expect(mocks.resumeAll).toHaveBeenCalledOnce();
    releaseFirst();
    await signedOutRecovery;
    await signedBackInRecovery;

    expect(mocks.resumeAll).toHaveBeenCalledTimes(2);
    expect(mocks.autoResumePendingOperations).toHaveBeenCalledOnce();
    expect(mocks.loadInterruptedFromProjects).toHaveBeenCalledOnce();
  });

  it('continues legacy interrupted recovery when upload replay fails or cloud sync is off', async () => {
    mocks.resumeAll.mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    await new BrowserJobOrchestrator().recover('user-1', false);

    expect(mocks.autoResumePendingOperations).not.toHaveBeenCalled();
    expect(mocks.loadInterruptedFromProjects).toHaveBeenCalledOnce();
  });

  it('reports safe per-stage failures and retries only the failed stage', async () => {
    mocks.autoResumePendingOperations.mockRejectedValueOnce(new Error('private backend detail'));
    const orchestrator = new BrowserJobOrchestrator();
    const states: any[] = [];
    orchestrator.subscribeRecovery('user-1', state => states.push(state));

    await orchestrator.recover('user-1', true);
    expect(states.at(-1)?.failures).toEqual([expect.objectContaining({
      stage: 'operations',
      message: '진행 중이던 생성 작업을 다시 연결하지 못했습니다.',
      retrying: false,
    })]);

    await orchestrator.retryRecovery('user-1', 'operations');
    expect(mocks.resumeAll).toHaveBeenCalledOnce();
    expect(mocks.autoResumePendingOperations).toHaveBeenCalledTimes(2);
    expect(mocks.loadInterruptedFromProjects).toHaveBeenCalledOnce();
    expect(states.at(-1)).toBeNull();
  });

  it('deduplicates retry clicks and clears stale failures when recovery is reset', async () => {
    mocks.resumeAll.mockRejectedValueOnce(new Error('offline'));
    const orchestrator = new BrowserJobOrchestrator();
    const observed = vi.fn();
    orchestrator.subscribeRecovery('user-1', observed);
    await orchestrator.recover('user-1', true);

    let release!: () => void;
    mocks.resumeAll.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const first = orchestrator.retryRecovery('user-1', 'uploads');
    const repeated = orchestrator.retryRecovery('user-1', 'uploads');
    expect(repeated).toBe(first);
    expect(mocks.resumeAll).toHaveBeenCalledTimes(2);

    orchestrator.resetRecovery('user-1');
    expect(observed).toHaveBeenLastCalledWith(null);
    release();
    await first;
    expect(observed).toHaveBeenLastCalledWith(null);
  });

  it('removes its terminal listener exactly once and does not deliver stale progress', async () => {
    const orchestrator = new BrowserJobOrchestrator();
    const observed = vi.fn();
    const waiting = orchestrator.waitForTerminal('job-1', observed);
    expect(mocks.listeners.size).toBe(1);

    const running = { id: 'job-1', status: 'running' };
    const completed = { id: 'job-1', status: 'completed' };
    mocks.listeners.forEach(listener => listener([running]));
    mocks.listeners.forEach(listener => listener([completed]));
    await expect(waiting).resolves.toBe(completed);
    expect(mocks.listeners.size).toBe(0);

    mocks.listeners.forEach(listener => listener([{ id: 'job-1', status: 'failed' }]));
    expect(observed).toHaveBeenCalledTimes(2);
  });

  it('cleans up when subscribe immediately emits a terminal snapshot', async () => {
    mocks.subscribe.mockImplementationOnce((listener: (jobs: any[]) => void) => {
      mocks.listeners.add(listener);
      listener([{ id: 'job-1', status: 'completed' }]);
      return () => mocks.listeners.delete(listener);
    });

    await expect(new BrowserJobOrchestrator().waitForTerminal('job-1')).resolves.toMatchObject({
      status: 'completed',
    });
    expect(mocks.listeners.size).toBe(0);
  });
});