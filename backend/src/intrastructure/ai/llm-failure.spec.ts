import { classifyLlmFailure, LlmTimeoutError } from './llm-failure';

describe('LLM safe failure classification', () => {
  it.each([
    [429, 'LLM_RATE_LIMIT'], [401, 'LLM_PERMISSION'], [403, 'LLM_PERMISSION'],
    [400, 'LLM_INVALID_REQUEST'], [404, 'LLM_INVALID_REQUEST'], [422, 'LLM_INVALID_REQUEST'],
    [408, 'LLM_TIMEOUT'], [504, 'LLM_TIMEOUT'], [500, 'LLM_UNAVAILABLE'], [502, 'LLM_UNAVAILABLE'], [503, 'LLM_UNAVAILABLE'],
  ])('classifies HTTP %s without exposing SDK data', (status, code) => {
    const result = classifyLlmFailure({ status, message: 'contact@example.com API-key=secret', response: { request: 'raw request' } });
    expect(result).toMatchObject({ code, httpStatus: status });
    expect(JSON.stringify(result)).not.toMatch(/contact@example.com|API-key|secret|raw request/);
  });

  it.each([
    [{ name: 'TimeoutError' }, 'LLM_TIMEOUT'], [{ name: 'APIConnectionTimeoutError' }, 'LLM_TIMEOUT'],
    [{ cause: { code: 'UND_ERR_BODY_TIMEOUT' } }, 'LLM_TIMEOUT'],
    [{ name: 'AbortError' }, 'LLM_NETWORK_ERROR'], [{ cause: { code: 'ECONNRESET' } }, 'LLM_NETWORK_ERROR'],
  ])('classifies transport failures with allowlisted values %#', (error, code) => {
    expect(classifyLlmFailure(error)).toMatchObject({ code, httpStatus: null });
  });

  it('keeps cancellation separate from provider failures and accepts an SDK numeric status string', () => {
    expect(classifyLlmFailure({ status: 503 }, true).code).toBe('ABORTED');
    expect(classifyLlmFailure({ status: '429' }).code).toBe('LLM_RATE_LIMIT');
  });

  it.each(['request', 'turn'] as const)('exposes only safe typed %s timeout metadata', scope => {
    const error = Object.assign(new LlmTimeoutError(scope, 60000, 60000.4), {
      message: 'contact@example.com API-key=secret', response: { request: 'raw request' },
      cause: new Error('SDK body contains a secret'),
    });
    const result = classifyLlmFailure(error);
    expect(result).toMatchObject({ code: 'LLM_TIMEOUT', httpStatus: null,
      timeoutScope: scope, timeoutMs: 60000, elapsedMs: 60000 });
    expect(JSON.stringify(result)).not.toMatch(/contact@example.com|API-key|secret|raw request/);
  });

  it('does not copy forged timeout metadata from an untrusted SDK error shape', () => {
    const result = classifyLlmFailure({ name: 'TimeoutError', timeoutScope: 'contact@example.com',
      timeoutMs: 'API-key=secret', elapsedMs: 'raw request' });
    expect(result).toMatchObject({ code: 'LLM_TIMEOUT', httpStatus: null });
    expect(result).not.toHaveProperty('timeoutScope');
    expect(result).not.toHaveProperty('timeoutMs');
    expect(result).not.toHaveProperty('elapsedMs');
  });

  it('omits provider timeout metadata when the caller has canceled', () => {
    const result = classifyLlmFailure(new LlmTimeoutError('request', 60000, 60000), true);
    expect(result).toMatchObject({ code: 'ABORTED', httpStatus: null });
    expect(result).not.toHaveProperty('timeoutScope');
  });

  it.each([null, 'API-key=secret', { status: Symbol('secret') }, { status: Number.NaN }, { status: 'secret', name: 'contact@example.com' }])
    ('safely handles unknown shapes without parsing raw error messages %#', error => {
      expect(classifyLlmFailure(error)).toEqual({ code: 'ASSISTANT_UNAVAILABLE', httpStatus: null, message: 'AI 응답 생성에 실패했습니다.' });
    });
});
