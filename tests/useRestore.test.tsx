import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../services/storageService', () => ({
  getProjectFromCloud: vi.fn().mockResolvedValue(undefined),
  getFirestoreHealthInfo: () => ({ disabled: false, reason: null, status: null, projectId: null }),
}));

vi.mock('../services/geminiService', () => ({
  migrateSceneFields: (s: any[]) => s,
}));

vi.mock('../services/sampleProject', () => ({
  isSampleProjectId: () => false,
}));

vi.mock('../services/captionService', () => ({
  DEFAULT_CAPTION_STYLE: { preset: 'none', emphasisColor: '#fff', enableEmoji: false },
}));

import { useRestore } from '../components/wizard/hooks/useRestore';
import { saveMedia, saveProjectMeta } from '../services/mediaCache';
import { ProjectStatus } from '../types';

const makeRef = <T,>(v: T) => ({ current: v });

const buildDeps = (initialProjectId: string) => {
  const state: Record<string, any> = {
    step: 1, maxStep: 1, scenes: [],
  };
  const setter = (key: string) => (v: any) => {
    state[key] = typeof v === 'function' ? v(state[key]) : v;
  };
  const noop = () => {};
  return {
    state,
    deps: {
      userId: 'u-restore-1',
      initialProjectId,
      projectId: initialProjectId,
      setLoading: noop, setLoadingMessage: noop,
      setProjectId: noop, setCreatedAt: noop, setTopic: noop, setAspectRatio: noop,
      setVideoStyle: noop,
      setStep: setter('step'),
      setMaxStep: setter('maxStep'),
      setSavedMode: noop, setScript: noop, setDuration: noop, setThumbnail: noop,
      setCharacterProfile: noop, setUseReferenceImage: noop, setCharacterReferenceImage: noop,
      setCharacterReferences: noop, setSceneDurationMode: noop, setTargetSceneCount: noop,
      setUseVeoAudio: noop, setVideoMode: noop, setSelectedImageModel: noop,
      setSelectedVideoModel: noop, setGenre: noop, setPlatform: noop, setStyleSheet: noop,
      setVisionCriticEnabled: noop, setQualityThreshold: noop, setNegativePrompt: noop,
      setStats: noop, setCaptionStyle: noop, setLinkedContextPackId: noop,
      setContextPackVersion: noop, setContextPackDirty: noop,
      setScenes: setter('scenes'),
      characterReferencesRef: makeRef([]),
      statsRef: makeRef({}),
      trackBlobUrl: noop,
    } as any,
  };
};

describe('useRestore legacy IDB recovery', () => {
  beforeEach(async () => {
    // Reset fake-IndexedDB between tests.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('vibe_video_media');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it('restores legacy project (saved_max_step=1) up to Step 5 when IDB has image media', async () => {
    const projectId = 'proj-legacy-1';
    // Seed IDB with a corrupted-looking project meta + 3 scenes worth of
    // image media (mimicking the post-Firestore-403 scenario).
    await saveProjectMeta(projectId, {
      id: projectId,
      user_id: 'u-restore-1',
      title: 'legacy',
      aspect_ratio: '16:9',
      style_template: 'default',
      status: ProjectStatus.DRAFT,
      created_at: '2026-01-01',
      saved_step: 1,
      saved_max_step: 1,
      saved_scenes: [], // legacy corruption: scenes lost
    });
    for (let i = 0; i < 3; i++) {
      await saveMedia(projectId, i, 'image', 'data:image/png;base64,AAAA');
    }

    const { state, deps } = buildDeps(projectId);

    renderHook(() => useRestore(deps));

    await waitFor(() => {
      expect(state.scenes.length).toBe(3);
    }, { timeout: 3000 });

    expect(state.maxStep).toBeGreaterThanOrEqual(5);
    expect(state.step).toBe(5);
    expect(state.scenes.every((s: any) => s.image_path)).toBe(true);

    // The healed snapshot is also written back to localStorage so the next
    // reload doesn't regress to step=1.
    const healedRaw = localStorage.getItem(`vibe_video_backup_${projectId}`);
    expect(healedRaw).toBeTruthy();
    const healed = JSON.parse(healedRaw!);
    expect(healed.saved_max_step).toBeGreaterThanOrEqual(5);
    expect(healed.saved_step).toBe(5);
    expect(healed.saved_scenes).toHaveLength(3);
  });
});
