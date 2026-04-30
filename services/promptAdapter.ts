import type { Scene, StyleSheet } from '../types';

export type AdapterTarget = 'gemini-image' | 'veo' | 'generic-cinematic';

export interface ModelCapability {
  supportsNegativePrompt: boolean;
  preferredStyle: 'descriptive' | 'tag-list' | 'natural';
}

export interface AdapterInput {
  shot: Partial<Scene>;
  styleSheet?: StyleSheet;
  characterProfile?: string;
  negativePrompt?: string;
  visualStyle?: string;
  aspectRatio?: string;
  audioScript?: string;
  previousSceneContext?: string;
  sceneIndex?: number;
  hasReferenceImage?: boolean;
}

export interface AdapterOutput {
  prompt: string;
  negativePrompt?: string;
  capability: ModelCapability;
}

const CAPABILITY: Record<AdapterTarget, ModelCapability> = {
  'gemini-image': { supportsNegativePrompt: true, preferredStyle: 'descriptive' },
  veo: { supportsNegativePrompt: true, preferredStyle: 'natural' },
  'generic-cinematic': { supportsNegativePrompt: false, preferredStyle: 'descriptive' },
};

function targetForModel(provider?: string, modelId?: string): AdapterTarget {
  const p = (provider || '').toLowerCase();
  const m = (modelId || '').toLowerCase();
  if (p.includes('google') || p.includes('nanobanana') || m.includes('gemini') || m.includes('nano-banana')) {
    return m.includes('veo') ? 'veo' : 'gemini-image';
  }
  if (m.includes('veo')) return 'veo';
  return 'generic-cinematic';
}

function serializeStyleSheet(s?: StyleSheet): string {
  if (!s) return '';
  const palette = (s.palette || []).filter(Boolean).join(', ');
  const parts: string[] = [];
  if (palette) parts.push(`color palette: ${palette}`);
  if (s.lighting) parts.push(`lighting: ${s.lighting}`);
  if (s.mood) parts.push(`mood: ${s.mood}`);
  if (s.tone) parts.push(`tone: ${s.tone}`);
  return parts.join('; ');
}

function serializeShot(shot: Partial<Scene>): string {
  const bits: string[] = [];
  if (shot.shotType) bits.push(`${shot.shotType} shot`);
  if (shot.cameraMovement && shot.cameraMovement !== 'static') bits.push(`camera ${shot.cameraMovement}`);
  if (shot.lighting) bits.push(`scene lighting: ${shot.lighting}`);
  if (shot.beatRole) bits.push(`role in story: ${shot.beatRole}`);
  if (shot.durationSec) bits.push(`approx ${shot.durationSec}s`);
  return bits.join(', ');
}

function buildGeminiImagePrompt(input: AdapterInput): string {
  const { shot, styleSheet, characterProfile, visualStyle, aspectRatio, hasReferenceImage } = input;
  const styleStr = serializeStyleSheet(styleSheet);
  const shotStr = serializeShot(shot);
  const visual = shot.visual_prompt || '';
  const lines = [
    'Generate an image. High quality cinematic digital art, 8k, detailed textures.',
    hasReferenceImage ? 'IMPORTANT — A reference image of the main character is attached. The generated image MUST depict the SAME character as in the reference: identical face, hair, body type, clothing, and overall identity. Place this character into the new scene described below; do not invent a different person.' : '',
    `Scene: ${visual}`,
    visualStyle ? `Visual style: ${visualStyle}.` : '',
    aspectRatio ? `Aspect ratio: ${aspectRatio}.` : '',
    shotStr ? `Cinematography: ${shotStr}.` : '',
    styleStr ? `Project style sheet — ${styleStr}.` : '',
    characterProfile ? `Main character (must match exactly): ${characterProfile}.` : '',
  ].filter(Boolean);
  return lines.join(' ');
}

function buildVeoPrompt(input: AdapterInput): string {
  const { shot, styleSheet, characterProfile, audioScript, previousSceneContext, sceneIndex } = input;
  const styleStr = serializeStyleSheet(styleSheet);
  const shotStr = serializeShot(shot);
  const visual = shot.visual_prompt || '';

  const lines = [
    `Cinematic smooth motion, high quality: ${visual}`,
    shotStr ? `Cinematography: ${shotStr}.` : '',
    styleStr ? `Style sheet — ${styleStr}.` : '',
  ];

  if (previousSceneContext && sceneIndex !== undefined && sceneIndex > 0) {
    lines.push(
      `[Scene continuity - Scene ${sceneIndex + 1}]: This scene follows directly from the previous scene. Previous scene: "${previousSceneContext}". Start this scene as a natural continuation — maintain visual flow, environment consistency, and smooth transition from the previous action. Do NOT reset or repeat the opening of the previous scene.`,
    );
  }
  if (characterProfile) lines.push(`[Main character - must match exactly]: ${characterProfile}`);
  if (audioScript) lines.push(`[Narration/dialogue for this scene]: ${audioScript}`);

  return lines.filter(Boolean).join('\n\n');
}

function buildGenericPrompt(input: AdapterInput): string {
  const { shot, styleSheet, characterProfile, visualStyle } = input;
  const tags: string[] = [];
  if (shot.visual_prompt) tags.push(shot.visual_prompt);
  if (visualStyle) tags.push(visualStyle);
  const shotStr = serializeShot(shot);
  if (shotStr) tags.push(shotStr);
  const styleStr = serializeStyleSheet(styleSheet);
  if (styleStr) tags.push(styleStr);
  if (characterProfile) tags.push(`character: ${characterProfile}`);
  tags.push('cinematic', '8k', 'high detail');
  return tags.join(', ');
}

export function buildPrompt(
  input: AdapterInput,
  provider?: string,
  modelId?: string,
): AdapterOutput {
  const target = targetForModel(provider, modelId);
  const capability = CAPABILITY[target];

  let prompt = '';
  if (target === 'gemini-image') prompt = buildGeminiImagePrompt(input);
  else if (target === 'veo') prompt = buildVeoPrompt(input);
  else prompt = buildGenericPrompt(input);

  const neg = (input.negativePrompt || input.shot.negativePrompt || '').trim();
  return {
    prompt,
    negativePrompt: capability.supportsNegativePrompt && neg ? neg : undefined,
    capability,
  };
}

export function targetFor(provider?: string, modelId?: string): AdapterTarget {
  return targetForModel(provider, modelId);
}
