import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectFixture, sceneFixture } from './fixtures/regression';

const getProjectFromCloud = vi.fn();
const generateSceneVideo = vi.fn();
const enqueue = vi.fn().mockResolvedValue('upload-1');

vi.mock('../services/geminiService', () => ({ generateSceneVideo }));
vi.mock('../services/storageService', () => ({
  getProjectFromCloud,
  getAllProjectsFromCloud: vi.fn().mockResolvedValue([]),
  listProjectsWithActiveGenerationRun: vi.fn().mockResolvedValue([]),
  updateProjectFields: vi.fn().mockResolvedValue(undefined),
  updateProjectGenerationRun: vi.fn().mockResolvedValue(undefined),
  sanitizeSceneFieldForFirestore: (_k: string, v: unknown) => v,
  sceneMapKey: (i: number) => String(i).padStart(2, '0'),
}));
vi.mock('../services/mediaCache', () => ({ saveMedia: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/contextPackService', () => ({ listPacks: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/uploadQueue', () => ({
  uploadQueue: {
    subscribe: vi.fn(() => () => {}),
    enqueue,
    retryProjectNow: vi.fn(),
  },
}));

describe('long-running video job resume characterization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['video'], { type: 'video/mp4' }),
    }));
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:local-video') });
  });

  it('reuses the persisted operation handle after reload instead of submitting a second generation', async () => {
    const operation = {
      name: 'operations/veo-existing',
      sceneIdx: 0,
      attempts: 7,
      status: 'pending',
      submittedAt: '2026-01-01T00:00:00.000Z',
    };
    getProjectFromCloud.mockResolvedValue(projectFixture({
      saved_scenes: [sceneFixture({ image_path: 'https://image' })],
      generation_run: {
        status: 'interrupted',
        total: 1,
        completed: 0,
        failed: 0,
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        operations: { '00': operation },
        videoModelId: 'veo-fixture',
        videoProvider: 'google',
      },
    }));
    generateSceneVideo.mockResolvedValue({
      videoUrl: 'https://provider/result.mp4',
      operationName: operation.name,
      pollAttempts: 8,
      stats: {},
    });
    const { jobManager } = await import('../services/jobManager');
    jobManager.setRate('veo-fixture', 100);

    const id = await jobManager.resumeInterrupted({ projectId: 'project-fixture', userId: 'user-fixture' });
    await vi.waitFor(() => expect(generateSceneVideo).toHaveBeenCalled());

    expect(id).toBeTruthy();
    expect(generateSceneVideo.mock.calls[0][9]).toMatchObject({
      existingOperation: { name: 'operations/veo-existing' },
    });
    expect(jobManager.getJob(id!)?.scenes[0]).toMatchObject({
      operationName: 'operations/veo-existing',
      pollAttempts: 7,
      resumed: true,
    });
  });
});