export type LlmFailureCode = 'ABORTED' | 'LLM_RATE_LIMIT' | 'LLM_PERMISSION' | 'LLM_INVALID_REQUEST' |
  'LLM_TIMEOUT' | 'LLM_NETWORK_ERROR' | 'LLM_UNAVAILABLE' | 'ASSISTANT_UNAVAILABLE';

export const LLM_FAILURE_MESSAGES: Record<LlmFailureCode, string> = {
  ABORTED: '요청이 중단됐습니다.',
  LLM_RATE_LIMIT: 'AI 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
  LLM_PERMISSION: 'AI 서비스 인증·권한 설정을 확인해주세요.',
  LLM_INVALID_REQUEST: 'AI 요청 설정에 문제가 있습니다. 서버 설정을 확인해주세요.',
  LLM_TIMEOUT: 'AI 응답 대기 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.',
  LLM_NETWORK_ERROR: 'AI 서비스 연결이 끊겼습니다. 잠시 후 다시 시도해주세요.',
  LLM_UNAVAILABLE: 'AI 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.',
  ASSISTANT_UNAVAILABLE: 'AI 응답 생성에 실패했습니다.',
};

export interface LlmFailure {
  code: LlmFailureCode; httpStatus: number | null; message: string;
  timeoutScope?: 'request' | 'turn'; timeoutMs?: number; elapsedMs?: number;
}

/** App-owned deadline metadata; contains no provider error body or input. */
export class LlmTimeoutError extends Error {
  constructor(readonly timeoutScope: 'request' | 'turn', readonly timeoutMs: number, readonly elapsedMs: number) {
    super('LLM_TIMEOUT'); this.name = 'TimeoutError';
  }
}

/** Return allowlisted scalars only; never retain SDK messages, bodies, headers or causes. */
export function classifyLlmFailure(error: unknown, aborted = false): LlmFailure {
  const value = error && typeof error === 'object' ? error as { status?: unknown; name?: unknown; code?: unknown; cause?: { code?: unknown } } : {};
  const status = typeof value.status === 'number' ? value.status :
    typeof value.status === 'string' && /^[1-5]\d{2}$/.test(value.status) ? Number(value.status) : Number.NaN;
  const httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const name = typeof value.name === 'string' ? value.name : '';
  const transportCode = typeof value.cause?.code === 'string' ? value.cause.code : typeof value.code === 'string' ? value.code : '';
  let code: LlmFailureCode;
  if (aborted) code = 'ABORTED';
  else if (httpStatus === 429) code = 'LLM_RATE_LIMIT';
  else if (httpStatus === 401 || httpStatus === 403) code = 'LLM_PERMISSION';
  else if (httpStatus === 408 || httpStatus === 504 || ['TimeoutError', 'APIConnectionTimeoutError'].includes(name) ||
    ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(transportCode)) code = 'LLM_TIMEOUT';
  else if (httpStatus !== null && httpStatus >= 500) code = 'LLM_UNAVAILABLE';
  else if (httpStatus !== null && httpStatus >= 400) code = 'LLM_INVALID_REQUEST';
  else if (['AbortError', 'APIConnectionError'].includes(name) ||
    ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_SOCKET'].includes(transportCode)) code = 'LLM_NETWORK_ERROR';
  else code = 'ASSISTANT_UNAVAILABLE';
  return { code, httpStatus, message: LLM_FAILURE_MESSAGES[code],
    ...(!aborted && error instanceof LlmTimeoutError ? {
      timeoutScope: error.timeoutScope, timeoutMs: error.timeoutMs, elapsedMs: Math.round(error.elapsedMs),
    } : {}) };
}
