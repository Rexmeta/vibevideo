import type {
  GenerationCapability,
  GenerationCommand,
  GenerationError,
  GenerationProgressEvent,
  GenerationResult,
} from '../types';

let sequence = 0;

export const createGenerationCommand = <TInput>(
  capability: GenerationCapability,
  input: TInput,
  options: { provider?: string; modelId?: string; id?: string } = {},
): GenerationCommand<TInput> => ({
  id: options.id || `gen-${capability}-${Date.now().toString(36)}-${(++sequence).toString(36)}`,
  capability,
  input,
  provider: options.provider,
  modelId: options.modelId,
});

const textOf = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; status?: unknown; code?: unknown; name?: unknown };
    return [candidate.message, candidate.status, candidate.code, candidate.name]
      .filter(value => value !== undefined)
      .map(String)
      .join(' ');
  }
  return String(error || '');
};

export const normalizeGenerationError = (
  error: unknown,
  context: { provider?: string; operation?: string; kind?: 'generation' | 'upload' } = {},
): GenerationError => {
  if (error && typeof error === 'object' && 'code' in error && 'retryable' in error && 'message' in error) {
    const candidate = error as Partial<GenerationError>;
    const stableCodes = new Set([
      'AUTH_MISSING', 'AUTH_REJECTED', 'RATE_LIMITED', 'INVALID_INPUT',
      'PROVIDER_TRANSIENT', 'PROVIDER_TERMINAL', 'TIMEOUT', 'UPLOAD_FAILED',
      'CANCELLED', 'UNKNOWN',
    ]);
    if (candidate.code && stableCodes.has(candidate.code) && typeof candidate.message === 'string') {
      return {
        code: candidate.code,
        retryable: candidate.retryable === true,
        message: candidate.message,
        provider: context.provider || candidate.provider,
        operation: context.operation || candidate.operation,
      };
    }
  }
  const raw = textOf(error);
  const lower = raw.toLowerCase();
  const base = { provider: context.provider, operation: context.operation };
  const authOrCancel = lower.includes('401') || lower.includes('403') ||
    lower.includes('unauthenticated') || lower.includes('permission_denied') ||
    lower.includes('invalid api key') || lower.includes('abort') || lower.includes('취소');
  if ((context.kind === 'upload' || lower.includes('upload') || lower.includes('storage')) && !authOrCancel) {
    return { ...base, code: 'UPLOAD_FAILED', retryable: true, message: '파일 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (lower.includes('abort') || lower.includes('취소')) {
    return { ...base, code: 'CANCELLED', retryable: false, message: '생성이 취소되었습니다.' };
  }
  if (lower.includes('api 키가 설정되지') || lower.includes('missing api key') || lower.includes('no api key')) {
    return { ...base, code: 'AUTH_MISSING', retryable: false, message: 'API 키가 설정되지 않았습니다. 관리 페이지에서 API 키를 설정해주세요.' };
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthenticated') || lower.includes('permission_denied') || lower.includes('invalid api key')) {
    return { ...base, code: 'AUTH_REJECTED', retryable: false, message: 'API 키가 거부되었습니다. 키와 권한을 확인해 주세요.' };
  }
  if (lower.includes('429') || lower.includes('resource_exhausted') || lower.includes('rate limit') || lower.includes('요청 한도')) {
    return { ...base, code: 'RATE_LIMITED', retryable: true, message: 'Gemini 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (lower.includes('시간 초과') || lower.includes('timeout') || lower.includes('deadline_exceeded')) {
    return { ...base, code: 'TIMEOUT', retryable: true, message: 'Gemini 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (lower.includes('400') || lower.includes('invalid_argument') || lower.includes('잘못된 입력')) {
    return { ...base, code: 'INVALID_INPUT', retryable: false, message: '생성 입력이 올바르지 않습니다. 입력 내용을 확인해 주세요.' };
  }
  if (lower.includes('500') || lower.includes('503') || (lower.includes('unavailable') && !lower.startsWith('provider unavailable')) || lower.includes('overloaded') || lower.includes('high demand') || lower.includes('internal')) {
    return { ...base, code: 'PROVIDER_TRANSIENT', retryable: true, message: 'Gemini 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해 주세요.' };
  }
  if (lower.includes('404') || lower.includes('not_found') || lower.includes('unsupported') || lower.includes('failed_precondition')) {
    return { ...base, code: 'PROVIDER_TERMINAL', retryable: false, message: '선택한 모델에서 요청을 처리할 수 없습니다. 모델 설정을 확인해 주세요.' };
  }
  if (lower.startsWith('provider unavailable')) {
    return { ...base, code: 'UNKNOWN', retryable: false, message: 'provider unavailable' };
  }
  return {
    ...base,
    code: 'UNKNOWN',
    retryable: false,
    message: '생성 중 알 수 없는 오류가 발생했습니다.',
  };
};

export const executeGenerationCommand = async <TInput, TOutput>(
  command: GenerationCommand<TInput>,
  execute: (input: TInput) => Promise<TOutput>,
  onProgress?: (event: GenerationProgressEvent) => void,
): Promise<GenerationResult<TOutput>> => {
  onProgress?.({ commandId: command.id, capability: command.capability, status: 'running', percent: 0 });
  try {
    const value = await execute(command.input);
    onProgress?.({ commandId: command.id, capability: command.capability, status: 'succeeded', percent: 100 });
    return { ok: true, commandId: command.id, value };
  } catch (error) {
    const normalized = normalizeGenerationError(error, {
      provider: command.provider,
      operation: command.id,
    });
    onProgress?.({ commandId: command.id, capability: command.capability, status: 'failed', message: normalized.message });
    return { ok: false, commandId: command.id, error: normalized };
  }
};

export const throwGenerationFailure = <T>(result: GenerationResult<T>): T => {
  if (result.ok) return result.value;
  const error = new Error(result.error.message);
  Object.assign(error, result.error, { name: 'GenerationContractError' });
  throw error;
};