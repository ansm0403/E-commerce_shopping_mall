import { ConfigService } from '@nestjs/config';
import { GeminiClient } from './gemini.client';
import type { LlmStreamEvent, LlmToolCall } from '../llm-client.interface';
import { LlmTimeoutError } from '../llm-failure';

/**
 * generateWithTools 의 중단 전파 — SDK 는 mock(`generateContentStream` 이 라운드별 청크를 돌려준다).
 * 확인할 것: 중단되면 **다음 라운드의 LLM 요청을 열지 않고**, 남은 도구도 실행하지 않는다.
 */

type Chunk = { candidates: { content: { parts: Record<string, unknown>[] } }[]; usageMetadata?: object };

const textChunk = (text: string): Chunk => ({ candidates: [{ content: { parts: [{ text }] } }] });
const callChunk = (...names: string[]): Chunk => ({
  candidates: [{ content: { parts: names.map((name) => ({ functionCall: { name, args: {} } })) } }],
});

async function* streamOf(chunks: Chunk[]) {
  for (const c of chunks) yield c;
}

function setup(rounds: Chunk[][], overrides: Record<string, unknown> = {}) {
  const config = {
    get: (key: string, fallback?: unknown) => Object.hasOwn(overrides, key) ? overrides[key] :
      (key === 'GEMINI_API_KEY' ? 'test-key' : fallback),
  } as unknown as ConfigService;
  const client = new GeminiClient(config);
  jest.spyOn(client['logger'], 'debug').mockImplementation(() => undefined);

  let round = 0;
  const generateContentStream = jest.fn(async (_req: { config?: { abortSignal?: AbortSignal } }) =>
    streamOf(rounds[round++] ?? []),
  );
  // 생성자가 만든 진짜 SDK 클라이언트를 mock 으로 바꾼다(네트워크 호출 없음)
  Object.assign(client, { ai: { models: { generateContentStream } } });
  return { client, generateContentStream };
}

const base = { system: { static: 'sys' }, messages: [{ role: 'user' as const, content: 'q' }], tools: [] };

async function collect(iter: AsyncIterable<LlmStreamEvent>) {
  const out: LlmStreamEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

beforeAll(() => {
  // 생성자의 "클라이언트 활성" 로그를 가린다
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('GeminiClient.generateWithTools — 중단(signal)', () => {
  it('recovers once from an initial 503 and measures both SDK requests and the failed request', async () => {
    const { client, generateContentStream } = setup([[textChunk('재시도 답변')]], { GEMINI_RETRY_BASE_MS: 1 });
    const onRequest = jest.fn(); const onRequestFailure = jest.fn();
    jest.spyOn(client['logger'], 'warn').mockImplementation(() => undefined);
    generateContentStream.mockRejectedValueOnce({ status: 503, message: 'API-key=secret contact@example.com' });
    const events = await collect(client.generateWithTools({ ...base, executeTool: jest.fn(), onRequest, onRequestFailure }));
    expect(events.map(event => event.type)).toEqual(['text', 'usage', 'done']);
    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(onRequestFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'LLM_UNAVAILABLE', httpStatus: 503 }));
    expect(JSON.stringify(onRequestFailure.mock.calls)).not.toMatch(/API-key|secret|contact@example.com/);
  });

  it('caps 5xx retries at three per turn by default and exposes persistent failure without a fifth request', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_RETRY_BASE_MS: 1 });
    const onRequestFailure = jest.fn();
    const warn = jest.spyOn(client['logger'], 'warn').mockImplementation(() => undefined);
    generateContentStream.mockRejectedValue({ status: 503 });
    await expect(collect(client.generateWithTools({ ...base, executeTool: jest.fn(), onRequestFailure }))).rejects.toMatchObject({ status: 503 });
    expect(generateContentStream).toHaveBeenCalledTimes(4);
    expect(onRequestFailure).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls.map(([line]) => String(line).match(/delayMs=(\d+)/)?.[1])).toEqual(['1', '2', '4']);
  });

  it('recovers from two consecutive 503s within the retry budget', async () => {
    const { client, generateContentStream } = setup([[textChunk('세 번째 시도 답변')]], { GEMINI_RETRY_BASE_MS: 1 });
    jest.spyOn(client['logger'], 'warn').mockImplementation(() => undefined);
    generateContentStream.mockRejectedValueOnce({ status: 503 }).mockRejectedValueOnce({ status: 502 });
    const events = await collect(client.generateWithTools({ ...base, executeTool: jest.fn() }));
    expect(events.map(event => event.type)).toEqual(['text', 'usage', 'done']);
    expect(generateContentStream).toHaveBeenCalledTimes(3);
  });

  it('does not retry 5xx failures when GEMINI_TURN_RETRIES is 0', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_TURN_RETRIES: 0 });
    generateContentStream.mockRejectedValue({ status: 503 });
    await expect(collect(client.generateWithTools({ ...base, executeTool: jest.fn() }))).rejects.toMatchObject({ status: 503 });
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it.each([['GEMINI_TURN_RETRIES', 6], ['GEMINI_TURN_RETRIES', -1], ['GEMINI_TURN_RETRIES', 1.5], ['GEMINI_RETRY_BASE_MS', 0], ['GEMINI_RETRY_BASE_MS', 10001]])(
    'rejects invalid %s=%s at construction', (key, value) => {
      expect(() => setup([], { [key]: value })).toThrow(`INVALID_${key}`);
    });

  it.each([400, 401, 403, 429])('does not retry permanent/quota HTTP %s failures', async status => {
    const { client, generateContentStream } = setup([]);
    generateContentStream.mockRejectedValueOnce({ status });
    await expect(collect(client.generateWithTools({ ...base, executeTool: jest.fn() }))).rejects.toMatchObject({ status });
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it.each(['text', 'tool'])('does not replay a response with partial %s parts', async part => {
    const { client, generateContentStream } = setup([]);
    const executeTool = jest.fn();
    generateContentStream.mockImplementationOnce(async () => (async function* () {
      yield part === 'text' ? textChunk('부분 답변') : callChunk('summarize_reviews');
      throw { status: 503 };
    })());
    await expect(collect(client.generateWithTools({ ...base, executeTool }))).rejects.toMatchObject({ status: 503 });
    expect(generateContentStream).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it('cancels a pending retry without opening another SDK request', async () => {
    const { client, generateContentStream } = setup([]);
    const abort = new AbortController();
    jest.spyOn(client['logger'], 'warn').mockImplementation(() => { abort.abort(); });
    generateContentStream.mockRejectedValueOnce({ status: 503 });
    expect(await collect(client.generateWithTools({ ...base, executeTool: jest.fn(), signal: abort.signal }))).toEqual([]);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it('shares its retry budget across tool rounds without repeating a completed tool', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_TURN_RETRIES: 1, GEMINI_RETRY_BASE_MS: 1 });
    const executeTool = jest.fn(async () => ({ status: 'no_data' }));
    jest.spyOn(client['logger'], 'warn').mockImplementation(() => undefined);
    generateContentStream.mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce(streamOf([callChunk('summarize_reviews')]))
      .mockRejectedValueOnce({ status: 503 });
    await expect(collect(client.generateWithTools({ ...base, executeTool }))).rejects.toMatchObject({ status: 503 });
    expect(generateContentStream).toHaveBeenCalledTimes(3);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('requests schema-constrained JSON without empty tool declarations for offline judgment', async () => {
    const { client, generateContentStream } = setup([[textChunk('{"passed":true}')]]);
    const responseSchema = { type: 'object', properties: { passed: { type: 'boolean' } }, required: ['passed'] };
    await collect(client.generateWithTools({ ...base, executeTool: jest.fn(), responseSchema }));
    const config = generateContentStream.mock.calls[0][0].config;
    expect(config).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: responseSchema });
    expect(config).not.toHaveProperty('tools');
  });
  it('counts request boundaries rather than individual tools, including failed SDK calls', async () => {
    const { client, generateContentStream } = setup([[callChunk('one', 'two')], [textChunk('answer')]]);
    const onRequest = jest.fn();
    await collect(client.generateWithTools({ ...base, executeTool: jest.fn(async () => ({})), onRequest }));
    expect(onRequest).toHaveBeenCalledTimes(2);
    generateContentStream.mockRejectedValueOnce(new Error('SDK request with test@example.com'));
    await expect(collect(client.generateWithTools({ ...base, executeTool: jest.fn(), onRequest }))).rejects.toThrow();
    expect(onRequest).toHaveBeenCalledTimes(3);
  });
  it('중단이 없으면 도구 라운드 뒤 다음 라운드를 열어 답변을 잇는다(기준선)', async () => {
    const { client, generateContentStream } = setup([[callChunk('get_sales_summary')], [textChunk('답변')]]);
    const executeTool = jest.fn(async () => ({ total: 0 }));

    const events = await collect(client.generateWithTools({ ...base, executeTool }));

    expect(generateContentStream).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(['tool_call', 'text', 'usage', 'done']);
  });

  it('도구 실행 중 중단되면 다음 라운드의 generateContentStream 을 호출하지 않는다', async () => {
    const controller = new AbortController();
    const { client, generateContentStream } = setup([[callChunk('get_sales_summary')], [textChunk('보지 못할 답변')]]);
    const executeTool = jest.fn(async () => {
      controller.abort(); // 도구(DB 조회)가 도는 동안 클라이언트가 중지
      return { total: 0 };
    });

    const events = await collect(client.generateWithTools({ ...base, executeTool, signal: controller.signal }));

    expect(generateContentStream).toHaveBeenCalledTimes(1);
    // usage·done 없이 끝난다 — 호출 측은 signal 로 중단을 안다
    expect(events.map((e) => e.type)).toEqual(['tool_call']);
  });

  it('한 라운드에 도구가 2개일 때 첫 도구 중 중단되면 두 번째 도구는 실행하지 않는다', async () => {
    const controller = new AbortController();
    const { client, generateContentStream } = setup([[callChunk('get_sales_summary', 'get_order_stats')], []]);
    const executed: string[] = [];
    const executeTool = jest.fn(async (call: LlmToolCall) => {
      executed.push(call.name);
      controller.abort();
      return {};
    });

    await collect(client.generateWithTools({ ...base, executeTool, signal: controller.signal }));

    expect(executed).toEqual(['get_sales_summary']);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it('does not execute a tool if cancellation arrives while its tool event is being consumed', async () => {
    const abort = new AbortController();
    const { client, generateContentStream } = setup([[callChunk('summarize_reviews')]]);
    const executeTool = jest.fn(async () => ({}));
    const events: LlmStreamEvent[] = [];
    for await (const event of client.generateWithTools({ ...base, executeTool, signal: abort.signal })) {
      events.push(event);
      if (event.type === 'tool_call') abort.abort();
    }
    expect(events.map(event => event.type)).toEqual(['tool_call']);
    expect(executeTool).not.toHaveBeenCalled();
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it('ignores SDK chunks arriving after cancellation and emits no successful completion', async () => {
    const abort = new AbortController();
    const { client, generateContentStream } = setup([]);
    generateContentStream.mockImplementationOnce(async () => (async function* () {
      abort.abort();
      yield textChunk('늦게 도착한 답변');
    })());
    expect(await collect(client.generateWithTools({ ...base, executeTool: jest.fn(), signal: abort.signal }))).toEqual([]);
  });

  it('이미 중단된 signal 로 부르면 첫 라운드도 열지 않는다', async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, generateContentStream } = setup([[textChunk('답변')]]);

    const events = await collect(
      client.generateWithTools({ ...base, executeTool: jest.fn(), signal: controller.signal }),
    );

    expect(generateContentStream).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('does not count or send an SDK request canceled while waiting for evaluation pacing', async () => {
    const abort = new AbortController();
    const { client, generateContentStream } = setup([]);
    const onRequest = jest.fn();
    const events = await collect(client.generateWithTools({ ...base, signal: abort.signal,
      beforeRequest: async () => { abort.abort(); }, onRequest, executeTool: jest.fn() }));
    expect(events).toEqual([]);
    expect(onRequest).not.toHaveBeenCalled();
    expect(generateContentStream).not.toHaveBeenCalled();
  });

  it('sanitizes callback failures before the next SDK request', async () => {
    const { client, generateContentStream } = setup([[callChunk('summarize_reviews')], [textChunk('조회 실패')]]);
    const executeTool = jest.fn(async () => { throw new Error('secret@example.com 010-1234-5678 SQL password'); });
    await collect(client.generateWithTools({ ...base, executeTool }));
    const contents = (generateContentStream.mock.calls[1][0] as { contents?: unknown }).contents;
    expect(JSON.stringify(contents)).toContain('TOOL_UNAVAILABLE');
    expect(JSON.stringify(contents)).not.toMatch(/secret@example.com|010-1234-5678|SQL password/);
  });

  it('forwards caller cancellation to its owned SDK signal during an outstanding request', async () => {
    const controller = new AbortController();
    const { client, generateContentStream } = setup([]);
    generateContentStream.mockImplementationOnce(async request => {
      expect(request.config?.abortSignal).not.toBe(controller.signal);
      controller.abort();
      expect(request.config?.abortSignal?.aborted).toBe(true);
      throw Object.assign(new Error('synthetic SDK cancellation'), { name: 'AbortError' });
    });

    expect(await collect(client.generateWithTools({ ...base, executeTool: jest.fn(), signal: controller.signal }))).toEqual([]);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });

  it('supplies an owned SDK deadline signal without a caller signal and removes the SDK timeout', async () => {
    const { client, generateContentStream } = setup([[textChunk('답변')]]);

    await collect(client.generateWithTools({ ...base, executeTool: jest.fn() }));

    expect(generateContentStream.mock.calls[0][0].config?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(generateContentStream.mock.calls[0][0].config?.abortSignal?.aborted).toBe(false);
    expect(generateContentStream.mock.calls[0][0].config).toMatchObject({ httpOptions: { retryOptions: { attempts: 1 } } });
    expect(generateContentStream.mock.calls[0][0].config).not.toHaveProperty('httpOptions.timeout');
  });
});

const observed = <T>(promise: Promise<T>) => promise.then(
  value => ({ value, error: undefined }), error => ({ value: undefined, error }),
);
const delayed = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));
const iterable = (iterator: AsyncIterator<Chunk>) => ({ [Symbol.asyncIterator]: () => iterator }) as ReturnType<typeof streamOf>;

describe('GeminiClient app-owned request and turn deadlines', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('bounds stream creation that ignores abort and emits safe timeout diagnostics', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_REQUEST_TIMEOUT_MS: 100, GEMINI_TURN_TIMEOUT_MS: 500 });
    const caller = new AbortController(); const onRequest = jest.fn(); const onRequestFailure = jest.fn();
    generateContentStream.mockImplementation(() => new Promise<ReturnType<typeof streamOf>>(() => undefined));
    const result = observed(collect(client.generateWithTools({ ...base, signal: caller.signal, executeTool: jest.fn(), onRequest, onRequestFailure })));

    await jest.advanceTimersByTimeAsync(100);

    expect((await result).error).toBeInstanceOf(LlmTimeoutError);
    expect(onRequestFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'LLM_TIMEOUT', httpStatus: null,
      timeoutScope: 'request', timeoutMs: 100, elapsedMs: 100 }));
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(generateContentStream.mock.calls[0][0].config?.abortSignal?.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds an ignored-abort next() and never waits for a hung iterator.return()', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_REQUEST_TIMEOUT_MS: 100 });
    const iterator = {
      next: jest.fn(() => new Promise<IteratorResult<Chunk>>(() => undefined)),
      return: jest.fn(() => new Promise<IteratorResult<Chunk>>(() => undefined)),
    };
    generateContentStream.mockResolvedValueOnce(iterable(iterator));
    const result = observed(collect(client.generateWithTools({ ...base, executeTool: jest.fn() })));
    await jest.advanceTimersByTimeAsync(100);

    expect((await result).error).toMatchObject({ name: 'TimeoutError', timeoutScope: 'request' });
    expect(iterator.next).toHaveBeenCalledTimes(1);
    expect(iterator.return).toHaveBeenCalledTimes(1);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops after a 503 followed by a timed-out retry without a third request', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_REQUEST_TIMEOUT_MS: 100 });
    jest.spyOn(client['logger'], 'warn').mockImplementation(() => undefined);
    const onRequestFailure = jest.fn();
    generateContentStream.mockRejectedValueOnce({ status: 503 })
      .mockImplementation(() => new Promise<ReturnType<typeof streamOf>>(() => undefined));
    const result = observed(collect(client.generateWithTools({ ...base, executeTool: jest.fn(), onRequestFailure })));
    await jest.advanceTimersByTimeAsync(1100);

    expect((await result).error).toMatchObject({ timeoutScope: 'request', timeoutMs: 100 });
    expect(onRequestFailure.mock.calls.map(([failure]) => failure.code)).toEqual(['LLM_UNAVAILABLE', 'LLM_TIMEOUT']);
    await jest.advanceTimersByTimeAsync(5000);
    expect(generateContentStream).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('closes an iterator created after its initial stream promise has already timed out', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_REQUEST_TIMEOUT_MS: 100 });
    const iterator = { next: jest.fn(async () => ({ done: true as const, value: undefined })),
      return: jest.fn(async () => ({ done: true as const, value: undefined })) };
    generateContentStream.mockImplementationOnce(() => delayed(150, iterable(iterator)));
    const result = observed(collect(client.generateWithTools({ ...base, executeTool: jest.fn() })));
    await jest.advanceTimersByTimeAsync(100);
    expect((await result).error).toBeInstanceOf(LlmTimeoutError);
    await jest.advanceTimersByTimeAsync(50);

    expect(iterator.return).toHaveBeenCalledTimes(1);
    expect(iterator.next).not.toHaveBeenCalled();
    expect(generateContentStream).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not replay a completed tool when its answer request gets a 503 and then times out', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_REQUEST_TIMEOUT_MS: 100 });
    jest.spyOn(client['logger'], 'warn').mockImplementation(() => undefined);
    const executeTool = jest.fn(async () => ({ status: 'no_data' }));
    generateContentStream.mockResolvedValueOnce(streamOf([callChunk('summarize_reviews')]))
      .mockRejectedValueOnce({ status: 503 })
      .mockImplementation(() => new Promise<ReturnType<typeof streamOf>>(() => undefined));
    const result = observed(collect(client.generateWithTools({ ...base, executeTool })));
    await jest.advanceTimersByTimeAsync(1100);

    expect((await result).error).toMatchObject({ timeoutScope: 'request' });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(generateContentStream).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not retry or duplicate partial text when the following stream read times out', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_REQUEST_TIMEOUT_MS: 100 });
    const iterator = {
      next: jest.fn<Promise<IteratorResult<Chunk>>, []>()
        .mockResolvedValueOnce({ done: false, value: textChunk('부분 답변') })
        .mockImplementation(() => new Promise<IteratorResult<Chunk>>(() => undefined)),
      return: jest.fn(async () => ({ done: true as const, value: undefined })),
    };
    generateContentStream.mockResolvedValueOnce(iterable(iterator));
    const events: LlmStreamEvent[] = [];
    const result = observed((async () => {
      for await (const event of client.generateWithTools({ ...base, executeTool: jest.fn() })) events.push(event);
    })());
    await jest.advanceTimersByTimeAsync(100);

    expect((await result).error).toMatchObject({ timeoutScope: 'request' });
    expect(events).toEqual([{ type: 'text', delta: '부분 답변' }]);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
    expect(iterator.return).toHaveBeenCalledTimes(1);
  });

  it('caps cumulative SDK wait across tool rounds without charging a slow tool to that budget', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_REQUEST_TIMEOUT_MS: 100, GEMINI_TURN_TIMEOUT_MS: 150 });
    const executeTool = jest.fn(() => delayed(5000, { status: 'no_data' }));
    generateContentStream.mockImplementationOnce(() => delayed(80, streamOf([callChunk('summarize_reviews')])))
      .mockImplementationOnce(() => delayed(80, streamOf([textChunk('late answer')])));
    const result = observed(collect(client.generateWithTools({ ...base, executeTool })));
    await jest.advanceTimersByTimeAsync(80);
    expect(executeTool).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(generateContentStream).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(70);

    expect((await result).error).toMatchObject({ timeoutScope: 'turn', timeoutMs: 150, elapsedMs: 150 });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(generateContentStream).toHaveBeenCalledTimes(2);
    // The intentionally ignored SDK abort resolves ten milliseconds later and is closed safely.
    await jest.advanceTimersByTimeAsync(10);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not spend request time while a text event consumer is paused', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_REQUEST_TIMEOUT_MS: 100 });
    generateContentStream.mockImplementationOnce(async () => (async function* () {
      yield textChunk('first');
      await delayed(80, undefined);
      yield textChunk('second');
    })());
    const stream = client.generateWithTools({ ...base, executeTool: jest.fn() })[Symbol.asyncIterator]();
    const first = stream.next();
    await jest.advanceTimersByTimeAsync(0);
    expect((await first).value).toEqual({ type: 'text', delta: 'first' });
    await jest.advanceTimersByTimeAsync(5000);
    expect(generateContentStream.mock.calls[0][0].config?.abortSignal?.aborted).toBe(false);
    const rest = collect({ [Symbol.asyncIterator]: () => stream });
    await jest.advanceTimersByTimeAsync(80);

    expect((await rest).map(event => event.type)).toEqual(['text', 'usage', 'done']);
    expect(generateContentStream).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('settles a hanging SDK request immediately on caller abort without retry or completion', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_REQUEST_TIMEOUT_MS: 100 });
    const caller = new AbortController(); const onRequestFailure = jest.fn();
    generateContentStream.mockImplementation(() => new Promise<ReturnType<typeof streamOf>>(() => undefined));
    const result = collect(client.generateWithTools({ ...base, signal: caller.signal, executeTool: jest.fn(), onRequestFailure }));
    await jest.advanceTimersByTimeAsync(20);
    caller.abort();

    expect(await result).toEqual([]);
    expect(onRequestFailure).toHaveBeenCalledWith(expect.objectContaining({ code: 'ABORTED' }));
    expect(generateContentStream).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds a hanging optional cache, falls back to implicit generation and attempts the cache only once', async () => {
    const { client, generateContentStream } = setup([[textChunk('first')], [textChunk('second')]], {
      GEMINI_EXPLICIT_CACHE: 'true', GEMINI_REQUEST_TIMEOUT_MS: 100, GEMINI_TURN_TIMEOUT_MS: 500,
    });
    jest.spyOn(client['logger'], 'warn').mockImplementation(() => undefined);
    const create = jest.fn((_request: { config: { abortSignal: AbortSignal } }) => new Promise<{ name: string }>(() => undefined));
    Object.assign(client, { ai: { models: { generateContentStream }, caches: { create } } });
    const first = collect(client.generateWithTools({ ...base, executeTool: jest.fn() }));
    await jest.advanceTimersByTimeAsync(100);

    expect((await first).map(event => event.type)).toEqual(['text', 'usage', 'done']);
    expect(create.mock.calls[0][0].config.abortSignal.aborted).toBe(true);
    expect(generateContentStream.mock.calls[0][0].config).not.toHaveProperty('cachedContent');
    expect(client['cacheName']).toBeNull();
    expect((await collect(client.generateWithTools({ ...base, executeTool: jest.fn() }))).map(event => event.type))
      .toEqual(['text', 'usage', 'done']);
    expect(create).toHaveBeenCalledTimes(1);
    expect(generateContentStream).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels optional cache creation without starting a generation request', async () => {
    const { client, generateContentStream } = setup([], { GEMINI_EXPLICIT_CACHE: 'true', GEMINI_REQUEST_TIMEOUT_MS: 100 });
    jest.spyOn(client['logger'], 'warn').mockImplementation(() => undefined);
    const create = jest.fn((_request: { config: { abortSignal: AbortSignal } }) => new Promise<{ name: string }>(() => undefined));
    Object.assign(client, { ai: { models: { generateContentStream }, caches: { create } } });
    const caller = new AbortController(); const onRequest = jest.fn();
    const result = collect(client.generateWithTools({ ...base, signal: caller.signal, executeTool: jest.fn(), onRequest }));
    await jest.advanceTimersByTimeAsync(20);
    caller.abort();

    expect(await result).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].config.abortSignal.aborted).toBe(true);
    expect(generateContentStream).not.toHaveBeenCalled();
    expect(onRequest).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not apply an optional cache response that arrives after its timeout', async () => {
    const { client, generateContentStream } = setup([[textChunk('implicit answer')], [textChunk('still implicit')]], {
      GEMINI_EXPLICIT_CACHE: 'true', GEMINI_REQUEST_TIMEOUT_MS: 100, GEMINI_TURN_TIMEOUT_MS: 500,
    });
    jest.spyOn(client['logger'], 'warn').mockImplementation(() => undefined);
    const create = jest.fn(() => delayed(150, { name: 'cachedContents/late-synthetic-cache' }));
    Object.assign(client, { ai: { models: { generateContentStream }, caches: { create } } });
    const result = collect(client.generateWithTools({ ...base, executeTool: jest.fn() }));
    await jest.advanceTimersByTimeAsync(100);
    expect((await result).map(event => event.type)).toEqual(['text', 'usage', 'done']);
    await jest.advanceTimersByTimeAsync(50);

    expect(client['cacheName']).toBeNull();
    await collect(client.generateWithTools({ ...base, executeTool: jest.fn() }));
    expect(generateContentStream.mock.calls[1][0].config).not.toHaveProperty('cachedContent');
    expect(create).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('GeminiClient deadline configuration', () => {
  it('uses request60s and cumulative SDK wait180s defaults', () => {
    const { client } = setup([]);
    expect(client['requestTimeoutMs']).toBe(60000);
    expect(client['turnTimeoutMs']).toBe(180000);
  });

  it('accepts numeric strings and the explicit maximum bounds', () => {
    const { client } = setup([], { GEMINI_REQUEST_TIMEOUT_MS: '120000', GEMINI_TURN_TIMEOUT_MS: '300000' });
    expect(client['requestTimeoutMs']).toBe(120000);
    expect(client['turnTimeoutMs']).toBe(300000);
  });

  it('accepts a shorter positive turn budget and minimum1ms bounds', () => {
    const { client } = setup([], { GEMINI_REQUEST_TIMEOUT_MS: 2, GEMINI_TURN_TIMEOUT_MS: 1 });
    expect(client['requestTimeoutMs']).toBe(2);
    expect(client['turnTimeoutMs']).toBe(1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'secret@example.com', null, true, 120001])
    ('rejects invalid request timeout configuration without exposing the configured value %#', value => {
      expect(() => setup([], { GEMINI_REQUEST_TIMEOUT_MS: value })).toThrow('INVALID_GEMINI_REQUEST_TIMEOUT_MS');
    });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'secret@example.com', null, true, 300001])
    ('rejects invalid turn timeout configuration without exposing the configured value %#', value => {
      expect(() => setup([], { GEMINI_TURN_TIMEOUT_MS: value })).toThrow('INVALID_GEMINI_TURN_TIMEOUT_MS');
    });
});
