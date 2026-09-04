import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { uploadFileToCloud, updateProjectFields } = vi.hoisted(() => ({
  uploadFileToCloud: vi.fn(),
  updateProjectFields: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/storageService', () => ({ uploadFileToCloud, updateProjectFields }));

describe('durable upload retry characterization', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useRealTimers();
    vi.clearAllMocks();
    await new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase('vibe_upload_queue');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  });

  it('persists a failed upload, exposes retry telemetry, then patches the scene after manual retry', async () => {
    uploadFileToCloud
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('https://cdn.example/scene.mp4');
    const { uploadQueue: firstLifecycle } = await import('../services/uploadQueue');
    const events: any[] = [];
    const unsubscribe = firstLifecycle.subscribe(e => events.push(e));

    const id = await firstLifecycle.enqueue({
      projectId: 'project-fixture',
      userId: 'user-fixture',
      sceneIdx: 2,
      destPath: 'video.mp4',
      blob: new Blob(['video']),
    });
    await waitFor(() => {
      expect(firstLifecycle.pendingForProject('project-fixture')[0]?.status).toBe('failed');
    });

    expect(firstLifecycle.pendingForProject('project-fixture')[0]).toMatchObject({
      id, status: 'failed', attempts: 1, lastError: 'offline',
    });
    expect(events).toContainEqual(expect.objectContaining({ status: 'failed', attempts: 1, error: 'offline' }));
    unsubscribe();

    // Simulate a page reload: a fresh module instance has no hot in-memory
    // snapshot and must discover the pending Blob from IndexedDB.
    vi.resetModules();
    const { uploadQueue: restoredLifecycle } = await import('../services/uploadQueue');
    const restoredEvents: any[] = [];
    const unsubscribeRestored = restoredLifecycle.subscribe(e => restoredEvents.push(e));
    await restoredLifecycle.resumeAll();
    expect(restoredLifecycle.pendingForProject('project-fixture')[0]).toMatchObject({
      id, status: 'failed', attempts: 1,
    });
    expect(restoredEvents).toContainEqual(expect.objectContaining({
      id, status: 'failed', attempts: 1,
    }));

    restoredLifecycle.retryNow(id);
    await waitFor(() => {
      expect(restoredEvents.some(e => e.status === 'done')).toBe(true);
    });

    expect(restoredEvents).toContainEqual(expect.objectContaining({
      status: 'done', attempts: 2, finalUrl: 'https://cdn.example/scene.mp4',
    }));
    expect(updateProjectFields).toHaveBeenCalledWith('project-fixture', expect.objectContaining({
      'saved_scenes_map.02.video_path': 'https://cdn.example/scene.mp4',
      'saved_scenes_map.02.video_meta.uploadStatus': 'ok',
    }));
    unsubscribeRestored();

    // A third lifecycle sees no work: success removed the durable entry.
    vi.resetModules();
    const { uploadQueue: settledLifecycle } = await import('../services/uploadQueue');
    await settledLifecycle.resumeAll();
    expect(settledLifecycle.pendingForProject('project-fixture')).toEqual([]);
  });
});
