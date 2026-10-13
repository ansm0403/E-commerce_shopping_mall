import type { ConfigService } from '@nestjs/config';
import type { EmbedContentResponse } from '@google/genai';
import { GeminiEmbeddingClient } from './gemini-embedding.client';
import { SearchError } from '../../../search/search-error';

function config(values: Record<string, unknown> = {}) {
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback } as Pick<ConfigService, 'get'>;
}
const vector = () => [1, ...Array(767).fill(0)];

describe('Gemini embedding boundary', () => {
  it('sends independent masked strings with dimensions and no taskType', async () => {
    const transport = jest.fn(async () => ({ embeddings: [{ values: vector() }] }));
    const client = new GeminiEmbeddingClient(config({ AI_SEARCH_EMBEDDING_RPM: 60000 }), transport);
    const result = await client.embed(['a@test.local', '두 번째 문서']);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0][0]).toMatchObject({ model: 'gemini-embedding-2', contents: 'a***@***', config: { outputDimensionality: 768 } });
    expect(transport.mock.calls[0][0].config).not.toHaveProperty('taskType');
    expect(result.vectors).toHaveLength(2);
    expect(result.usage).toMatchObject({ requests: 2, inputTokens: null });
  });

  it.each([
    [], [{ values: [1] }], [{ values: Array(768).fill(0) }],
    [{ values: [NaN, ...Array(767).fill(1)] }], [{ values: vector() }, { values: vector() }],
    [{ values: Object.assign(Array(768), { 0: 1 }) }],
    [{ values: Array(768).fill(1e-50) }], [{ values: [1e100, ...Array(767).fill(0)] }],
  ].map(embeddings => ({ embeddings })))('rejects malformed or aggregated responses %#', async ({ embeddings }) => {
    const client = new GeminiEmbeddingClient(config(), async () => ({ embeddings }));
    await expect(client.embed(['문서'])).rejects.toMatchObject({ code: 'INVALID_EMBEDDING', retryable: false });
  });

  it('rejects the whole input batch before any external request', async () => {
    const transport = jest.fn();
    const client = new GeminiEmbeddingClient(config(), transport);
    await expect(client.embed(['유효', ' '])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([null, { embeddings: [null] }, { embeddings: { length: 1, 0: { values: vector() } } }])
    ('classifies missing response records as a permanent protocol error %#', async response => {
      const client = new GeminiEmbeddingClient(config(), async () => response as EmbedContentResponse);
      await expect(client.embed(['document'])).rejects.toMatchObject({ code: 'INVALID_EMBEDDING', retryable: false });
    });

  it('fails closed for missing key and profile mismatch', async () => {
    const disabled = new GeminiEmbeddingClient(config());
    expect(disabled.isEnabled()).toBe(false);
    await expect(disabled.embed(['문서'])).rejects.toMatchObject({ code: 'EMBEDDING_DISABLED' });
    const transport = jest.fn();
    const mismatch = new GeminiEmbeddingClient(config({ GEMINI_EMBEDDING_DIMENSIONS: 1536 }), transport);
    expect(mismatch.isEnabled()).toBe(false);
    await expect(mismatch.embed(['문서'])).rejects.toMatchObject({ code: 'PROFILE_MISMATCH' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('counts failed requests while keeping provider error text out of the result', async () => {
    const client = new GeminiEmbeddingClient(config(), async () => { throw { status: 429, headers: { 'retry-after': '2' }, message: 'secret@example.com key' }; });
    await expect(client.embed(['문서'])).rejects.toMatchObject({ message: 'EMBEDDING_RATE_LIMIT', retryable: true, retryAfterMs: 2000 });
    expect(client.snapshot().requests).toBe(1);
  });

  it('aborts before calling the transport', async () => {
    const transport = jest.fn();
    const client = new GeminiEmbeddingClient(config(), transport);
    await expect(client.embed(['문서'], AbortSignal.abort())).rejects.toMatchObject({ code: 'ABORTED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('rechecks current source at the external request boundary and skips a changed source', async () => {
    const transport = jest.fn();
    const client = new GeminiEmbeddingClient(config(), transport);
    await expect(client.embed(['마스킹한 문서'], undefined, async () => { throw new SearchError('SOURCE_CHANGED'); }))
      .rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    expect(transport).not.toHaveBeenCalled();
    expect(client.snapshot().requests).toBe(0);
  });

  it('keeps per-call usage separate for concurrent callers', async () => {
    const client = new GeminiEmbeddingClient(config({ AI_SEARCH_EMBEDDING_RPM: 60000 }), async () => ({ embeddings: [{ values: vector() }] }));
    const [first, second] = await Promise.all([client.embed(['첫 입력', '둘째 입력']), client.embed(['다른 입력'])]);
    expect(first.usage.requests).toBe(2);
    expect(second.usage.requests).toBe(1);
    expect(client.snapshot().requests).toBe(3);
  });

  it('enforces a deadline even when the transport ignores its abort signal and ignores its late result', async () => {
    let release!: (response: { embeddings: { values: number[] }[] }) => void;
    const late = new Promise<{ embeddings: { values: number[] }[] }>(resolve => { release = resolve; });
    const transport = jest.fn().mockReturnValueOnce(late).mockResolvedValue({ embeddings: [{ values: vector() }] });
    const client = new GeminiEmbeddingClient(config({ AI_SEARCH_EMBEDDING_TIMEOUT_MS: 20, AI_SEARCH_EMBEDDING_RPM: 60000 }), transport);
    const outcome = client.embed(['first']).then(() => 'accepted', error => error.code);
    let timer!: ReturnType<typeof setTimeout>;
    try {
      const result = await Promise.race([outcome, new Promise<string>(resolve => { timer = setTimeout(() => resolve('blocked'), 300); })]);
      expect(result).toBe('EMBEDDING_TIMEOUT');
    } finally { clearTimeout(timer); release({ embeddings: [{ values: vector() }] }); await outcome; }
    expect((await client.embed(['next'])).vectors).toEqual([vector()]);
    expect(client.snapshot().requests).toBe(2);
  });

  it('cancels a queued caller promptly without sending it and preserves the queue for subsequent callers', async () => {
    let release!: (response: { embeddings: { values: number[] }[] }) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const transport = jest.fn().mockImplementationOnce(() => { started(); return new Promise(resolve => { release = resolve; }); })
      .mockResolvedValue({ embeddings: [{ values: vector() }] });
    const client = new GeminiEmbeddingClient(config({ AI_SEARCH_EMBEDDING_RPM: 60000 }), transport);
    const first = client.embed(['first']); await entered;
    const abort = new AbortController();
    const queued = client.embed(['cancelled'], abort.signal).then(() => 'accepted', error => error.code);
    abort.abort();
    let timer!: ReturnType<typeof setTimeout>;
    try {
      expect(await Promise.race([queued, new Promise<string>(resolve => { timer = setTimeout(() => resolve('blocked'), 300); })])).toBe('ABORTED');
    } finally { clearTimeout(timer); release({ embeddings: [{ values: vector() }] }); await first; await queued; }
    await client.embed(['next']);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.map(call => call[0].contents)).toEqual(['first', 'next']);
  });

  it('rejects a timeout outside the Node timer range before any request', () => {
    expect(() => new GeminiEmbeddingClient(config({ AI_SEARCH_EMBEDDING_TIMEOUT_MS: 2147483648 }), jest.fn())).toThrow('PROFILE_MISMATCH');
  });
});
