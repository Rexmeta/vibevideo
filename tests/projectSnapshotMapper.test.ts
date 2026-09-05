import { describe, expect, it } from 'vitest';
import { buildSampleProject } from '../services/sampleProject';
import {
  areProjectDtosEquivalent,
  legacyProjectToSnapshot,
  normalizeLegacyProject,
  parseLegacyProjectSnapshot,
  snapshotToLegacyProject,
} from '../services/projectSnapshotMapper';
import { ProjectStatus } from '../types';

const richFixture = {
  id: 'remix-1',
  user_id: 'user-1',
  title: 'Remix',
  aspect_ratio: '9:16',
  style_template: 'cinematic',
  status: ProjectStatus.PROCESSING,
  created_at: '2026-01-01T00:00:00.000Z',
  saved_step: 5,
  saved_max_step: 6,
  saved_mode: 'pro',
  selected_image_model: 'imagen-4',
  selected_video_model: 'veo-3',
  selected_text_model: 'gemini-pro',
  remix_source: {
    url: 'https://youtube.test/watch?v=1',
    title: 'Original',
    characters: [],
    backgrounds: [],
  },
  generation_run: {
    id: 'run-1',
    status: 'long-wait',
    stage: 'video',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
    total: 2,
    completed: 1,
    failed: 0,
    operations: {},
  },
  saved_scenes: [
    {
      id: 'scene-b',
      project_id: 'remix-1',
      scene_number: 2,
      script_segment: '사용자 대사',
      image_path: '[local-image]',
      audio_path: null,
      presentation: { transition: 'fade', transitionDuration: 0.5, motion: 'zoom-in' },
      video_meta: {
        modelId: 'veo-3',
        provider: 'google',
        seedSource: 'scene-image',
        uploadStatus: 'pending-upload',
        operationName: 'operations/1',
      },
      legacy_provider_field: { keep: true },
    },
    {
      id: 'scene-a',
      project_id: 'remix-1',
      scene_number: 1,
      script_segment: '두 번째 배열 장면',
      video_path: 'https://cdn.test/video.mp4',
    },
  ],
};

describe('project snapshot mapper', () => {
  it('round-trips rich remix, presentation, run and media metadata without reordering', () => {
    const snapshot = legacyProjectToSnapshot(richFixture);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.scenes.map(s => s.id)).toEqual(['scene-b', 'scene-a']);
    expect(snapshot.scenes.map(s => s.order)).toEqual([0, 1]);

    const dto = snapshotToLegacyProject(snapshot) as any;
    expect(dto.saved_scenes[0].script_segment).toBe('사용자 대사');
    expect(dto.saved_scenes[0].image_path).toBe('[local-image]');
    expect(dto.saved_scenes[0].audio_path).toBeNull();
    expect(dto.saved_scenes[0].video_meta.operationName).toBe('operations/1');
    expect(dto.saved_scenes[0].legacy_provider_field).toEqual({ keep: true });
    expect(dto.generation_run.status).toBe('long-wait');
    expect(dto.selected_text_model).toBe('gemini-pro');
  });

  it('normalizes versionless legacy scenes with deterministic identity', () => {
    const dto = normalizeLegacyProject({
      id: 'legacy-1',
      user_id: 'user-1',
      title: 'Legacy',
      created_at: '2020-01-01',
      saved_scenes: [{ audio_script: 'old script', image_path: '[local-image]' }],
    });
    expect(dto.version).toBeUndefined();
    expect(dto.status).toBe(ProjectStatus.DRAFT);
    expect(dto.aspect_ratio).toBe('16:9');
    expect(dto.saved_scenes?.[0]).toMatchObject({
      id: 'legacy-1-scene-1',
      project_id: 'legacy-1',
      scene_number: 1,
      script_segment: 'old script',
      image_path: '[local-image]',
    });
  });

  it('preserves omitted/null scene collections and zero scene numbers', () => {
    const omitted = snapshotToLegacyProject(legacyProjectToSnapshot({
      id: 'omitted-scenes',
      user_id: 'user-1',
      created_at: '2020-01-01',
    }));
    expect(Object.prototype.hasOwnProperty.call(omitted, 'saved_scenes')).toBe(false);

    const nullable = snapshotToLegacyProject(legacyProjectToSnapshot({
      id: 'null-scenes',
      user_id: 'user-1',
      created_at: '2020-01-01',
      saved_scenes: null,
    })) as any;
    expect(nullable.saved_scenes).toBeNull();

    const zero = normalizeLegacyProject({
      id: 'zero-scene',
      user_id: 'user-1',
      created_at: '2020-01-01',
      saved_scenes: [{ scene_number: 0 }],
    });
    expect(zero.saved_scenes?.[0].scene_number).toBe(0);
  });

  it('validates malformed documents without throwing from safe parse', () => {
    const result = parseLegacyProjectSnapshot({ title: 'missing identity' });
    expect(result.success).toBe(false);
    expect(result.issues.map(i => i.path)).toEqual(['id', 'user_id']);
  });

  it('drops unsafe field types, keeps contiguous order and makes duplicate legacy IDs unique', () => {
    const result = parseLegacyProjectSnapshot({
      id: 'legacy-unsafe',
      user_id: 'user-1',
      created_at: '2020-01-01',
      saved_scenes: [
        {
          id: 'duplicate',
          scene_number: 1,
          script_segment: 'a',
          image_path: 123,
          captionWords: [null, { text: 'valid', startMs: 0, endMs: 100 }],
        },
        'not-a-scene',
        { id: 'duplicate', scene_number: 1, script_segment: 'b', video_path: false },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.scenes.map(s => s.order)).toEqual([0, 1]);
    expect(new Set(result.data.scenes.map(s => s.id)).size).toBe(2);
    expect(result.data.scenes[0].image_path).toBeUndefined();
    expect(result.data.scenes[0].captionWords).toEqual([
      { text: 'valid', startMs: 0, endMs: 100 },
    ]);
    expect(result.data.scenes[1].video_path).toBeUndefined();
    expect(result.issues.map(i => i.path)).toContain('saved_scenes[0].image_path');
    expect(result.issues.map(i => i.path)).toContain('saved_scenes[2].id');
    expect(result.issues.map(i => i.path)).toContain('saved_scenes[0].captionWords[0]');
  });

  it('removes malformed nested run and caption data before consumers can dereference it', () => {
    const dto = normalizeLegacyProject({
      id: 'nested-unsafe',
      user_id: 'user-1',
      created_at: '2020-01-01',
      caption_style: { preset: 'clean', emphasisColor: 123, enableEmoji: 'yes' },
      generation_run: { id: 'run', status: 'running', stage: 'video', total: 'two' },
      saved_scenes: [{
        script_segment: 'safe',
        presentation: { transition: 'fade', transitionDuration: 'slow', motion: 'zoom-in' },
        video_meta: { operationName: 123, costUsd: 'expensive', resumed: 'yes' },
        captionWords: [null, { text: 'bad', startMs: 0, endMs: 'later' }],
      }],
    }) as any;
    expect(dto.generation_run).toBeUndefined();
    expect(dto.caption_style).toEqual({ preset: 'clean' });
    expect(dto.saved_scenes[0].captionWords).toEqual([]);
    expect(dto.saved_scenes[0].presentation.transitionDuration).toBeUndefined();
    expect(dto.saved_scenes[0].video_meta).toEqual({});
  });

  it('keeps the sample project compatible through the canonical boundary', () => {
    const sample = buildSampleProject('sample-user');
    const roundTrip = snapshotToLegacyProject(legacyProjectToSnapshot(sample));
    expect(areProjectDtosEquivalent(sample, roundTrip)).toBe(true);
    expect(roundTrip.saved_scenes?.map(s => s.id)).toEqual(['sample-scene-1', 'sample-scene-2']);
  });
});