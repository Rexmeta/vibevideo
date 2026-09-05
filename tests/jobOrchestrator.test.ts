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
    resumeInterrupted: vi.fn(),
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
    mocks.autoResumePendingOperations.mockResolvedValue(undefined);
    mocks.loadInterruptedFromProjects.mockResolvedValue(undefined);
  });

  it('routes single and batch commands through the same browser lifecycle', () => {
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
    expect(mocks.enqueueVideoBatch).toHaveBeenNthCalledWith(1, singleInput);
    expect(mocks.enqueueVideoBatch).toHaveBeenNthCalledWith(2, input);
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