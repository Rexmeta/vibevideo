
import { GoogleGenAI, Type } from '@google/genai';
import { getGoogleApiKey } from './apiKeyService';
import type {
  YoutubeAnalysis,
  YoutubeScene,
  DetectedCharacter,
  AnalysisFinding,
  OptimizationTip,
  RemixSourceData,
  Project,
  ProjectStatus,
  Scene,
  GenreId,
  PlatformId,
  CreativeBrief,
} from '../types';
import { ProjectStatus as PS } from '../types';

// ─── Helpers ────────────────────────────────────────────────────────────────

const MISSING_API_KEY_MESSAGE =
  'API 키가 설정되지 않았습니다. 관리 페이지에서 API 키를 설정해주세요.';

const ANALYSIS_TIMEOUT_MS = 90_000;

function requireApiKey(): string {
  const key = getGoogleApiKey();
  if (!key) {
    throw new Error(MISSING_API_KEY_MESSAGE);
  }
  return key;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} 시간 초과 (${ms / 1000}초)`)),
      ms,
    );
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Validate that the string looks like a YouTube URL before hitting the API. */
function assertYoutubeUrl(url: string): void {
  if (!url || typeof url !== 'string') {
    throw new Error('YouTube URL이 제공되지 않았습니다.');
  }
  const trimmed = url.trim();
  const isYoutube =
    /^https?:\/\/(www\.)?(youtube\.com\/(watch|shorts|embed|live)|youtu\.be\/)/.test(trimmed);
  if (!isYoutube) {
    throw new Error(
      `유효하지 않은 YouTube URL입니다: "${trimmed}". youtube.com 또는 youtu.be 링크를 입력해 주세요.`,
    );
  }
}

// ─── Response schema ────────────────────────────────────────────────────────

const YOUTUBE_ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    detectedTitle: { type: Type.STRING },
    detectedDurationSec: { type: Type.NUMBER },
    format: { type: Type.STRING },
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          startSec: { type: Type.NUMBER },
          endSec: { type: Type.NUMBER },
          scriptText: { type: Type.STRING },
          visualDescription: { type: Type.STRING },
        },
        required: ['startSec', 'endSec', 'scriptText', 'visualDescription'],
      },
    },
    characters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          screenTimeFraction: { type: Type.NUMBER },
        },
        required: ['name', 'description', 'screenTimeFraction'],
      },
    },
    backgrounds: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    scores: {
      type: Type.OBJECT,
      properties: {
        hookStrength: { type: Type.NUMBER },
        pacing: { type: Type.NUMBER },
        ctaEffectiveness: { type: Type.NUMBER },
        thumbnailAppeal: { type: Type.NUMBER },
        retentionCurve: { type: Type.NUMBER },
      },
      required: ['hookStrength', 'pacing', 'ctaEffectiveness', 'thumbnailAppeal', 'retentionCurve'],
    },
    strengths: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          rationale: { type: Type.STRING },
        },
        required: ['label', 'rationale'],
      },
    },
    weaknesses: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          rationale: { type: Type.STRING },
        },
        required: ['label', 'rationale'],
      },
    },
    viewOptimizationTips: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tip: { type: Type.STRING },
          reasoning: { type: Type.STRING },
          impactLevel: { type: Type.NUMBER },
        },
        required: ['tip', 'reasoning', 'impactLevel'],
      },
    },
    overallScore: { type: Type.NUMBER },
  },
  required: [
    'detectedTitle',
    'detectedDurationSec',
    'format',
    'scenes',
    'characters',
    'backgrounds',
    'scores',
    'strengths',
    'weaknesses',
    'viewOptimizationTips',
    'overallScore',
  ],
} as const;

// ─── Prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert YouTube content analyst and algorithm strategist. Deeply analyse the provided YouTube video and return a structured JSON report.

Your analysis must cover:

1. **Scene breakdown** — Identify each distinct scene or content segment. For each scene provide:
   - Approximate start/end timestamps in seconds
   - The spoken script text (transcribe accurately)
   - A vivid one-sentence visual description of what appears on screen

2. **Characters** — List every visible person (host, guest, subject, etc.) with:
   - A descriptive name or role label (e.g. "Male host", "Female co-presenter", "Product reviewer")
   - Brief physical / appearance notes (hair, clothing, distinguishing features)
   - Estimated fraction of total screen time (0.0–1.0)

3. **Backgrounds** — List the dominant environments / settings seen (e.g. "modern home studio", "outdoor park", "animated lower-third graphics").

4. **Engagement scores** (0–10 each, be honest — most videos score 5–8):
   - hookStrength: how quickly and powerfully the first 5–10 seconds grabs attention
   - pacing: rhythm and edit speed across the full video
   - ctaEffectiveness: clarity and persuasiveness of any call-to-action
   - thumbnailAppeal: based on the opening frame / visual style (estimate if thumbnail not shown)
   - retentionCurve: how well the video sustains interest from start to finish

5. **Strengths** — 3 to 5 specific, well-executed elements (each with a label + one-sentence rationale).

6. **Weaknesses** — 3 to 5 specific improvement areas (each with a label + one-sentence rationale).

7. **View-maximisation tips** — 5 to 8 actionable, concrete recommendations ordered from highest to lowest impact. Reference YouTube algorithm best practices: CTR (click-through rate), audience retention, engagement signals (likes, comments, shares), search/SEO, and Shorts vs. long-form strategies. Each tip must include:
   - tip: short imperative sentence (e.g. "Move the hook to the first 2 seconds")
   - reasoning: why this increases views / retention
   - impactLevel: 1 (low), 2 (medium), or 3 (high)

8. **Overall score** — Holistic 0–10 quality rating.

Be analytical and data-driven. Prioritise actionable insights over generic advice. Output ONLY the JSON matching the schema — no prose before or after.`;

// ─── Mapping / sanitising raw response ──────────────────────────────────────

function clampScore(n: unknown): number {
  const v = typeof n === 'number' ? n : 0;
  return Math.max(0, Math.min(10, Math.round(v * 10) / 10));
}

function clampFraction(n: unknown): number {
  const v = typeof n === 'number' ? n : 0;
  return Math.max(0, Math.min(1, v));
}

function clampImpact(n: unknown): 1 | 2 | 3 {
  const v = typeof n === 'number' ? Math.round(n) : 2;
  if (v <= 1) return 1;
  if (v >= 3) return 3;
  return 2;
}

function mapRaw(raw: any, videoUrl: string): YoutubeAnalysis {
  const scenes: YoutubeScene[] = Array.isArray(raw.scenes)
    ? raw.scenes.map((s: any) => ({
        startSec: typeof s.startSec === 'number' ? s.startSec : 0,
        endSec: typeof s.endSec === 'number' ? s.endSec : 0,
        scriptText: String(s.scriptText || '').trim(),
        visualDescription: String(s.visualDescription || '').trim(),
      }))
    : [];

  const characters: DetectedCharacter[] = Array.isArray(raw.characters)
    ? raw.characters.map((c: any) => ({
        name: String(c.name || '').trim(),
        description: String(c.description || '').trim(),
        screenTimeFraction: clampFraction(c.screenTimeFraction),
      }))
    : [];

  const backgrounds: string[] = Array.isArray(raw.backgrounds)
    ? raw.backgrounds.map((b: any) => String(b).trim()).filter(Boolean)
    : [];

  const sc = raw.scores || {};
  const scores = {
    hookStrength: clampScore(sc.hookStrength),
    pacing: clampScore(sc.pacing),
    ctaEffectiveness: clampScore(sc.ctaEffectiveness),
    thumbnailAppeal: clampScore(sc.thumbnailAppeal),
    retentionCurve: clampScore(sc.retentionCurve),
  };

  const mapFinding = (arr: any[]): AnalysisFinding[] =>
    arr.map((f: any) => ({
      label: String(f.label || '').trim(),
      rationale: String(f.rationale || '').trim(),
    }));

  const strengths: AnalysisFinding[] = Array.isArray(raw.strengths)
    ? mapFinding(raw.strengths)
    : [];
  const weaknesses: AnalysisFinding[] = Array.isArray(raw.weaknesses)
    ? mapFinding(raw.weaknesses)
    : [];

  const viewOptimizationTips: OptimizationTip[] = Array.isArray(raw.viewOptimizationTips)
    ? raw.viewOptimizationTips.map((t: any) => ({
        tip: String(t.tip || '').trim(),
        reasoning: String(t.reasoning || '').trim(),
        impactLevel: clampImpact(t.impactLevel),
      }))
    : [];

  return {
    videoUrl,
    detectedTitle: String(raw.detectedTitle || '').trim(),
    detectedDurationSec: typeof raw.detectedDurationSec === 'number' ? raw.detectedDurationSec : 0,
    format: String(raw.format || '').trim(),
    scenes,
    characters,
    backgrounds,
    scores,
    strengths,
    weaknesses,
    viewOptimizationTips,
    overallScore: clampScore(raw.overallScore),
  };
}

// ─── Remix utilities ─────────────────────────────────────────────────────────

function genProjectId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `proj-${crypto.randomUUID()}`;
  }
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function detectPlatformFromFormat(format: string): PlatformId | undefined {
  const f = format.toLowerCase();
  if (f.includes('shorts') || f.includes('tiktok') || f.includes('reels') || f.includes('vertical'))
    return 'youtube-shorts';
  if (f.includes('long') || f.includes('16:9') || f.includes('landscape') || f.includes('long-form'))
    return 'youtube-16-9';
  return undefined;
}

function detectGenreFromFormat(format: string): GenreId | undefined {
  const f = format.toLowerCase();
  if (f.includes('vlog')) return 'vlog';
  if (f.includes('explainer') || f.includes('tutorial') || f.includes('education')) return 'explainer';
  if (f.includes('ad') || f.includes('promo')) return 'ad';
  return undefined;
}

/**
 * Build a new `Project` from a `YoutubeAnalysis` result, ready to persist.
 * Returns both the project record and the `RemixSourceData` stored on it.
 */
export function buildRemixProject(
  userId: string,
  analysis: YoutubeAnalysis,
  selectedTips: OptimizationTip[],
): { project: Project; remixSource: RemixSourceData } {
  const projectId = genProjectId();
  const now = new Date().toISOString();

  const remixSource: RemixSourceData = {
    videoUrl: analysis.videoUrl,
    detectedTitle: analysis.detectedTitle,
    overallScore: analysis.overallScore,
    format: analysis.format,
    topStrength: analysis.strengths[0],
    topWeakness: analysis.weaknesses[0],
    detectedCharacters: analysis.characters,
    detectedBackgrounds: analysis.backgrounds,
    selectedTips,
    originalScenes: analysis.scenes,
  };

  // Build creative brief key-message from selected high-impact tips
  const highImpactTips = selectedTips.filter(t => t.impactLevel === 3);
  const keyMessage =
    highImpactTips.length > 0
      ? highImpactTips
          .slice(0, 2)
          .map(t => t.tip)
          .join(' • ')
      : selectedTips[0]?.tip;

  const creativeBrief: CreativeBrief = {
    keyMessage: keyMessage || undefined,
    referenceUrls: [analysis.videoUrl],
  };

  // Pre-populate script textarea with original scene scripts
  const savedScript = analysis.scenes
    .map((s, i) => `[씬 ${i + 1}]\n${s.scriptText}`)
    .filter(t => t.includes('\n'))
    .join('\n\n');

  const platform = detectPlatformFromFormat(analysis.format);
  const genre = detectGenreFromFormat(analysis.format);

  // Derive aspect ratio from platform / format
  const aspectRatio: '16:9' | '9:16' | '1:1' | '3:4' =
    platform === 'youtube-shorts' ? '9:16' : '16:9';

  // Pre-populate character_references so they are persisted with the project
  // from the moment it is created. This means the restore path in useRestore
  // will always hydrate characterReferences from saved data, and the
  // component-level useEffect pre-population guard in Step1Setup is no longer
  // needed (and cannot accidentally reset user edits on re-mount).
  const characterReferences = analysis.characters.map(c => ({
    name: c.name,
    description: c.description,
    imageUrl: '',
  }));

  const project = {
    id: projectId,
    user_id: userId,
    title: analysis.detectedTitle || 'YouTube 리믹스',
    aspect_ratio: aspectRatio,
    style_template: 'Realistic Cinematic',
    status: PS.DRAFT,
    created_at: now,
    updated_at: now,
    saved_step: 1,
    saved_max_step: 2,
    saved_mode: 'pro' as const,
    saved_script: savedScript,
    saved_scenes: [],
    saved_topic: analysis.detectedTitle || 'YouTube 리믹스',
    saved_duration: Math.min(Math.max(Math.round(analysis.detectedDurationSec), 30), 600),
    target_scene_count: Math.min(Math.max(analysis.scenes.length, 2), 10),
    scene_duration_mode: 'scenes' as const,
    platform: platform || undefined,
    genre: genre || undefined,
    creative_brief: creativeBrief,
    remix_source: remixSource,
    character_references: characterReferences.length > 0 ? characterReferences : undefined,
  } as unknown as Project;

  return { project, remixSource };
}

// ─── Remix scene generation schema ───────────────────────────────────────────

const REMIX_SCENES_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          scriptSegment: { type: Type.STRING },
          visualPrompt: { type: Type.STRING },
        },
        required: ['scriptSegment', 'visualPrompt'],
      },
    },
  },
  required: ['scenes'],
} as const;

/**
 * Call Gemini to rewrite each original YouTube scene based on the selected
 * optimisation tips, character replacements, and background replacements.
 * Returns `Partial<Scene>[]` ready to drop into `saved_scenes`, with
 * `remix_original_script` preserving the source text for side-by-side display.
 */
export async function generateRemixedScenes(
  remixSource: RemixSourceData,
  options: {
    characterReplacements?: Record<string, string>;
    backgroundReplacements?: Record<string, string>;
  } = {},
): Promise<Partial<Scene>[]> {
  const apiKey = requireApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const tipsList = remixSource.selectedTips
    .map((t, i) => `${i + 1}. ${t.tip} — ${t.reasoning}`)
    .join('\n');

  const charMap = options.characterReplacements || {};
  const bgMap = options.backgroundReplacements || {};

  const charLines = Object.entries(charMap)
    .map(([orig, repl]) => `• "${orig}" → "${repl}"`)
    .join('\n');

  const bgLines = Object.entries(bgMap)
    .map(([orig, repl]) => `• "${orig}" → "${repl}"`)
    .join('\n');

  const scenesText = remixSource.originalScenes
    .map(
      (s, i) =>
        `Scene ${i + 1} [${Math.floor(s.startSec)}s–${Math.floor(s.endSec)}s]:\n` +
        `Script: ${s.scriptText}\nVisual: ${s.visualDescription}`,
    )
    .join('\n\n');

  const systemPrompt = `You are a YouTube creative scriptwriter and video director.
Rewrite the provided video scenes to implement the view-maximisation tips below.
Keep the same number of scenes and roughly the same total length.
Incorporate any character or background replacements specified.

OPTIMISATION TIPS TO APPLY:
${tipsList || '(none selected — improve overall quality)'}

${charLines ? `CHARACTER REPLACEMENTS:\n${charLines}` : ''}
${bgLines ? `BACKGROUND REPLACEMENTS:\n${bgLines}` : ''}

For each scene return:
- scriptSegment: the rewritten spoken dialogue / narration (keep natural length)
- visualPrompt: a vivid one-to-two sentence description of what appears on screen, written as an image-generation prompt

Output ONLY the JSON matching the schema — no prose before or after.`;

  let response: Awaited<ReturnType<typeof ai.models.generateContent>>;
  try {
    response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{ parts: [{ text: `${systemPrompt}\n\nORIGINAL SCENES:\n${scenesText}` }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: REMIX_SCENES_SCHEMA as any,
        },
      }),
      90_000,
      '리믹스 씬 생성',
    );
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.includes('API 키가 설정되지 않았습니다') || msg.toLowerCase().includes('api key')) {
      throw e instanceof Error ? e : new Error(msg);
    }
    throw new Error(`리믹스 씬 생성 중 오류가 발생했습니다: ${msg || '알 수 없는 오류'}`);
  }

  const raw = (() => {
    try { return JSON.parse(response.text || '{}'); } catch {
      throw new Error('리믹스 씬 결과를 처리하는 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
  })();

  const rawScenes: Array<{ scriptSegment: string; visualPrompt: string }> =
    Array.isArray(raw.scenes) ? raw.scenes : [];

  return remixSource.originalScenes.map((orig, i) => {
    const adapted = rawScenes[i];
    return {
      id: `remix-${i}-${Date.now()}`,
      project_id: '',  // filled in by the wizard on save
      scene_number: i + 1,
      script_segment: adapted?.scriptSegment || orig.scriptText,
      visual_prompt: adapted?.visualPrompt || orig.visualDescription,
      remix_original_script: orig.scriptText,
    } as Partial<Scene>;
  });
}

/**
 * Re-generate a single remix scene (by index) without rebuilding the whole
 * storyboard.  Returns an updated `Partial<Scene>` ready for `updateSceneAt`.
 */
export async function regenerateSingleRemixScene(
  remixSource: RemixSourceData,
  sceneIndex: number,
  options: {
    characterReplacements?: Record<string, string>;
    backgroundReplacements?: Record<string, string>;
  } = {},
): Promise<Partial<Scene>> {
  const apiKey = requireApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const orig = remixSource.originalScenes[sceneIndex];
  if (!orig) throw new Error(`씬 ${sceneIndex + 1}을 찾을 수 없습니다.`);

  const tipsList = remixSource.selectedTips
    .map((t, i) => `${i + 1}. ${t.tip} — ${t.reasoning}`)
    .join('\n');

  const charMap = options.characterReplacements || {};
  const bgMap = options.backgroundReplacements || {};

  const charLines = Object.entries(charMap)
    .map(([o, r]) => `• "${o}" → "${r}"`)
    .join('\n');

  const bgLines = Object.entries(bgMap)
    .map(([o, r]) => `• "${o}" → "${r}"`)
    .join('\n');

  const systemPrompt = `You are a YouTube creative scriptwriter and video director.
Rewrite the provided single video scene to implement the view-maximisation tips below.
Incorporate any character or background replacements specified.

OPTIMISATION TIPS TO APPLY:
${tipsList || '(none selected — improve overall quality)'}

${charLines ? `CHARACTER REPLACEMENTS:\n${charLines}` : ''}
${bgLines ? `BACKGROUND REPLACEMENTS:\n${bgLines}` : ''}

Return ONLY the JSON matching the schema — no prose before or after.`;

  const sceneText =
    `Scene ${sceneIndex + 1} [${Math.floor(orig.startSec)}s–${Math.floor(orig.endSec)}s]:\n` +
    `Script: ${orig.scriptText}\nVisual: ${orig.visualDescription}`;

  const SINGLE_SCENE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
      scriptSegment: { type: Type.STRING },
      visualPrompt: { type: Type.STRING },
    },
    required: ['scriptSegment', 'visualPrompt'],
  } as const;

  let response: Awaited<ReturnType<typeof ai.models.generateContent>>;
  try {
    response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{ parts: [{ text: `${systemPrompt}\n\nSCENE TO REWRITE:\n${sceneText}` }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: SINGLE_SCENE_SCHEMA as any,
        },
      }),
      60_000,
      `씬 ${sceneIndex + 1} 리믹스 재생성`,
    );
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.includes('API 키가 설정되지 않았습니다') || msg.toLowerCase().includes('api key')) {
      throw e instanceof Error ? e : new Error(msg);
    }
    throw new Error(`씬 ${sceneIndex + 1} 재생성 중 오류가 발생했습니다: ${msg || '알 수 없는 오류'}`);
  }

  const raw = (() => {
    try { return JSON.parse(response.text || '{}'); } catch {
      throw new Error('씬 재생성 결과를 처리하는 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
  })();

  return {
    id: `remix-${sceneIndex}-${Date.now()}`,
    project_id: '',
    scene_number: sceneIndex + 1,
    script_segment: String(raw.scriptSegment || orig.scriptText),
    visual_prompt: String(raw.visualPrompt || orig.visualDescription),
    remix_original_script: orig.scriptText,
  } as Partial<Scene>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Analyse a YouTube video using Gemini's native URL understanding.
 *
 * @param url - A valid youtube.com or youtu.be URL.
 * @returns A structured `YoutubeAnalysis` object.
 * @throws If the URL is invalid, the API key is missing, or Gemini fails.
 */
export async function analyzeYoutubeVideo(url: string): Promise<YoutubeAnalysis> {
  assertYoutubeUrl(url);
  const apiKey = requireApiKey();
  const ai = new GoogleGenAI({ apiKey });

  let response: Awaited<ReturnType<typeof ai.models.generateContent>>;
  try {
    response = await withTimeout(
      ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [
          {
            parts: [
              {
                fileData: {
                  mimeType: 'video/*',
                  fileUri: url.trim(),
                },
              },
              { text: SYSTEM_PROMPT },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: YOUTUBE_ANALYSIS_SCHEMA as any,
        },
      }),
      ANALYSIS_TIMEOUT_MS,
      'YouTube 영상 분석',
    );
  } catch (e: any) {
    const msg = String(e?.message || '');
    const lower = msg.toLowerCase();
    if (msg.includes('API 키가 설정되지 않았습니다') || lower.includes('api key')) {
      throw e instanceof Error ? e : new Error(msg);
    }
    if (lower.includes('시간 초과') || lower.includes('timeout') || lower.includes('deadline')) {
      throw new Error('YouTube 영상 분석 요청이 시간 초과되었습니다. 영상이 길거나 서버가 혼잡할 수 있습니다. 잠시 후 다시 시도해 주세요.');
    }
    if (lower.includes('429') || lower.includes('resource_exhausted')) {
      throw new Error('Gemini 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
    }
    if (lower.includes('503') || lower.includes('unavailable') || lower.includes('overloaded')) {
      throw new Error('Gemini 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해 주세요.');
    }
    throw new Error(`YouTube 영상 분석 중 오류가 발생했습니다: ${msg || '알 수 없는 오류'}`);
  }

  const raw = (() => {
    try {
      return JSON.parse(response.text || '{}');
    } catch {
      throw new Error(
        'YouTube 영상 분석 결과를 처리하는 중 오류가 발생했습니다. 다시 시도해 주세요.',
      );
    }
  })();

  return mapRaw(raw, url.trim());
}
