/**
 * Unit tests for youtubeAnalysisService.ts
 *
 * Covers:
 *  - All three generateContent calls use the correct model string (gemini-2.5-flash)
 *  - 404 / NOT_FOUND errors surface a clear message rather than crashing silently
 *  - Missing API key is propagated rather than swallowed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks (must be declared before vi.mock factories run) ────────────

const { mockGenerateContent, mockGetGoogleApiKey } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockGetGoogleApiKey: vi.fn<() => string | null>(),
}));

// ─── Mock @google/genai ───────────────────────────────────────────────────────

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
  Type: {
    OBJECT: 'object',
    ARRAY: 'array',
    STRING: 'string',
    NUMBER: 'number',
  },
}));

// ─── Mock apiKeyService ───────────────────────────────────────────────────────

vi.mock('../services/apiKeyService', () => ({
  getGoogleApiKey: mockGetGoogleApiKey,
}));

// ─── Service under test ───────────────────────────────────────────────────────

import {
  analyzeYoutubeVideo,
  generateRemixedScenes,
  regenerateSingleRemixScene,
} from '../services/youtubeAnalysisService';
import type { RemixSourceData } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal valid analysis response JSON */
const VALID_ANALYSIS_JSON = JSON.stringify({
  detectedTitle: 'Test Video',
  detectedDurationSec: 120,
  format: 'long-form',
  scenes: [
    { startSec: 0, endSec: 30, scriptText: 'Hello world', visualDescription: 'Person talking' },
  ],
  characters: [{ name: 'Host', description: 'Male presenter', screenTimeFraction: 1 }],
  backgrounds: ['home studio'],
  scores: {
    hookStrength: 7,
    pacing: 6,
    ctaEffectiveness: 5,
    thumbnailAppeal: 7,
    retentionCurve: 6,
  },
  strengths: [{ label: 'Good hook', rationale: 'Opens with a question' }],
  weaknesses: [{ label: 'Weak CTA', rationale: 'No clear ask at the end' }],
  viewOptimizationTips: [
    { tip: 'Add captions', reasoning: 'Improves accessibility', impactLevel: 2 },
  ],
  overallScore: 6.5,
});

/** Minimal valid remix-scenes response JSON */
const VALID_REMIX_JSON = JSON.stringify({
  scenes: [{ scriptSegment: 'Rewritten script', visualPrompt: 'Dynamic scene' }],
});

/** Minimal valid single-scene response JSON */
const VALID_SINGLE_SCENE_JSON = JSON.stringify({
  scriptSegment: 'Rewritten scene',
  visualPrompt: 'Close-up shot',
});

/** Minimal RemixSourceData */
const REMIX_SOURCE: RemixSourceData = {
  videoUrl: 'https://www.youtube.com/watch?v=abc123',
  detectedTitle: 'Test',
  overallScore: 7,
  format: 'long-form',
  topStrength: { label: 'Hook', rationale: 'Great' },
  topWeakness: { label: 'CTA', rationale: 'Weak' },
  detectedCharacters: [{ name: 'Host', description: 'Male presenter', screenTimeFraction: 1 }],
  detectedBackgrounds: ['home studio'],
  selectedTips: [{ tip: 'Tip 1', reasoning: 'Reason 1', impactLevel: 3 }],
  originalScenes: [
    { startSec: 0, endSec: 30, scriptText: 'Hello world', visualDescription: 'Person talking' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGoogleApiKey.mockReturnValue('fake-api-key');
});

// ─── analyzeYoutubeVideo ──────────────────────────────────────────────────────

describe('analyzeYoutubeVideo', () => {
  it('calls generateContent with model gemini-2.5-flash', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: VALID_ANALYSIS_JSON });

    await analyzeYoutubeVideo('https://www.youtube.com/watch?v=abc123');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-2.5-flash');
  });

  it('returns a mapped YoutubeAnalysis on success', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: VALID_ANALYSIS_JSON });

    const result = await analyzeYoutubeVideo('https://www.youtube.com/watch?v=abc123');

    expect(result.detectedTitle).toBe('Test Video');
    expect(result.overallScore).toBe(6.5);
    expect(result.scenes).toHaveLength(1);
  });

  it('throws a clear error on 404 / NOT_FOUND from the API', async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error('404 NOT_FOUND: The video could not be fetched'),
    );

    await expect(
      analyzeYoutubeVideo('https://www.youtube.com/watch?v=notfound'),
    ).rejects.toThrow('YouTube 영상 분석 중 오류가 발생했습니다');
  });

  it('throws a clear error on NOT_FOUND status keyword', async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error('NOT_FOUND: requested entity was not found'),
    );

    await expect(
      analyzeYoutubeVideo('https://www.youtube.com/watch?v=abc123'),
    ).rejects.toThrow('YouTube 영상 분석 중 오류가 발생했습니다');
  });

  it('propagates the API key error without wrapping it', async () => {
    mockGetGoogleApiKey.mockReturnValue(null);

    await expect(
      analyzeYoutubeVideo('https://www.youtube.com/watch?v=abc123'),
    ).rejects.toThrow('API 키가 설정되지 않았습니다');
  });

  it('throws a clear error for an invalid URL', async () => {
    await expect(
      analyzeYoutubeVideo('https://vimeo.com/123'),
    ).rejects.toThrow('유효하지 않은 YouTube URL');
  });

  it('surfaces a timeout error clearly', async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error('YouTube 영상 분석 시간 초과 (90초)'),
    );

    await expect(
      analyzeYoutubeVideo('https://www.youtube.com/watch?v=abc123'),
    ).rejects.toThrow('시간 초과');
  });

  it('surfaces a rate-limit error clearly', async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error('429 RESOURCE_EXHAUSTED: quota exceeded'),
    );

    await expect(
      analyzeYoutubeVideo('https://www.youtube.com/watch?v=abc123'),
    ).rejects.toThrow('요청 한도');
  });
});

// ─── generateRemixedScenes ────────────────────────────────────────────────────

describe('generateRemixedScenes', () => {
  it('calls generateContent with model gemini-2.5-flash', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: VALID_REMIX_JSON });

    await generateRemixedScenes(REMIX_SOURCE);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-2.5-flash');
  });

  it('returns Partial<Scene>[] matching original scene count', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: VALID_REMIX_JSON });

    const scenes = await generateRemixedScenes(REMIX_SOURCE);

    expect(scenes).toHaveLength(REMIX_SOURCE.originalScenes.length);
    expect(scenes[0].script_segment).toBe('Rewritten script');
    expect(scenes[0].visual_prompt).toBe('Dynamic scene');
    expect(scenes[0].remix_original_script).toBe('Hello world');
  });

  it('throws a clear error on 404 / NOT_FOUND from the API', async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error('404 NOT_FOUND: video resource not found'),
    );

    await expect(generateRemixedScenes(REMIX_SOURCE)).rejects.toThrow(
      '리믹스 씬 생성 중 오류가 발생했습니다',
    );
  });

  it('propagates API key error without wrapping it', async () => {
    mockGetGoogleApiKey.mockReturnValue(null);

    await expect(generateRemixedScenes(REMIX_SOURCE)).rejects.toThrow(
      'API 키가 설정되지 않았습니다',
    );
  });

  it('falls back to original scene text when API returns fewer scenes', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: JSON.stringify({ scenes: [] }) });

    const scenes = await generateRemixedScenes(REMIX_SOURCE);

    expect(scenes[0].script_segment).toBe('Hello world');
    expect(scenes[0].visual_prompt).toBe('Person talking');
  });
});

// ─── regenerateSingleRemixScene ───────────────────────────────────────────────

describe('regenerateSingleRemixScene', () => {
  it('calls generateContent with model gemini-2.5-flash', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: VALID_SINGLE_SCENE_JSON });

    await regenerateSingleRemixScene(REMIX_SOURCE, 0);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-2.5-flash');
  });

  it('returns a Partial<Scene> with the regenerated content', async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: VALID_SINGLE_SCENE_JSON });

    const scene = await regenerateSingleRemixScene(REMIX_SOURCE, 0);

    expect(scene.script_segment).toBe('Rewritten scene');
    expect(scene.visual_prompt).toBe('Close-up shot');
    expect(scene.scene_number).toBe(1);
    expect(scene.remix_original_script).toBe('Hello world');
  });

  it('throws a clear error on 404 / NOT_FOUND from the API', async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error('404 NOT_FOUND: resource not found'),
    );

    await expect(regenerateSingleRemixScene(REMIX_SOURCE, 0)).rejects.toThrow(
      '씬 1 재생성 중 오류가 발생했습니다',
    );
  });

  it('throws an error for an out-of-range scene index', async () => {
    await expect(regenerateSingleRemixScene(REMIX_SOURCE, 99)).rejects.toThrow(
      '씬 100을 찾을 수 없습니다',
    );
  });

  it('propagates API key error without wrapping it', async () => {
    mockGetGoogleApiKey.mockReturnValue(null);

    await expect(regenerateSingleRemixScene(REMIX_SOURCE, 0)).rejects.toThrow(
      'API 키가 설정되지 않았습니다',
    );
  });
});
