import { describe, expect, it, vi } from 'vitest';
import {
  createGenerationCommand,
  executeGenerationCommand,
  normalizeGenerationError,
} from '../services/generationContract';

describe('provider-neutral generation error contract', () => {
  it.each([
    ['missing API key', 'AUTH_MISSING', false],
    ['401 invalid API key', 'AUTH_REJECTED', false],
    ['429 RESOURCE_EXHAUSTED', 'RATE_LIMITED', true],
    ['400 INVALID_ARGUMENT', 'INVALID_INPUT', false],
    ['503 Service Unavailable', 'PROVIDER_TRANSIENT', true],
    ['404 NOT_FOUND model', 'PROVIDER_TERMINAL', false],
    ['request timeout', 'TIMEOUT', true],
  ] as const)('maps %s to %s (retryable=%s)', (message, code, retryable) => {
    expect(normalizeGenerationError(new Error(message))).toMatchObject({ code, retryable });
  });

  it('maps upload failures independently of provider wording', () => {
    expect(normalizeGenerationError(new Error('network disconnected'), { kind: 'upload' }))
      .toMatchObject({ code: 'UPLOAD_FAILED', retryable: true });
  });

  it('does not retry terminal upload authentication failures', () => {
    expect(normalizeGenerationError(new Error('403 PERMISSION_DENIED'), { kind: 'upload' }))
      .toMatchObject({ code: 'AUTH_REJECTED', retryable: false });
  });

  it('returns an identifiable result and provider-neutral progress events', async () => {
    const command = createGenerationCommand('image', { prompt: 'cat' }, {
      id: 'command-1',
      provider: 'Google',
      modelId: 'image-model',
    });
    const onProgress = vi.fn();
    const result = await executeGenerationCommand(command, async input => `${input.prompt}-done`, onProgress);

    expect(result).toEqual({ ok: true, commandId: 'command-1', value: 'cat-done' });
    expect(onProgress.mock.calls.map(([event]) => event.status)).toEqual(['running', 'succeeded']);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      commandId: 'command-1',
      capability: 'image',
      percent: 100,
    }));
  });

  it('does not expose an SDK error object in a failed result', async () => {
    const sdkError = { status: 429, message: 'RESOURCE_EXHAUSTED', response: { secret: true } };
    const command = createGenerationCommand('audio', { text: 'hello' }, { id: 'command-2' });
    const result = await executeGenerationCommand(command, async () => { throw sdkError; });

    expect(result).toEqual({
      ok: false,
      commandId: 'command-2',
      error: expect.objectContaining({ code: 'RATE_LIMITED', retryable: true }),
    });
    if (!result.ok) expect(result.error).not.toHaveProperty('response');
  });
});