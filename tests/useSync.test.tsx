import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';

vi.mock('../services/storageService', () => ({
  saveProjectToCloud: vi.fn().mockResolvedValue(undefined),
  saveProjectFieldsToCloud: vi.fn().mockResolvedValue(undefined),
  sanitizeSceneForFirestore: (s: any) => s,
  sanitizeSceneFieldForFirestore: (_k: string, v: any) => v,
  sceneMapKey: (i: number) => String(i).padStart(2, '0'),
}));

vi.mock('firebase/firestore', () => ({
  deleteField: () => ({ __delete: true }),
}));

vi.mock('../services/mediaCache', () => ({
  saveProjectMeta: vi.fn().mockResolvedValue(undefined),
}));

import { useSync } from '../components/wizard/hooks/useSync';
import { ProjectStatus } from '../types';

const makeRef = <T,>(v: T) => ({ current: v });

const buildDeps = (overrides: Partial<any> = {}) => ({
  userId: 'u-sync-1',
  projectId: 'proj-sync-1',
  createdAt: '2026-01-01T00:00:00Z',
  aspectRatio: '16:9' as const,
  videoStyle: 'cinematic',
  duration: 30,
  selectedImageModel: 'imagen',
  selectedVideoModel: 'veo',
  useReferenceImage: false,
  sceneDurationMode: 'time' as const,
  targetSceneCount: 5,
  useVeoAudio: false,
  videoMode: 'ai' as const,
  genre: undefined,
  platform: undefined,
  styleSheet: undefined,
  visionCriticEnabled: false,
  qualityThreshold: 0,
  negativePrompt: '',
  captionStyle: { preset: 'none', emphasisColor: '#fff', enableEmoji: false } as any,
  linkedContextPackIdRef: makeRef<string | undefined>(undefined),
  contextPackVersionRef: makeRef<number | undefined>(undefined),
  contextPackDirtyRef: makeRef(false),
  scenesRef: makeRef([
    { scene_number: 1, visual_prompt: 'a', image_path: 'data:image/png;base64,XX' },
    { scene_number: 2, visual_prompt: 'b' },
  ] as any[]),
  stepRef: makeRef(4),
  maxStepRef: makeRef(4),
  topicRef: makeRef('my topic'),
  scriptRef: makeRef('hello world'),
  thumbnailRef: makeRef<string | undefined>(undefined),
  characterProfileRef: makeRef(''),
  statsRef: makeRef({ imagesGenerated: 1 } as any),
  characterReferenceImageRef: makeRef<string | undefined>(undefined),
  characterReferencesRef: makeRef([]),
  creativeBriefRef: makeRef<Record<string, any>>({}),
  savedModeRef: makeRef<'quick' | 'pro' | null>('pro'),
  syncPendingRef: makeRef(false),
  blobUrlsRef: makeRef(new Set<string>()),
  syncCleanupRef: makeRef<(() => void) | null>(null),
  setSyncing: vi.fn(),
  setSyncError: vi.fn(),
  ...overrides,
});

describe('useSync immediate local backup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('writes latest step + scenes to localStorage synchronously, before the cloud debounce fires', () => {
    const deps = buildDeps();
    const { result } = renderHook(() => useSync(deps as any));
    const sync = result.current;

    act(() => {
      sync(5, [
        { scene_number: 1, visual_prompt: 'a', image_path: 'data:image/png;base64,YY' },
        { scene_number: 2, visual_prompt: 'b', image_path: 'https://cdn/img2' },
        { scene_number: 3, visual_prompt: 'c' },
      ] as any);
    });

    // The cloud-debounce timer (1500ms) has NOT fired yet.
    const raw = localStorage.getItem('vibe_video_backup_proj-sync-1');
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw!);
    expect(stored.id).toBe('proj-sync-1');
    expect(stored.saved_step).toBe(5);
    expect(stored.saved_max_step).toBe(5);
    expect(stored.saved_scenes).toHaveLength(3);
    // Non-http media paths must be replaced by sentinels in the local copy.
    expect(stored.saved_scenes[0].image_path).toBe('[local-image]');
    expect(stored.saved_scenes[1].image_path).toBe('https://cdn/img2');
    // visual_prompt is stripped from localStorage to keep size small.
    expect(stored.saved_scenes[0].visual_prompt).toBeUndefined();
  });
});
