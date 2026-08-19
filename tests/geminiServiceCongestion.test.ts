/**
 * Unit tests: friendly 429 / 503 congestion copy for generation services
 *
 * Covers:
 *  - generateSceneImage: 429 → retries, then friendly Korean rate-limit message
 *  - generateSceneImage: 503 → retries, then friendly Korean congestion message
 *  - generateSceneAudio: 429 → retries, then friendly Korean rate-limit message
 *  - generateSceneAudio: 503 → retries, then friendly Korean congestion message
 *  - generateSceneVideo: 429 → retries, then friendly Korean rate-limit message
 *  - generateSceneVideo: 503 → retries, then friendly Korean congestion message
 *  - runVeoOperation: repeated poll 429/503 errors → friendly Korean message
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockGenerateContent,
  mockGenerateVideos,
  mockGetVideosOperation,
  mockGetGoogleApiKey,
  mockGetEffectiveApiKey,
} =
  vi.hoisted(() => ({
    mockGenerateContent: vi.fn(),
    mockGenerateVideos: vi.fn(),
    mockGetVideosOperation: vi.fn(),
    mockGetGoogleApiKey: vi.fn<() => string>(),
    mockGetEffectiveApiKey: vi.fn<() => string | null>(),
  }));

// ─── Mock @google/genai ───────────────────────────────────────────────────────

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
      generateVideos: mockGenerateVideos,
    },
    operations: {
      getVideosOperation: mockGetVideosOperation,
    },
  })),
  Modality: { IMAGE: 'IMAGE', TEXT: 'TEXT', AUDIO: 'AUDIO' },
  Type: {
    OBJECT: 'object',
    ARRAY: 'array',
    STRING: 'string',
    NUMBER: 'number',
    BOOLEAN: 'boolean',
  },
}));

// ─── Mock apiKeyService ───────────────────────────────────────────────────────

vi.mock('../services/apiKeyService', () => ({
  getGoogleApiKey: mockGetGoogleApiKey,
  getEffectiveApiKey: mockGetEffectiveApiKey,
}));

// ─── Mock visionCritic (not under test here) ─────────────────────────────────

vi.mock('../services/visionCritic', () => ({
  critiqueImage: vi.fn().mockResolvedValue({ overall: 8 }),
  buildRefineHint: vi.fn().mockReturnValue(''),
}));

// ─── Mock promptAdapter — use the real export name geminiService imports ──────

vi.mock('../services/promptAdapter', () => ({
  buildPrompt: vi.fn().mockReturnValue({ prompt: 'test prompt', negativePrompt: '' }),
  targetFor: vi.fn().mockReturnValue('gemini-image'),
}));

// ─── Services under test ──────────────────────────────────────────────────────

import {
  generateSceneImage,
  generateSceneAudio,
  generateSceneVideo,
  runVeoOperation,
} from '../services/geminiService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Attach the rejection assertion BEFORE advancing fake timers so the promise
 * always has a handler and never triggers an unhandled-rejection warning.
 */
async function expectRejectedAfterTimers(p: Promise<unknown>, message: string) {
  const assertion = expect(p).rejects.toThrow(message);
  await vi.runAllTimersAsync();
  await assertion;
}

async function expectRejectedWithExactMessageAfterTimers(p: Promise<unknown>, message: string) {
  const errorPromise = p.then(
    () => null,
    (error) => error,
  );
  await vi.runAllTimersAsync();
  const error = await errorPromise;
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(message);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGoogleApiKey.mockReturnValue('fake-api-key');
  mockGetEffectiveApiKey.mockReturnValue('fake-api-key');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── generateSceneImage ───────────────────────────────────────────────────────

describe('generateSceneImage — congestion errors', () => {
  it('throws a friendly Korean message on 429 RESOURCE_EXHAUSTED', async () => {
    mockGenerateContent.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));
    await expectRejectedAfterTimers(
      generateSceneImage('a dog running', 'cinematic', '16:9'),
      'Gemini 요청 한도에 도달했습니다',
    );
  });

  it('throws a friendly Korean message on 503 overloaded', async () => {
    mockGenerateContent.mockRejectedValue(
      new Error('503 Service Unavailable: The model is overloaded'),
    );
    await expectRejectedAfterTimers(
      generateSceneImage('a dog running', 'cinematic', '16:9'),
      'Gemini 서버가 일시적으로 혼잡합니다',
    );
  });

  it('throws a friendly Korean message on "unavailable" keyword', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Service is currently unavailable'));
    await expectRejectedAfterTimers(
      generateSceneImage('a cat', 'anime', '9:16'),
      'Gemini 서버가 일시적으로 혼잡합니다',
    );
  });

  it('retries on 429 before giving up (withRetry still fires)', async () => {
    // generateSceneImage uses withRetry(..., 1, ...) → 1 initial + 1 retry = 2 calls
    mockGenerateContent.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));
    const p = generateSceneImage('a dog running', 'cinematic', '16:9');
    const assertion = expect(p).rejects.toThrow('Gemini 요청 한도에 도달했습니다');
    await vi.runAllTimersAsync();
    await assertion;
    // withRetry(fn, 1, ...) = 1 initial attempt + 1 retry = 2 total calls
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('retries on 503 before giving up (withRetry still fires)', async () => {
    mockGenerateContent.mockRejectedValue(
      new Error('503 Service Unavailable: The model is overloaded'),
    );
    const p = generateSceneImage('a dog running', 'cinematic', '16:9');
    const assertion = expect(p).rejects.toThrow('Gemini 서버가 일시적으로 혼잡합니다');
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });
});

// ─── generateSceneAudio ───────────────────────────────────────────────────────

describe('generateSceneAudio — congestion errors', () => {
  it('throws a friendly Korean message on 429 RESOURCE_EXHAUSTED', async () => {
    mockGenerateContent.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));
    await expectRejectedAfterTimers(
      generateSceneAudio('Hello world', 'cinematic'),
      'Gemini 요청 한도에 도달했습니다',
    );
  });

  it('throws a friendly Korean message on 503 overloaded', async () => {
    mockGenerateContent.mockRejectedValue(
      new Error('503 Service Unavailable: The model is overloaded'),
    );
    await expectRejectedAfterTimers(
      generateSceneAudio('Hello world', 'cinematic'),
      'Gemini 서버가 일시적으로 혼잡합니다',
    );
  });

  it('retries on 429 before giving up (withRetry still fires)', async () => {
    // generateSceneAudio uses withRetry(..., 1, ...) → 2 total calls
    mockGenerateContent.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));
    const p = generateSceneAudio('Hello world', 'cinematic');
    const assertion = expect(p).rejects.toThrow('Gemini 요청 한도에 도달했습니다');
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });
});

// ─── generateSceneVideo ───────────────────────────────────────────────────────

describe('generateSceneVideo — congestion errors on submit', () => {
  it('throws a friendly Korean message on 429 RESOURCE_EXHAUSTED from generateVideos', async () => {
    mockGenerateVideos.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));
    await expectRejectedAfterTimers(
      generateSceneVideo('a car chase', undefined, '16:9'),
      'Gemini 요청 한도에 도달했습니다',
    );
  });

  it('throws a friendly Korean message on 503 overloaded from generateVideos', async () => {
    mockGenerateVideos.mockRejectedValue(
      new Error('503 Service Unavailable: The model is overloaded'),
    );
    await expectRejectedAfterTimers(
      generateSceneVideo('a car chase', undefined, '16:9'),
      'Gemini 서버가 일시적으로 혼잡합니다',
    );
  });

  it('retries on 429 before giving up (withRetry still fires)', async () => {
    // generateSceneVideo uses withRetry(..., 3, ...) → up to 4 calls, but 429
    // is treated as non-retryable in the image-fallback path; for text-only the
    // outer withRetry fires. Confirm at least 2 submit calls happen.
    mockGenerateVideos.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));
    const p = generateSceneVideo('a car chase', undefined, '16:9');
    const assertion = expect(p).rejects.toThrow('Gemini 요청 한도에 도달했습니다');
    await vi.runAllTimersAsync();
    await assertion;
    // withRetry(fn, 3, ...) with 429 → base delay 60s → at least 2 attempts before max
    expect(mockGenerateVideos.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('retries on 503 before giving up (withRetry still fires)', async () => {
    mockGenerateVideos.mockRejectedValue(
      new Error('503 Service Unavailable: The model is overloaded'),
    );
    const p = generateSceneVideo('a car chase', undefined, '16:9');
    const assertion = expect(p).rejects.toThrow('Gemini 서버가 일시적으로 혼잡합니다');
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockGenerateVideos.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('runVeoOperation — congestion errors while polling', () => {
  it('throws a friendly Korean message after eight consecutive 429 poll errors', async () => {
    mockGenerateVideos.mockResolvedValue({ name: 'operations/test-429', done: false });
    mockGetVideosOperation.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'));

    const p = runVeoOperation('a car chase', {
      apiKey: 'fake-api-key',
      validRatio: '16:9',
    });
    await expectRejectedWithExactMessageAfterTimers(
      p,
      'Gemini 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
    );

    expect(mockGetVideosOperation).toHaveBeenCalledTimes(8);
  });

  it('throws a friendly Korean message after eight consecutive 503 poll errors', async () => {
    mockGenerateVideos.mockResolvedValue({ name: 'operations/test-503', done: false });
    mockGetVideosOperation.mockRejectedValue(
      new Error('503 Service Unavailable: The model is overloaded'),
    );

    const p = runVeoOperation('a car chase', {
      apiKey: 'fake-api-key',
      validRatio: '16:9',
    });
    await expectRejectedWithExactMessageAfterTimers(
      p,
      'Gemini 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해 주세요.',
    );

    expect(mockGetVideosOperation).toHaveBeenCalledTimes(8);
  });
});
