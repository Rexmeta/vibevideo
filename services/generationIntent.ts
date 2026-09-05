import type { Scene } from '../types';

export interface VideoGenerationIntentInput {
  projectId: string;
  sceneId?: string;
  sceneIndex: number;
  provider: string;
  model: string;
  scene: Partial<Scene>;
  previousScenePrompt?: string;
  aspectRatio: string;
  characterProfile?: string;
  styleSheet?: unknown;
  negativePrompt?: string;
  characterReferenceImage?: string;
  explicitRegeneration?: boolean;
}

export type GenerationIntentCapability = 'video' | 'image' | 'audio';

export interface AssetGenerationIntentInput {
  projectId: string;
  sceneId?: string;
  sceneIndex: number;
  capability: 'image' | 'audio';
  provider: string;
  model: string;
  input: unknown;
  explicitRegeneration?: boolean;
}

export interface GenerationIntent {
  intentId: string;
  projectId: string;
  sceneId?: string;
  capability: GenerationIntentCapability;
  provider: string;
  model: string;
  inputHash: string;
  idempotencyKey: string;
  explicitRegeneration: boolean;
  createdAt: number;
}

let intentSequence = 0;
let regenerationSequence = 0;

const transientKeys = new Set([
  'audio_path',
  'audioGenerationJobId',
  'captionWords',
  'generationError',
  'imageGenerationJobId',
  'pollAttempts',
  'progress',
  'qualityNotes',
  'qualityScore',
  'updated_at',
  'video_meta',
  'video_path',
]);

const normalizeUrl = (value: string): string => {
  if (value.startsWith('blob:')) return '[temporary-blob]';
  if (value.startsWith('data:')) return `data:${stableHash(value)}`;
  try {
    const url = new URL(value);
    const transientParam = /^(token|signature|expires|x-goog-|x-amz-|googleaccessid)/i;
    const stableParams = Array.from(url.searchParams.entries())
      .filter(([name]) => !transientParam.test(name))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = stableParams.length > 0
      ? `?${new URLSearchParams(stableParams).toString()}`
      : '';
    return `${url.origin}${url.pathname}${query}`;
  } catch {
    return value;
  }
};

const canonicalize = (
  value: unknown,
  key?: string,
  excludedKeys: ReadonlySet<string> = transientKeys,
): unknown => {
  if (value === undefined || typeof value === 'function' || excludedKeys.has(key || '')) {
    return undefined;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return normalizeUrl(value);
  if (Array.isArray(value)) {
    return value
      .map(item => canonicalize(item, undefined, excludedKeys))
      .filter(item => item !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const entryKey of Object.keys(value as Record<string, unknown>).sort()) {
      const normalized = canonicalize(
        (value as Record<string, unknown>)[entryKey],
        entryKey,
        excludedKeys,
      );
      if (normalized !== undefined) out[entryKey] = normalized;
    }
    return out;
  }
  return String(value);
};

export const stableSerialize = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

/**
 * Stable, synchronous FNV-1a hash. Cryptographic resistance is unnecessary:
 * this is an in-browser identity key, not a security boundary.
 */
export const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const createVideoGenerationFingerprint = (
  input: VideoGenerationIntentInput,
): string => {
  const scene = input.scene;
  return stableHash(stableSerialize({
    projectId: input.projectId,
    sceneId: input.sceneId,
    sceneIndex: input.sceneIndex,
    capability: 'video',
    provider: input.provider,
    model: input.model,
    scene: {
      visualPrompt: scene.visual_prompt,
      audioScript: scene.script_segment || scene.audio_script,
      imageSource: scene.image_path,
      shotType: scene.shotType,
      cameraMovement: scene.cameraMovement,
      lighting: scene.lighting,
      durationSec: scene.durationSec,
      beatRole: scene.beatRole,
      transitionTo: scene.transitionTo,
      negativePrompt: scene.negativePrompt,
      characters: scene.characters,
      seedPreference: scene.videoSeedPreference,
    },
    previousScenePrompt: input.previousScenePrompt,
    aspectRatio: input.aspectRatio,
    characterProfile: input.characterProfile,
    styleSheet: input.styleSheet,
    negativePrompt: input.negativePrompt,
    characterReferenceImage: input.characterReferenceImage,
  }));
};

export const createGenerationIntent = (
  input: VideoGenerationIntentInput,
): GenerationIntent => {
  const inputHash = createVideoGenerationFingerprint(input);
  const regenerationRevision = input.explicitRegeneration
    ? `regenerate-${++regenerationSequence}`
    : 'initial';
  const idempotencyKey = stableHash(stableSerialize({
    projectId: input.projectId,
    sceneId: input.sceneId,
    sceneIndex: input.sceneIndex,
    capability: 'video',
    provider: input.provider,
    model: input.model,
    inputHash,
    regenerationRevision,
  }));
  return {
    intentId: `intent-video-${++intentSequence}`,
    projectId: input.projectId,
    sceneId: input.sceneId,
    capability: 'video',
    provider: input.provider,
    model: input.model,
    inputHash,
    idempotencyKey,
    explicitRegeneration: input.explicitRegeneration === true,
    createdAt: Date.now(),
  };
};

export const createAssetGenerationFingerprint = (
  input: AssetGenerationIntentInput,
): string => {
  const outputKeys = new Set(transientKeys);
  outputKeys.add('image_path');
  return stableHash(JSON.stringify(canonicalize({
    projectId: input.projectId,
    sceneId: input.sceneId,
    sceneIndex: input.sceneIndex,
    capability: input.capability,
    provider: input.provider,
    model: input.model,
    input: input.input,
  }, undefined, outputKeys)));
};

export const createAssetGenerationIntent = (
  input: AssetGenerationIntentInput,
): GenerationIntent => {
  const inputHash = createAssetGenerationFingerprint(input);
  const regenerationRevision = input.explicitRegeneration
    ? `regenerate-${++regenerationSequence}`
    : 'initial';
  const idempotencyKey = stableHash(stableSerialize({
    projectId: input.projectId,
    sceneId: input.sceneId,
    sceneIndex: input.sceneIndex,
    capability: input.capability,
    provider: input.provider,
    model: input.model,
    inputHash,
    regenerationRevision,
  }));
  return {
    intentId: `intent-${input.capability}-${++intentSequence}`,
    projectId: input.projectId,
    sceneId: input.sceneId,
    capability: input.capability,
    provider: input.provider,
    model: input.model,
    inputHash,
    idempotencyKey,
    explicitRegeneration: input.explicitRegeneration === true,
    createdAt: Date.now(),
  };
};
