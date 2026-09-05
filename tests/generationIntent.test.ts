import { describe, expect, it } from 'vitest';
import {
  createGenerationIntent,
  createVideoGenerationFingerprint,
  stableSerialize,
} from '../services/generationIntent';

const base = {
  projectId: 'project-1',
  sceneId: 'scene-1',
  sceneIndex: 0,
  provider: 'Google',
  model: 'veo-model',
  scene: {
    id: 'scene-1',
    project_id: 'project-1',
    script_segment: 'hello',
    visual_prompt: 'a cat walking',
    image_path: 'https://cdn.example.com/seed.png?token=temporary',
  },
  aspectRatio: '16:9',
};

describe('video generation intent identity', () => {
  it('creates the same fingerprint and idempotency key for equivalent input', () => {
    const reordered = {
      ...base,
      scene: {
        visual_prompt: 'a cat walking',
        script_segment: 'hello',
        project_id: 'project-1',
        id: 'scene-1',
        image_path: 'https://cdn.example.com/seed.png?token=another-token',
      },
    };

    expect(createVideoGenerationFingerprint(base)).toBe(
      createVideoGenerationFingerprint(reordered),
    );
    expect(createGenerationIntent(base).idempotencyKey).toBe(
      createGenerationIntent(reordered).idempotencyKey,
    );
  });

  it('ignores callbacks, output state and temporary blob URL identity', () => {
    const first = {
      ...base,
      scene: {
        ...base.scene,
        image_path: 'blob:first',
        video_path: 'https://cdn.example.com/output-a.mp4',
        qualityScore: { overall: 10 },
      },
      onProgress: () => undefined,
    };
    const second = {
      ...base,
      scene: {
        ...base.scene,
        image_path: 'blob:second',
        video_path: 'https://cdn.example.com/output-b.mp4',
        qualityScore: { overall: 90 },
      },
      onProgress: () => console.log('ignored'),
    };
    expect(createVideoGenerationFingerprint(first)).toBe(
      createVideoGenerationFingerprint(second),
    );
  });

  it.each([
    ['prompt', { scene: { ...base.scene, visual_prompt: 'a dog walking' } }],
    ['model', { model: 'another-model' }],
    ['provider', { provider: 'AnotherProvider' }],
    ['aspect ratio', { aspectRatio: '9:16' }],
  ])('changes identity for a different %s', (_label, change) => {
    const changed = { ...base, ...change };
    expect(createGenerationIntent(changed).idempotencyKey).not.toBe(
      createGenerationIntent(base).idempotencyKey,
    );
  });

  it('uses a new key only for an explicit regeneration', () => {
    const original = createGenerationIntent(base);
    const regenerate = createGenerationIntent({ ...base, explicitRegeneration: true });
    expect(regenerate.intentId).not.toBe(original.intentId);
    expect(regenerate.idempotencyKey).not.toBe(original.idempotencyKey);
  });

  it('keeps content version query parameters while ignoring signed access tokens', () => {
    const versionOne = {
      ...base,
      scene: { ...base.scene, image_path: 'https://cdn.example.com/seed.png?version=1&token=a' },
    };
    const versionTwo = {
      ...base,
      scene: { ...base.scene, image_path: 'https://cdn.example.com/seed.png?version=2&token=b' },
    };
    expect(createVideoGenerationFingerprint(versionOne)).not.toBe(
      createVideoGenerationFingerprint(versionTwo),
    );
  });

  it('hashes only the effective audio text selected by the runtime', () => {
    const first = {
      ...base,
      scene: { ...base.scene, script_segment: 'spoken text', audio_script: 'unused A' },
    };
    const second = {
      ...base,
      scene: { ...base.scene, script_segment: 'spoken text', audio_script: 'unused B' },
    };
    expect(createVideoGenerationFingerprint(first)).toBe(
      createVideoGenerationFingerprint(second),
    );
  });

  it('serializes object keys deterministically', () => {
    expect(stableSerialize({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableSerialize({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
});
