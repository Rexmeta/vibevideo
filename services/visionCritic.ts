import { GoogleGenAI, Type, type Part } from '@google/genai';
import { getGoogleApiKey } from './apiKeyService';
import type { QualityScore, StyleSheet } from '../types';

const CRITIC_MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 30000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} 시간 초과 (${ms / 1000}초)`)), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

export interface CriticInput {
  imageBase64: string;
  mimeType: string;
  intentPrompt: string;
  characterProfile?: string;
  styleSheet?: StyleSheet;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    characterConsistency: { type: Type.NUMBER },
    compositionQuality: { type: Type.NUMBER },
    intentAlignment: { type: Type.NUMBER },
    overall: { type: Type.NUMBER },
    issues: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['characterConsistency', 'compositionQuality', 'intentAlignment', 'overall', 'issues'],
} as const;

function clamp(n: number): number {
  if (typeof n !== 'number' || isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 10) return 10;
  return Math.round(n * 10) / 10;
}

function buildCriticPrompt(input: CriticInput): string {
  const styleParts: string[] = [];
  if (input.styleSheet?.palette?.length) styleParts.push(`palette ${input.styleSheet.palette.join(', ')}`);
  if (input.styleSheet?.lighting) styleParts.push(`lighting ${input.styleSheet.lighting}`);
  if (input.styleSheet?.mood) styleParts.push(`mood ${input.styleSheet.mood}`);
  const hasRef = !!input.referenceImageBase64;
  return `You are a strict visual director reviewing an AI-generated image for a video scene. Score each axis from 0 (terrible) to 10 (perfect). Be honest — most generations score 5–8.

${hasRef
  ? 'Two images are attached. The FIRST image is the GROUND-TRUTH reference for the main character (face, hair, body, clothing, identity). The SECOND image is the generated scene under review. For characterConsistency, compare the SECOND image directly to the FIRST: same person? same outfit? same identity? Score harshly if the character is clearly a different person.'
  : 'One image is attached: the generated scene under review.'}

Evaluation axes:
- characterConsistency: ${hasRef ? 'how closely the character in the generated image matches the attached reference image (identity, face, hair, clothing).' : 'does the depicted character match the described character profile?'}
- compositionQuality: framing, focus, balance, technical polish.
- intentAlignment: does the generated image actually depict what the scene prompt asks for?
- overall: holistic verdict (not necessarily an average).

Also list up to 3 short concrete issues that would help regenerate a better version. Empty array if none.

INTENT PROMPT:
${input.intentPrompt}

CHARACTER PROFILE: ${input.characterProfile || '(none specified)'}
STYLE TARGETS: ${styleParts.join(', ') || '(none specified)'}

Respond ONLY with JSON matching the schema.`;
}

export async function critiqueImage(input: CriticInput): Promise<QualityScore | null> {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    console.warn('[VisionCritic] No API key, skipping critique.');
    return null;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const parts: Part[] = [];
    if (input.referenceImageBase64) {
      parts.push({
        inlineData: {
          mimeType: input.referenceImageMimeType || 'image/png',
          data: input.referenceImageBase64,
        },
      });
    }
    parts.push({ inlineData: { mimeType: input.mimeType, data: input.imageBase64 } });
    parts.push({ text: buildCriticPrompt(input) });
    const response = await withTimeout(
      ai.models.generateContent({
        model: CRITIC_MODEL,
        contents: [{ parts }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA as any,
        },
      }),
      TIMEOUT_MS,
      'Vision Critic',
    );

    const text = response.text || '{}';
    const parsed = JSON.parse(text);
    const score: QualityScore = {
      characterConsistency: clamp(parsed.characterConsistency),
      compositionQuality: clamp(parsed.compositionQuality),
      intentAlignment: clamp(parsed.intentAlignment),
      overall: clamp(parsed.overall),
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 3).map((s: any) => String(s)) : [],
    };
    return score;
  } catch (e: any) {
    console.warn('[VisionCritic] Critique failed:', e?.message || e);
    return null;
  }
}

export function buildRefineHint(score: QualityScore): string {
  const issues = score.issues && score.issues.length > 0 ? score.issues.join('; ') : 'composition or character consistency';
  return `Previous attempt scored ${score.overall}/10. Fix these issues: ${issues}. Strictly preserve the requested character and style sheet.`;
}
