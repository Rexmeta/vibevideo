import { vi } from 'vitest';

export const sceneFixture = (overrides: Record<string, unknown> = {}) => ({
  scene_number: 1,
  visual_prompt: 'A deterministic scene',
  script_segment: 'hello deterministic world',
  audio_duration: 4,
  ...overrides,
});

export const projectFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 'project-fixture',
  user_id: 'user-fixture',
  title: 'Fixture project',
  aspect_ratio: '16:9',
  style_template: 'cinematic',
  status: 'draft',
  created_at: '2026-01-01T00:00:00.000Z',
  saved_step: 5,
  saved_max_step: 5,
  saved_scenes: [sceneFixture()],
  ...overrides,
});

export const stateSetter = (state: Record<string, unknown>, key: string) =>
  vi.fn((value: unknown) => {
    state[key] = typeof value === 'function'
      ? (value as (previous: unknown) => unknown)(state[key])
      : value;
  });
