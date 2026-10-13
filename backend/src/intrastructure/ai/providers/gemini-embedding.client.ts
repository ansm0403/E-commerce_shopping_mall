import { GoogleGenAI } from '@google/genai';
import type { EmbedContentParameters, EmbedContentResponse } from '@google/genai';
import type { ConfigService } from '@nestjs/config';
import { scrubText } from '../../../common/utils/scrub-text';
import { INITIAL_SEARCH_PROFILE as PROFILE } from '../../../search/search-profile';
import { SearchError } from '../../../search/search-error';
import { assertSearchVector } from '../../../search/search-vector';
import type { EmbeddingClient, EmbeddingResult, EmbeddingUsage } from '../embedding-client.interface';

type Transport = (params: EmbedContentParameters) => Promise<EmbedContentResponse>;

export class GeminiEmbeddingClient implements EmbeddingClient {
  readonly model: string;
  readonly dimensions: number;
  private readonly profileId: string;
  private readonly transport?: Transport;
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private nextRequestAt = 0;
  private requestQueue: Promise<unknown> = Promise.resolve();
  private readonly observations: EmbeddingUsage = { requests: 0, inputCodePoints: 0, inputBytes: 0, inputTokens: null };

  constructor(config: Pick<ConfigService, 'get'>, transport?: Transport) {
    this.model = config.get<string>('GEMINI_EMBEDDING_MODEL', PROFILE.model);
    this.dimensions = Number(config.get('GEMINI_EMBEDDING_DIMENSIONS', PROFILE.dimensions));
    this.profileId = config.get<string>('AI_SEARCH_PROFILE_ID', PROFILE.id);
    this.timeoutMs = positiveInteger(config.get('AI_SEARCH_EMBEDDING_TIMEOUT_MS', 15000), 2147483647);
    this.minIntervalMs = Math.ceil(60000 / positiveInteger(config.get('AI_SEARCH_EMBEDDING_RPM', 10)));
    const key = config.get<string>('GEMINI_API_KEY');
    if (transport) this.transport = transport;
    else if (key) {
      const ai = new GoogleGenAI({ apiKey: key });
      this.transport = (params) => ai.models.embedContent(params);
    }
  }

  isEnabled(): boolean {
    return !!this.transport && this.profileId === PROFILE.id && this.model === PROFILE.model && this.dimensions === PROFILE.dimensions;
  }

  snapshot(): EmbeddingUsage { return { ...this.observations }; }

  async embed(inputs: readonly string[], signal?: AbortSignal, beforeRequest?: () => Promise<void>): Promise<EmbeddingResult> {
    if (this.profileId !== PROFILE.id || this.model !== PROFILE.model || this.dimensions !== PROFILE.dimensions) throw new SearchError('PROFILE_MISMATCH');
    if (!this.transport) throw new SearchError('EMBEDDING_DISABLED');
    if (signal?.aborted) throw new SearchError('ABORTED');
    // Validate the entire batch before making any external request. Defense in depth for callers.
    const safeInputs = inputs.map((input) => {
      const safe = scrubText(input) ?? '';
      if (!safe.trim() || Buffer.byteLength(safe, 'utf8') > PROFILE.maxInputBytes) throw new SearchError('INVALID_INPUT');
      return safe;
    });
    const usage: EmbeddingUsage = { requests: 0, inputBytes: 0, inputCodePoints: 0, inputTokens: null };
    const vectors: number[][] = [];
    for (const input of safeInputs) {
      const request = this.requestQueue.then(() => this.request(input, usage, signal, beforeRequest));
      this.requestQueue = request.catch(() => undefined);
      vectors.push(await withAbort(request, signal));
    }
    return { vectors, usage };
  }

  private async request(input: string, usage: EmbeddingUsage, signal?: AbortSignal, beforeRequest?: () => Promise<void>): Promise<number[]> {
    const transport = this.transport;
    if (!transport) throw new SearchError('EMBEDDING_DISABLED');
    if (signal?.aborted) throw new SearchError('ABORTED');
    await delay(Math.max(0, this.nextRequestAt - Date.now()), signal);
    await beforeRequest?.();
    if (signal?.aborted) throw new SearchError('ABORTED');
    this.nextRequestAt = Date.now() + this.minIntervalMs;
    this.observations.requests++;
    this.observations.inputCodePoints += Array.from(input).length;
    this.observations.inputBytes += Buffer.byteLength(input, 'utf8');
    usage.requests++;
    usage.inputCodePoints += Array.from(input).length;
    usage.inputBytes += Buffer.byteLength(input, 'utf8');
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await withAbort(transport({
        model: this.model,
        contents: input, // One string per call; never aggregate independent chunks.
        config: { outputDimensionality: this.dimensions, abortSignal: abort, httpOptions: { timeout: this.timeoutMs, retryOptions: { attempts: 1 } } },
      }), abort);
      if (signal?.aborted) throw new SearchError('ABORTED');
      if (timeout.aborted) throw new SearchError('EMBEDDING_TIMEOUT', true);
      if (!Array.isArray(response?.embeddings) || response.embeddings.length !== 1) throw new SearchError('INVALID_EMBEDDING');
      const vector = response.embeddings[0]?.values;
      assertSearchVector(vector);
      return vector;
    } catch (error) {
      if (signal?.aborted) throw new SearchError('ABORTED');
      if (timeout.aborted) throw new SearchError('EMBEDDING_TIMEOUT', true);
      if (error instanceof SearchError) throw error;
      // SDK errors contain request/response text; preserve only a classified code.
      const status = Number((error as { status?: unknown })?.status);
      if (status === 401 || status === 403) throw new SearchError('EMBEDDING_PERMISSION');
      if (status === 400 || status === 404) throw new SearchError('EMBEDDING_MODEL');
      if (status === 429) throw new SearchError('EMBEDDING_RATE_LIMIT', true, retryAfter(error));
      throw new SearchError('EMBEDDING_UNAVAILABLE', true);
    }
  }
}

function retryAfter(error: unknown): number | undefined {
  const headers = (error as { headers?: Headers | Record<string, string> })?.headers;
  if (!headers) return undefined;
  const value = headers instanceof Headers ? headers.get('retry-after') : headers['retry-after'] ?? headers['Retry-After'];
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function positiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new SearchError('PROFILE_MISMATCH');
  return number;
}

/** Settle independently of a transport's abort support; consume any later rejection. */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(new SearchError('ABORTED')); };
    promise.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); });
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new SearchError('ABORTED'));
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', onAbort); resolve(); };
    const timer = setTimeout(finish, ms);
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(new SearchError('ABORTED')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
