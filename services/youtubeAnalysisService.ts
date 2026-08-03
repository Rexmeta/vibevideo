
import { GoogleGenAI, Type } from '@google/genai';
import { getGoogleApiKey } from './apiKeyService';
import type {
  YoutubeAnalysis,
  YoutubeScene,
  DetectedCharacter,
  AnalysisFinding,
  OptimizationTip,
} from '../types';

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
