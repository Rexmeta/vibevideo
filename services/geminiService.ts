
import { GoogleGenAI, Modality, Type, type Part } from "@google/genai";
import { Scene, StyleSheet, GenreId, CharacterReference } from "../types";
import { getEffectiveApiKey, getGoogleApiKey } from "./apiKeyService";
import { getGenre, getPlatform, type PlatformPreset } from "./presets";
import { buildPrompt as buildModelPrompt } from "./promptAdapter";
import { critiqueImage, buildRefineHint } from "./visionCritic";
import type { QualityScore, PlatformId } from "../types";

const MISSING_API_KEY_MESSAGE = 'API 키가 설정되지 않았습니다. 관리 페이지에서 API 키를 설정해주세요.';

const getApiKey = (): string => {
  const key = getGoogleApiKey();
  if (!key) {
    console.warn("[API Key] No Google API key configured (provider key missing and process.env.API_KEY not set).");
    return "";
  }
  return key;
};

const requireApiKey = (): string => {
  const key = getApiKey();
  if (!key) {
    throw new Error(MISSING_API_KEY_MESSAGE);
  }
  return key;
};

const getApiKeyForModel = (modelId?: string, provider?: string, useGlobalFallback?: boolean): string => {
  if (useGlobalFallback) {
    return getApiKey();
  }
  if (modelId || provider) {
    const effectiveKey = getEffectiveApiKey(modelId || '', provider || '');
    if (effectiveKey) {
      console.log(`[API Key] Using per-model/provider key for ${provider}/${modelId}`);
      return effectiveKey;
    }
  }
  return getApiKey();
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms / 1000}초)`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 1, label: string = ''): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      const errStr = String(e?.message || '') + String(e?.status || '');
      const is429 = errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED');
      const isRetryable = is429 ||
                          errStr.includes('시간 초과') || 
                          errStr.includes('timeout') ||
                          errStr.includes('DEADLINE_EXCEEDED') ||
                          errStr.includes('503') ||
                          errStr.includes('500');
      if (attempt < maxRetries && isRetryable) {
        let retryAfter = 0;
        if (e?.headers?.get) {
          try { retryAfter = parseInt(e.headers.get('retry-after') || '0', 10) * 1000; } catch {}
        }
        const baseDelay = is429 ? 60000 : 5000;
        const delay = retryAfter || Math.min(baseDelay * Math.pow(2, attempt), 180000);
        console.log(`[Retry] ${label} attempt ${attempt + 1} failed (${is429 ? '429 rate limit' : errStr.slice(0, 50)}), retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

async function urlToBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("URL to Base64 conversion failed:", error);
    throw error;
  }
}

function sanitizeTextForTTS(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/#/g, '')
    .replace(/[`_~]/g, '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .trim();
}

async function pcmToWav(pcmBase64: string, sampleRate: number = 24000): Promise<{ dataUrl: string, duration: number }> {
  try {
    const binaryString = atob(pcmBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const duration = len / (sampleRate * 2);

    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + len, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); 
    view.setUint16(22, 1, true); 
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, len, true);
    
    const blob = new Blob([wavHeader, bytes], { type: 'audio/wav' });
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string));
      reader.readAsDataURL(blob);
    });

    return { dataUrl, duration };
  } catch (e) {
    console.error("PCM to WAV failed", e);
    return { dataUrl: `data:audio/wav;base64,${pcmBase64}`, duration: 0 };
  }
}

export interface ScriptOutline {
  hook: string;
  beats: string[];
  cta?: string;
}

export interface GenerateScriptOptions {
  genre?: GenreId;
  platform?: PlatformId;
}

const OUTLINE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    hook: { type: Type.STRING },
    beats: { type: Type.ARRAY, items: { type: Type.STRING } },
    cta: { type: Type.STRING },
  },
  required: ['hook', 'beats'],
} as const;

function describePlatform(p?: PlatformPreset): string {
  if (!p) return '';
  return `Target platform: ${p.label} (${p.aspectRatio}, ~${p.recommendedDurationSec}s, hook intensity: ${p.hookIntensity}).`;
}

export const generateScriptOutline = async (
  topic: string,
  style: string,
  lengthSeconds: number,
  sceneCount: number,
  options: GenerateScriptOptions = {},
): Promise<ScriptOutline> => {
  const ai = new GoogleGenAI({ apiKey: requireApiKey() });
  const genre = getGenre(options.genre);
  const platform = getPlatform(options.platform);

  const sys = [
    'You are a video script director. Output a tight outline as JSON.',
    genre ? genre.systemHint : 'Default to a clear story arc.',
    `Structure: ${genre?.structure || 'Hook → Body → Close'}.`,
    describePlatform(platform),
    `Beats: produce exactly ${sceneCount} beats (one per ~8s scene).`,
    `Hook strategy: ${genre?.hookStrategy || 'Open with a curiosity-inducing line.'} The hook MUST be a single, attention-grabbing sentence (a question, shocking stat, or bold claim).`,
    genre?.hasCTA ? 'Include a single concrete CTA at the end.' : 'CTA is optional; only include if it strengthens the close.',
  ].filter(Boolean).join(' ');

  const prompt = `Topic: "${topic}"\nVisual style hint: ${style}\nGoal duration: ${lengthSeconds}s.\n\nReturn JSON: { hook: string, beats: string[${sceneCount}], cta?: string }. The first beat must implement the hook.`;

  const response = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${sys}\n\n${prompt}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: OUTLINE_SCHEMA as any,
      },
    }),
    60000,
    '스크립트 아웃라인 생성',
  );
  try {
    const parsed = JSON.parse(response.text || '{}');
    return {
      hook: String(parsed.hook || '').trim(),
      beats: Array.isArray(parsed.beats) ? parsed.beats.map((b: any) => String(b).trim()).filter(Boolean) : [],
      cta: parsed.cta ? String(parsed.cta).trim() : undefined,
    };
  } catch (e) {
    console.warn('[Outline] JSON parse failed, returning empty outline');
    return { hook: '', beats: [] };
  }
};

export const generateScript = async (
  topic: string,
  style: string,
  lengthSeconds: number = 60,
  sceneCount?: number,
  options: GenerateScriptOptions = {},
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: requireApiKey() });
  const targetSceneCount = sceneCount && sceneCount > 0 ? sceneCount : Math.max(2, Math.round(lengthSeconds / 8));
  const genre = getGenre(options.genre);
  const platform = getPlatform(options.platform);

  // Pass 1: outline
  let outline: ScriptOutline | null = null;
  try {
    outline = await generateScriptOutline(topic, style, lengthSeconds, targetSceneCount, options);
  } catch (e) {
    console.warn('[Script] Outline generation failed, falling back to single-pass:', e);
  }

  // Pass 2: full script grounded in the outline
  const sys = [
    'You are an expert video script writer. Produce ONLY the spoken script — no scene numbers, no stage directions, no markdown.',
    genre ? genre.systemHint : '',
    describePlatform(platform),
    'The very first sentence MUST be a strong hook that pattern-interrupts the viewer (a question, surprising fact, or bold claim).',
    `Plan exactly ${targetSceneCount} scenes (~8 seconds of spoken text per scene). Pace the language so it can be cleanly split scene-by-scene.`,
  ].filter(Boolean).join(' ');

  let outlineBlock = '';
  if (outline && outline.beats.length > 0) {
    outlineBlock = `\n\nOutline to follow strictly:\n- HOOK: ${outline.hook}\n${outline.beats.map((b, i) => `- Beat ${i + 1}: ${b}`).join('\n')}${outline.cta ? `\n- CTA: ${outline.cta}` : ''}`;
  }

  const userPrompt = `Topic: "${topic}". Visual style cue: ${style}. Goal duration: ${lengthSeconds}s.${outlineBlock}\n\nWrite the spoken script now. The first sentence is the hook.`;

  const response = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${sys}\n\n${userPrompt}`,
    }),
    60000,
    '스크립트 생성',
  );
  return response.text || 'Script generation failed.';
};

const SHOT_TYPES = ['wide', 'medium', 'close-up', 'extreme-close-up', 'over-shoulder', 'pov', 'aerial', 'establishing'] as const;
const CAMERA_MOVEMENTS = ['static', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'dolly-in', 'dolly-out', 'tracking', 'handheld', 'crane'] as const;
const BEAT_ROLES = ['hook', 'setup', 'development', 'payoff', 'cta'] as const;

const SHOTLIST_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      script_segment: { type: Type.STRING },
      visual_prompt: { type: Type.STRING },
      shotType: { type: Type.STRING },
      cameraMovement: { type: Type.STRING },
      lighting: { type: Type.STRING },
      durationSec: { type: Type.NUMBER },
      beatRole: { type: Type.STRING },
      transitionTo: { type: Type.STRING },
      characters: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['script_segment', 'visual_prompt'],
  },
} as const;

function pickEnum<T extends string>(value: any, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  const hit = allowed.find(a => a === v);
  return (hit as T) || fallback;
}

export const segmentScriptIntoScenes = async (
  script: string,
  style: string,
  ratio: string,
  characterProfile?: string,
  sceneCount?: number,
  options: { genre?: GenreId; platform?: PlatformId; characterReferences?: CharacterReference[] } = {},
): Promise<Partial<Scene>[]> => {
  const ai = new GoogleGenAI({ apiKey: requireApiKey() });
  const charInstruction = characterProfile
    ? `\n\nIMPORTANT - Main Character Description (must appear consistently in EVERY scene's visual_prompt): ${characterProfile}. Always describe this exact same character in each visual_prompt to maintain visual consistency across all scenes.`
    : '';
  const sceneCountInstruction = sceneCount ? `exactly ${sceneCount}` : '3-5';
  const genre = getGenre(options.genre);
  const platform = getPlatform(options.platform);

  const namedCast = (options.characterReferences || []).filter(c => c && c.name && c.name.trim());
  const castNames = namedCast.map(c => c.name.trim());
  const castInstruction = namedCast.length > 0
    ? `\n\nNAMED CAST (use these EXACT names — pick which appear in each shot):\n${namedCast.map(c => `- "${c.name}"${c.description ? `: ${c.description}` : ''}`).join('\n')}\n\nFor EACH shot also output:\n- characters: array of names (subset of [${castNames.map(n => `"${n}"`).join(', ')}]) that visibly appear in this shot. Empty array if none of the named characters appear. Never invent names that are not in the cast list.`
    : '';

  const prompt = `Segment this script into ${sceneCountInstruction} cinematic shots for a ${ratio} video. Each shot is approximately 8 seconds. Style: ${style}.${charInstruction}${castInstruction}

For EACH shot output a full shot card with:
- script_segment: the spoken text in this shot
- visual_prompt: a vivid one-paragraph description of what we see
- shotType: one of ${SHOT_TYPES.join(' | ')}
- cameraMovement: one of ${CAMERA_MOVEMENTS.join(' | ')}
- lighting: short phrase (e.g. "soft golden hour", "neon backlight")
- durationSec: approximate seconds (default 8)
- beatRole: one of ${BEAT_ROLES.join(' | ')} — the FIRST shot MUST be "hook"${genre?.hasCTA ? ', the LAST shot SHOULD be "cta"' : ''}
- transitionTo: one of none|fade|fadeblack|wipeleft|wiperight|slideleft|slideright|circleopen|smoothleft|smoothright (transition INTO the next shot; use "none" for the last shot)

Vary shotType across shots to keep visual rhythm. ${platform ? `Target platform ${platform.label} (${platform.aspectRatio}).` : ''}

Output JSON array. Script: "${script}"`;

  const response = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: SHOTLIST_SCHEMA as any,
      },
    }),
    60000,
    '씬 분석',
  );

  const data = JSON.parse(response.text || '[]');
  const validCastNames = new Set(castNames);
  return (Array.isArray(data) ? data : []).map((item: any, index: number) => {
    const beatRole = pickEnum(item.beatRole, BEAT_ROLES, index === 0 ? 'hook' : 'development');
    const out: Partial<Scene> = {
      id: `scene-${index}`,
      script_segment: String(item.script_segment || '').trim(),
      visual_prompt: String(item.visual_prompt || '').trim(),
      shotType: pickEnum(item.shotType, SHOT_TYPES, index === 0 ? 'wide' : 'medium'),
      cameraMovement: pickEnum(item.cameraMovement, CAMERA_MOVEMENTS, 'static'),
      lighting: typeof item.lighting === 'string' ? item.lighting : 'natural cinematic lighting',
      durationSec: typeof item.durationSec === 'number' && item.durationSec > 0 ? Math.round(item.durationSec) : 8,
      beatRole: index === 0 ? 'hook' : beatRole,
      transitionTo: typeof item.transitionTo === 'string' ? (item.transitionTo as any) : 'fade',
    };
    if (validCastNames.size > 0 && Array.isArray(item.characters)) {
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of item.characters) {
        if (typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (!trimmed) continue;
        // Match case-insensitively against the cast and re-emit canonical name
        const canonical = castNames.find(n => n.toLowerCase() === trimmed.toLowerCase());
        if (canonical && !seen.has(canonical)) {
          seen.add(canonical);
          cleaned.push(canonical);
        }
      }
      if (cleaned.length > 0) out.characters = cleaned;
    }
    return out;
  });
};

const STYLE_SHEET_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    palette: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    lighting: { type: Type.STRING },
    mood: { type: Type.STRING },
    tone: { type: Type.STRING },
  },
  required: ['palette', 'lighting', 'mood'],
} as const;

export const generateStyleSheet = async (
  topic: string,
  script: string,
  visualStyle: string,
  options: { genre?: GenreId } = {},
): Promise<StyleSheet> => {
  const ai = new GoogleGenAI({ apiKey: requireApiKey() });
  const genre = getGenre(options.genre);
  const sys = `You are an art director defining the visual style sheet for a short video. Output a tight JSON object. Palette must be exactly 5 hex colors (#RRGGBB) that look harmonious together. Lighting and mood are short phrases (max 8 words each).`;
  const user = `Topic: "${topic}"\nGenre: ${genre?.label || 'general'}\nVisual style: ${visualStyle}\nScript excerpt: ${script.slice(0, 600)}\n\nReturn JSON: { palette: string[5], lighting: string, mood: string, tone?: string }.`;

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `${sys}\n\n${user}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: STYLE_SHEET_SCHEMA as any,
        },
      }),
      45000,
      'StyleSheet 생성',
    );
    const parsed = JSON.parse(response.text || '{}');
    const palette = Array.isArray(parsed.palette) ? parsed.palette.map((c: any) => String(c)).filter((c: string) => /^#?[0-9a-fA-F]{6}$/.test(c.replace('#', ''))).map((c: string) => c.startsWith('#') ? c : `#${c}`).slice(0, 5) : [];
    return {
      palette: palette.length === 5 ? palette : ['#1a1a2e', '#16213e', '#0f3460', '#e94560', '#f5f5f5'].slice(0, palette.length || 5),
      lighting: String(parsed.lighting || 'cinematic key light with soft fill').trim(),
      mood: String(parsed.mood || 'modern, polished').trim(),
      tone: parsed.tone ? String(parsed.tone).trim() : undefined,
    };
  } catch (e) {
    console.warn('[StyleSheet] generation failed, using defaults:', e);
    return {
      palette: ['#1a1a2e', '#16213e', '#0f3460', '#e94560', '#f5f5f5'],
      lighting: 'cinematic key light with soft fill',
      mood: 'modern, polished',
    };
  }
};

// Legacy compatibility shim: ensure scenes loaded from old projects have the
// new shot-list fields without breaking anything.
export function migrateSceneFields(scenes: Partial<Scene>[]): Partial<Scene>[] {
  return (scenes || []).map((s, i) => ({
    ...s,
    shotType: s.shotType || (i === 0 ? 'wide' : 'medium'),
    cameraMovement: s.cameraMovement || 'static',
    lighting: s.lighting || 'natural cinematic lighting',
    durationSec: s.durationSec || 8,
    beatRole: s.beatRole || (i === 0 ? 'hook' : 'development'),
    transitionTo: s.transitionTo || (i === 0 ? 'fade' : 'fade'),
  }));
}

export const generateSceneAudio = async (text: string, style: string): Promise<{ audio_path: string, duration: number } | null> => {
  const voiceMap: Record<string, string> = { 'Cute Stickman': 'Puck', 'Japanese Anime': 'Kore' };
  const selectedVoice = voiceMap[style] || 'Kore';
  const cleanText = sanitizeTextForTTS(text);
  if (!cleanText) return null;

  const apiKey = requireApiKey();

  console.log(`[TTS] 오디오 생성 시작 - voice: ${selectedVoice}, text length: ${cleanText.length}`);

  return withRetry(async () => {
    const ai = new GoogleGenAI({ apiKey });
    const response = await withTimeout(
      ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } } },
        },
      }),
      45000,
      '오디오 생성'
    );
    
    const audioPart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!audioPart?.inlineData?.data) {
      throw new Error('오디오 데이터가 생성되지 않았습니다.');
    }
    
    const { dataUrl, duration } = await pcmToWav(audioPart.inlineData.data);
    return { audio_path: dataUrl, duration };
  }, 1, '오디오 생성');
};

const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const GOOGLE_IMAGE_PROVIDERS = ['Google', 'NanoBanana'];

const NANO_BANANA_ALIASES: Record<string, string> = {
  'nano-banana-pro': 'gemini-3-pro-image-preview',
  'nano-banana': 'gemini-2.5-flash-image',
};

export interface NamedReferenceImage {
  name?: string;
  description?: string;
  image: string; // data URL, http URL, or raw base64
}

export interface GenerateImageOptions {
  scene?: Partial<Scene>;
  styleSheet?: StyleSheet;
  negativePrompt?: string;
  visionCritic?: boolean;
  qualityThreshold?: number;
  extraHint?: string;
  referenceImage?: string; // data URL, http URL, or raw base64 (single "main" character)
  referenceImages?: NamedReferenceImage[]; // additional named character references
}

interface RefImagePart {
  base64: string;
  mimeType: string;
}

async function normalizeReferenceImage(source?: string): Promise<RefImagePart | undefined> {
  if (!source) return undefined;
  try {
    if (source.startsWith('data:')) {
      const m = source.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!m) return undefined;
      return { mimeType: m[1], base64: m[2] };
    }
    if (source.startsWith('http')) {
      const resp = await fetch(source);
      if (!resp.ok) throw new Error(`reference fetch failed: ${resp.status}`);
      const blob = await resp.blob();
      const mimeType = blob.type || 'image/jpeg';
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { mimeType, base64 };
    }
    // raw base64
    return { mimeType: 'image/png', base64: source };
  } catch (e) {
    console.warn('[ReferenceImage] normalize failed:', e);
    return undefined;
  }
}

export interface GenerationStats {
  imagesGenerated: number;
  criticCalls: number;
  refineCalls: number;
}

export interface GenerateImageResult {
  base64: string;
  mimeType: string;
  qualityScore?: QualityScore;
  stats: GenerationStats;
}

export interface GenerateVideoResult {
  videoUrl: string;
  stats: GenerationStats & { videosGenerated: number };
}

async function callImageModel(
  apiKey: string,
  actualModel: string,
  promptText: string,
  referenceImages?: RefImagePart[],
): Promise<{ base64: string; mimeType: string }> {
  const ai = new GoogleGenAI({ apiKey });
  const parts: Part[] = [];
  for (const ref of referenceImages || []) {
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });
  }
  parts.push({ text: promptText });
  const response = await withTimeout(
    ai.models.generateContent({
      model: actualModel,
      contents: [{ parts }],
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    }),
    60000,
    '이미지 생성',
  );
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData && part.inlineData.data) {
      const mimeType = part.inlineData.mimeType || 'image/png';
      return { base64: part.inlineData.data, mimeType };
    }
  }
  throw new Error('이미지 데이터가 생성되지 않았습니다.');
}

export const generateSceneImage = async (
  prompt: string,
  style: string,
  aspectRatio: string = '16:9',
  modelId?: string,
  provider?: string,
  characterProfile?: string,
  options: GenerateImageOptions = {},
): Promise<GenerateImageResult | null> => {
  const isGeminiCompatible = !provider || GOOGLE_IMAGE_PROVIDERS.includes(provider);
  let actualModel = (modelId && isGeminiCompatible) ? modelId : GEMINI_IMAGE_MODEL;
  const isFallback = !isGeminiCompatible;

  if (provider === 'NanoBanana' && modelId && NANO_BANANA_ALIASES[modelId]) {
    const mapped = NANO_BANANA_ALIASES[modelId];
    console.log(`[Image] NanoBanana alias resolved: ${modelId} → ${mapped}`);
    actualModel = mapped;
  }

  const apiKey = isFallback ? getApiKey() : getApiKeyForModel(modelId, provider);
  if (!apiKey) {
    throw new Error(MISSING_API_KEY_MESSAGE);
  }

  if (isFallback) {
    console.warn(`[Image] Provider "${provider}" (model: ${modelId}) is not yet integrated. Using Gemini fallback: ${GEMINI_IMAGE_MODEL}`);
  }

  // Normalize reference images: main first, then named characters
  const mainRefImage = await normalizeReferenceImage(options.referenceImage);
  const namedRefs: { meta: { name?: string; description?: string }; part: RefImagePart }[] = [];
  for (const r of options.referenceImages || []) {
    if (!r || !r.image) continue;
    const part = await normalizeReferenceImage(r.image);
    if (part) namedRefs.push({ meta: { name: r.name, description: r.description }, part });
  }
  const allRefParts: RefImagePart[] = [];
  if (mainRefImage) allRefParts.push(mainRefImage);
  for (const n of namedRefs) allRefParts.push(n.part);

  // Build adapter input
  const sceneShot: Partial<Scene> = options.scene
    ? { ...options.scene, visual_prompt: options.scene.visual_prompt || prompt }
    : { visual_prompt: prompt };
  const adapter = buildModelPrompt(
    {
      shot: sceneShot,
      styleSheet: options.styleSheet,
      characterProfile,
      negativePrompt: options.negativePrompt,
      visualStyle: style,
      aspectRatio,
      hasReferenceImage: !!mainRefImage,
      attachedCharacterRefs: namedRefs.length > 0
        ? namedRefs.map(n => ({ name: n.meta.name || 'unnamed', description: n.meta.description }))
        : undefined,
      namedCharacters: namedRefs.length > 0
        ? namedRefs.map(n => ({ name: n.meta.name || 'unnamed', description: n.meta.description }))
        : undefined,
    },
    provider,
    modelId,
  );
  let promptText = adapter.prompt;
  if (adapter.negativePrompt) {
    promptText += `\n\nAvoid (negative prompt): ${adapter.negativePrompt}.`;
  }
  if (options.extraHint) {
    promptText += `\n\n[Director note] ${options.extraHint}`;
  }

  console.log(`[Image] 이미지 생성 시작 - requested: ${modelId || 'default'}, actual: ${actualModel}, provider: ${provider || 'Google'}, prompt: ${promptText.length}chars, refs: ${allRefParts.length} (main:${mainRefImage ? 'y' : 'n'}, named:${namedRefs.length})`);

  return withRetry(async () => {
    const stats: GenerationStats = { imagesGenerated: 0, criticCalls: 0, refineCalls: 0 };
    const first = await callImageModel(apiKey, actualModel, promptText, allRefParts);
    stats.imagesGenerated += 1;

    const useCritic = options.visionCritic !== false; // default ON
    const threshold = typeof options.qualityThreshold === 'number' ? options.qualityThreshold : 6;
    if (!useCritic) {
      return { base64: first.base64, mimeType: first.mimeType, stats };
    }

    // Critic still uses the single most-relevant reference (main first, else first named)
    const criticRef = mainRefImage || namedRefs[0]?.part;

    let score: QualityScore | null = null;
    try {
      stats.criticCalls += 1;
      score = await critiqueImage({
        imageBase64: first.base64,
        mimeType: first.mimeType,
        intentPrompt: prompt,
        characterProfile,
        styleSheet: options.styleSheet,
        referenceImageBase64: criticRef?.base64,
        referenceImageMimeType: criticRef?.mimeType,
      });
    } catch (e) {
      console.warn('[Image] Critic call failed, returning first image:', e);
    }

    if (!score || score.overall >= threshold) {
      return { base64: first.base64, mimeType: first.mimeType, qualityScore: score || undefined, stats };
    }

    console.log(`[Image] Quality score ${score.overall}/10 below threshold ${threshold}, refining...`);
    const refinePrompt = `${promptText}\n\n[Director note] ${buildRefineHint(score)}`;
    stats.refineCalls += 1;
    try {
      const refined = await callImageModel(apiKey, actualModel, refinePrompt, allRefParts);
      stats.imagesGenerated += 1;
      let refinedScore: QualityScore | null = null;
      try {
        stats.criticCalls += 1;
        refinedScore = await critiqueImage({
          imageBase64: refined.base64,
          mimeType: refined.mimeType,
          intentPrompt: prompt,
          characterProfile,
          styleSheet: options.styleSheet,
          referenceImageBase64: criticRef?.base64,
          referenceImageMimeType: criticRef?.mimeType,
        });
      } catch {}
      const finalScore = refinedScore && refinedScore.overall >= score.overall ? refinedScore : score;
      const better = refinedScore && refinedScore.overall >= score.overall ? refined : first;
      return { base64: better.base64, mimeType: better.mimeType, qualityScore: { ...finalScore!, refined: true }, stats };
    } catch (refineErr) {
      console.warn('[Image] Refine generation failed, returning first:', refineErr);
      return { base64: first.base64, mimeType: first.mimeType, qualityScore: score, stats };
    }
  }, 1, '이미지 생성');
};

async function resizeImageForVideo(imageSource: string, maxDim: number = 768): Promise<{ imageBytes: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas context failed')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64 = dataUrl.split(',')[1];
      resolve({ imageBytes: base64, mimeType: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('Image load failed for resize'));
    img.crossOrigin = 'anonymous';
    if (imageSource.startsWith('data:') || imageSource.startsWith('http')) {
      img.src = imageSource;
    } else {
      img.src = `data:image/png;base64,${imageSource}`;
    }
  });
}

async function attemptVideoGeneration(
  prompt: string, 
  apiKey: string, 
  validRatio: '16:9' | '9:16', 
  imageData?: { imageBytes: string; mimeType: string },
  label: string = '',
  videoModel: string = VEO_MODEL
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const payload: any = {
    model: videoModel,
    prompt: `Cinematic smooth motion, high quality: ${prompt}`,
    config: { numberOfVideos: 1, resolution: '720p', aspectRatio: validRatio }
  };

  if (imageData) {
    payload.image = { imageBytes: imageData.imageBytes, mimeType: imageData.mimeType };
    console.log(`[Video Gen][${label}] With seed image (${imageData.mimeType}, ${Math.round(imageData.imageBytes.length / 1024)}KB)`);
  } else {
    console.log(`[Video Gen][${label}] Text-only (no seed image)`);
  }

  console.log(`[Video Gen][${label}] Calling generateVideos API...`);
  let operation: any;
  try {
    operation = await ai.models.generateVideos(payload);
  } catch (submitErr: any) {
    console.error(`[Video Gen][${label}] generateVideos() threw:`, submitErr?.message || submitErr, JSON.stringify(submitErr).slice(0, 500));
    throw submitErr;
  }

  console.log(`[Video Gen][${label}] Operation received. done=${operation.done}, name=${(operation as any).name || 'N/A'}`);

  if (operation.done) {
    console.log(`[Video Gen][${label}] Operation completed immediately. Checking response...`);
    const opStr = JSON.stringify(operation).slice(0, 1000);
    console.log(`[Video Gen][${label}] Operation data: ${opStr}`);
  }

  let attempts = 0;
  const maxAttempts = 40;
  const pollInterval = 15000;
  let consecutivePollErrors = 0;

  while (!operation.done && attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, pollInterval));
    try {
      const aiPoll = new GoogleGenAI({ apiKey });
      operation = await aiPoll.operations.getVideosOperation({ operation });
      consecutivePollErrors = 0;
      console.log(`[Video Gen][${label}] Poll #${attempts}: done=${operation.done}`);
    } catch (pollErr: any) {
      consecutivePollErrors++;
      const msg = pollErr?.message || String(pollErr);
      console.warn(`[Video Gen][${label}] Poll #${attempts} error (consecutive: ${consecutivePollErrors}):`, msg);
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        await new Promise(r => setTimeout(r, 20000));
      }
      if (consecutivePollErrors >= 5) {
        throw new Error(`폴링 중 연속 ${consecutivePollErrors}회 오류`);
      }
    }
    attempts++;
  }

  if (!operation.done) {
    throw new Error(`비디오 생성 시간 초과 (${attempts} polls, ~${Math.round(attempts * pollInterval / 60000)}분)`);
  }

  const opResult = JSON.stringify(operation).slice(0, 1500);
  console.log(`[Video Gen][${label}] Final operation: ${opResult}`);

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) {
    const errMsg = (operation as any).error?.message || 
                   (operation as any).response?.error?.message || '';
    console.error(`[Video Gen][${label}] No video URI. Error: ${errMsg}`);
    throw new Error(errMsg || '비디오 URI 없음');
  }

  const separator = downloadLink.includes('?') ? '&' : '?';
  console.log(`[Video Gen][${label}] SUCCESS! URI obtained.`);
  return `${downloadLink}${separator}key=${apiKey}`;
}

const VEO_MODEL = 'veo-3.1-fast-generate-preview';

const GOOGLE_VIDEO_PROVIDERS = ['Google'];

// 이미지 쪽 NANO_BANANA_ALIASES 와 같은 안전망: Firestore/localStorage/관리자 입력 등으로
// 마케팅 별칭("veo-3.1" 등) 이 들어와도 호출 직전에 실제 Generative AI Preview API ID 로 보정.
// 이렇게 해야 modelService 의 마이그레이션이 적용되기 전 캐시된 값으로도 404 가 나지 않는다.
const VEO_ALIASES: Record<string, string> = {
  'veo-3.1': 'veo-3.1-fast-generate-preview',
  'veo-3.1-fast': 'veo-3.1-fast-generate-preview',
  'veo-3.1-preview': 'veo-3.1-fast-generate-preview',
  'veo-3': 'veo-3.1-fast-generate-preview',
  'veo-3-fast': 'veo-3.1-fast-generate-preview',
};

export interface GenerateVideoOptions {
  scene?: Partial<Scene>;
  styleSheet?: StyleSheet;
  negativePrompt?: string;
  referenceImage?: string; // project-level character reference (data URL, http URL, or raw base64)
}

export const generateSceneVideo = async (
  prompt: string,
  imageSource?: string,
  aspectRatio: string = '16:9',
  modelId?: string,
  provider?: string,
  audioScript?: string,
  characterProfile?: string,
  previousSceneContext?: string,
  sceneIndex?: number,
  options: GenerateVideoOptions = {},
): Promise<GenerateVideoResult | null> => {
  const validRatio: '16:9' | '9:16' = (aspectRatio === '9:16' || aspectRatio === '3:4') ? '9:16' : '16:9';
  const isGoogleProvider = !provider || GOOGLE_VIDEO_PROVIDERS.includes(provider);
  let actualModel = (modelId && isGoogleProvider) ? modelId : VEO_MODEL;
  const isFallback = !isGoogleProvider;

  if (isGoogleProvider && modelId && VEO_ALIASES[modelId]) {
    const mapped = VEO_ALIASES[modelId];
    console.log(`[Video Gen] Veo alias resolved: ${modelId} → ${mapped}`);
    actualModel = mapped;
  }

  // 별칭 보정 후 실제 API ID 로 키를 찾는다. 관리자가 실제 API ID 로 per-model 키를
  // 등록한 경우에도 캐시된 별칭이 들어오면 일치하도록 한다.
  const apiKey = isFallback ? getApiKey() : getApiKeyForModel(actualModel, provider);
  if (!apiKey) throw new Error(MISSING_API_KEY_MESSAGE);

  if (isFallback) {
    console.warn(`[Video Gen] Provider "${provider}" (model: ${modelId}) is not yet integrated. Using Google Veo fallback: ${VEO_MODEL}`);
  }
  console.log(`[Video Gen] Requested: ${modelId || 'default'}, actual: ${actualModel}, provider: ${provider || 'Google'}`);

  // Prefer the per-scene generated image as seed. If absent, fall back to the
  // project-level locked character reference image so Veo still locks identity
  // instead of going text-only.
  const effectiveSeedSource = imageSource || options.referenceImage;
  const seedFromReference = !imageSource && !!options.referenceImage;

  let imageData: { imageBytes: string; mimeType: string } | undefined;
  if (effectiveSeedSource) {
    try {
      imageData = await resizeImageForVideo(effectiveSeedSource, 768);
      console.log(`[Video Gen] Seed image resized → ${imageData.mimeType}, ${Math.round(imageData.imageBytes.length / 1024)}KB${seedFromReference ? ' (from character reference)' : ''}`);
    } catch (resizeErr) {
      console.warn("[Video Gen] Image resize failed:", resizeErr);
      try {
        let imageBytes: string;
        let mimeType = 'image/jpeg';
        if (effectiveSeedSource.startsWith('data:')) {
          const m = effectiveSeedSource.match(/^data:(image\/[a-z+]+);base64,/);
          if (m) mimeType = m[1];
          imageBytes = effectiveSeedSource.replace(/^data:image\/[a-z+]+;base64,/, "");
        } else if (effectiveSeedSource.startsWith('http')) {
          imageBytes = await urlToBase64(effectiveSeedSource);
        } else {
          imageBytes = effectiveSeedSource;
        }
        imageData = { imageBytes, mimeType };
      } catch (rawErr) {
        console.warn("[Video Gen] Raw image load also failed, will try text-only");
        imageData = undefined;
      }
    }
  }

  // hasReferenceImage tells the prompt adapter to mention the attached reference
  // so the model knows to lock identity to the still. We mark it true whenever a
  // project-level reference exists OR whenever we're seeding from that reference.
  const hasReferenceImage = !!options.referenceImage || seedFromReference;

  const sceneShot: Partial<Scene> = options.scene
    ? { ...options.scene, visual_prompt: options.scene.visual_prompt || prompt }
    : { visual_prompt: prompt };
  const adapter = buildModelPrompt(
    {
      shot: sceneShot,
      styleSheet: options.styleSheet,
      characterProfile,
      negativePrompt: options.negativePrompt,
      audioScript,
      previousSceneContext,
      sceneIndex,
      aspectRatio,
      hasReferenceImage,
    },
    provider,
    modelId,
  );
  let fullPrompt = adapter.prompt;
  if (adapter.negativePrompt) {
    fullPrompt += `\n\n[Negative prompt — strictly avoid]: ${adapter.negativePrompt}`;
  }
  console.log(`[Video Gen] Prompt includes audio script: ${!!audioScript}, continuity: ${!!previousSceneContext}, negative: ${!!adapter.negativePrompt}`);

  const videoUrl = await withRetry(async () => {
    if (imageData) {
      try {
        return await attemptVideoGeneration(fullPrompt, apiKey, validRatio, imageData, 'img', actualModel);
      } catch (imgErr: any) {
        const msg = String(imgErr?.message || imgErr);
        console.warn(`[Video Gen] Image-based generation failed: ${msg}`);
        if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
          throw imgErr;
        }
        console.log(`[Video Gen] Falling back to text-only generation...`);
        return await attemptVideoGeneration(fullPrompt, apiKey, validRatio, undefined, 'txt-fallback', actualModel);
      }
    }
    return await attemptVideoGeneration(fullPrompt, apiKey, validRatio, undefined, 'txt', actualModel);
  }, 3, '비디오 생성');
  return { videoUrl, stats: { imagesGenerated: 0, criticCalls: 0, refineCalls: 0, videosGenerated: 1 } };
}
