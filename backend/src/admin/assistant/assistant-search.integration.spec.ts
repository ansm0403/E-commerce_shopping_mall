import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantStreamRegistry } from './assistant-stream-registry';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { AuthService } from '../../auth/auth.service';
import { SemanticSearchService } from '../../search/semantic-search.service';
import { SearchIndexRecorder } from '../../search/search-index-recorder';
import { SearchError } from '../../search/search-error';
import { INITIAL_SEARCH_PROFILE as PROFILE } from '../../search/search-profile';
import type { LlmClient, LlmStreamEvent } from '../../intrastructure/ai/llm-client.interface';
import { LlmTimeoutError } from '../../intrastructure/ai/llm-failure';
import type { EmbeddingClient } from '../../intrastructure/ai/embedding-client.interface';
import { createEvalDatabase, prepareReviews, prepareInquiries } from '../../../eval/search/search-eval-environment';
import { searchTable } from '../../search/search-sql';
import type { ReviewSearchResult, InquirySearchResult } from '../../search/search-contract';

describe('authenticated assistant HTTP/SSE + PostgreSQL search', () => {
  let app: INestApplication;
  let url: string;
  let environment: Awaited<ReturnType<typeof createEvalDatabase>>;
  let service: AssistantService;
  let search: SemanticSearchService;
  let config: ConfigService;
  let embed: jest.Mock;
  let seen: Parameters<LlmClient['generateWithTools']>[0][];
  let args: Record<string, unknown>;
  let toolName: 'summarize_reviews' | 'summarize_inquiries';
  let toolResult: ReviewSearchResult | InquirySearchResult | null;
  let blocked: boolean;
  let llmFailure: unknown;
  let embeddingStarted: Promise<void>;
  let notifyEmbedding: () => void;
  const axis = [1, ...Array(767).fill(0)];
  const headers = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };
  const post = (path: string, body: object, token = 'admin') => fetch(`${url}${path}`, {
    method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });

  beforeAll(async () => {
    environment = await createEvalDatabase();
    config = new ConfigService({ AI_SEARCH_REVIEWS_ENABLED: 'true', AI_SEARCH_INQUIRIES_ENABLED: 'true' });
    embed = jest.fn(async (_inputs: string[], signal?: AbortSignal) => {
      notifyEmbedding?.();
      if (blocked) await new Promise<void>((_, reject) => {
        if (signal?.aborted) reject(new SearchError('ABORTED'));
        else signal?.addEventListener('abort', () => reject(new SearchError('ABORTED')), { once: true });
      });
      return { vectors: [axis], usage: { requests: 1, inputBytes: 1, inputCodePoints: 1, inputTokens: null } };
    });
    const embedding: EmbeddingClient = { model: PROFILE.model, dimensions: 768, isEnabled: () => true, embed };
    search = new SemanticSearchService(environment.db, config, embedding, new SearchIndexRecorder(config));
    const rows: { id: number; conversationId: number; role: string; content: string }[] = [];
    const messages = { create: (value: object) => value, save: async (value: object) => {
      const row = { id: rows.length + 1, ...value }; rows.push(row as never); return row;
    }, find: async ({ where }: { where: { conversationId: number } }) => rows.filter(row => row.conversationId === where.conversationId).reverse() };
    let conversationId = 0;
    const conversations = { create: (value: object) => value, save: async (value: object) => ({ id: ++conversationId, ...value }), findOne: async () => null };
    const llm = { isEnabled: () => true, async *generateWithTools(params: Parameters<LlmClient['generateWithTools']>[0]): AsyncGenerator<LlmStreamEvent> {
      seen.push(params); params.onRequest?.();
      if (llmFailure) throw llmFailure;
      const call = { name: toolName, args };
      yield { type: 'tool_call', call };
      const result = await params.executeTool(call) as ReviewSearchResult | InquirySearchResult;
      toolResult = result;
      if (params.signal?.aborted) return;
      const source = result.data?.sources?.[0];
      yield { type: 'text', delta: source ? source.sourceType === 'inquiry'
        ? `문의 #${source.id} (${source.title}): "${source.quotes[0].text}"`
        : `리뷰 #${source.id}: "${source.quotes[0].text}"` : `검색 상태: ${result.status}` };
      yield { type: 'done' };
    } } as LlmClient;
    service = new AssistantService(llm, {} as never, {} as never, {} as never, {} as never,
      { getReviewsForAssistant: async () => [] } as never, {} as never, conversations as never, messages as never, search);
    const module = await Test.createTestingModule({ controllers: [AssistantController], providers: [
      { provide: AssistantService, useValue: service }, AssistantStreamRegistry, JwtAuthGuard, RolesGuard,
      { provide: AuthService, useValue: { verifyAccessToken: async (token: string) => {
        if (!['admin', 'buyer'].includes(token)) throw new Error('invalid token');
        return { sub: 42, roles: [token === 'admin' ? 'admin' : 'buyer'] };
      } } },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); url = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); await environment?.close(); });
  beforeEach(async () => {
    blocked = false; llmFailure = null; seen = []; embed.mockClear(); args = { query: '팔이 조이는 불만', productId: 1 };
    toolName = 'summarize_reviews'; toolResult = null;
    embeddingStarted = new Promise(resolve => { notifyEmbedding = resolve; });
    config.set('AI_SEARCH_REVIEWS_ENABLED', 'true');
    config.set('AI_SEARCH_INQUIRIES_ENABLED', 'true');
    await environment.db.query(`TRUNCATE ${searchTable(environment.db.manager, 'reviews')},${searchTable(environment.db.manager, 'inquiries')},${searchTable(environment.db.manager, 'products')},${searchTable(environment.db.manager, 'search_index_jobs')},${searchTable(environment.db.manager, 'review_search_chunks')},${searchTable(environment.db.manager, 'inquiry_search_chunks')} CASCADE`);
    await prepareReviews(environment.db, [{ id: 1, productId: 1, rating: 5, comment: '팔 부분이 꽉 끼어요. test@example.com 010-1234-5678', createdAt: '2026-10-13T10:00:00+09:00' }],
      { model: PROFILE.model, dimensions: 768, isEnabled: () => true, embed: async () => ({ vectors: [axis], usage: { requests: 0, inputBytes: 0, inputCodePoints: 0, inputTokens: null } }) });
    await prepareInquiries(environment.db, [
      { id: 101, productId: 1, title: '도착 안내 title@example.com', content: '발송 예정일 문의 buyer@example.com',
        answer: '금요일 발송 answer@example.com 010-1234-5678', isSecret: false, status: 'answered', createdAt: '2026-10-13T10:00:00+09:00' },
      { id: 102, productId: 2, title: 'private-unique-title', content: 'private-unique-content',
        answer: 'private-unique-answer', isSecret: true, status: 'answered', createdAt: '2026-10-13T10:00:00+09:00' },
    ], { model: PROFILE.model, dimensions: 768, isEnabled: () => true,
      embed: async () => ({ vectors: [axis], usage: { requests: 0, inputBytes: 0, inputCodePoints: 0, inputTokens: null } }) });
  });

  it('returns 401/403 before any LLM/search and rejects forged HTTP authority fields', async () => {
    expect((await post('/admin/assistant/chat', { message: 'q' }, 'invalid')).status).toBe(401);
    expect((await post('/admin/assistant/stream', { message: 'q' }, 'buyer')).status).toBe(403);
    expect((await post('/admin/assistant/chat', { message: 'q', actorId: 1, roles: ['admin'] })).status).toBe(400);
    expect(seen).toHaveLength(0); expect(embed).not.toHaveBeenCalled();
  });
  it('uses authenticated server context for nonstream chat and masks outbound question and citations', async () => {
    const spy = jest.spyOn(search, 'searchReviews');
    const response = await post('/admin/assistant/chat', { message: 'test@example.com 팔 조임', requestId: 'http-query' });
    expect(response.status).toBe(201);
    const body = await response.json(); expect(body.reply).toContain('리뷰 #1');
    expect(JSON.stringify(body)).not.toMatch(/test@example.com|010-1234-5678/);
    expect(seen[0].messages[0].content).not.toContain('test@example.com');
    expect(spy.mock.calls.at(-1)?.[1]).toMatchObject({ actorId: 42, roles: ['admin'], requestId: 'http-query', origin: 'http' });
    spy.mockRestore();
  });
  it('preserves SSE meta/tool/text/done frames and sends masked history to the LLM', async () => {
    const response = await post('/admin/assistant/stream', { message: '010-1234-5678 팔 조임', requestId: 'sse-query' });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = (await response.text()).trim().split('\n\n').map(frame => JSON.parse(frame.replace(/^data: /, '')));
    expect(events.map(event => event.type)).toEqual(['meta', 'tool', 'text', 'done']);
    expect(events[1]).toEqual({ type: 'tool', name: 'summarize_reviews' });
    expect(events[2].delta).toContain('리뷰 #1');
    expect(JSON.stringify(seen[0].messages)).not.toContain('010-1234-5678');
  });
  it('propagates explicit SSE cancel into an in-flight embedding and ends without done', async () => {
    blocked = true;
    const response = await post('/admin/assistant/stream', { message: '팔 조임', requestId: 'cancel-search' });
    await embeddingStarted;
    expect((await post('/admin/assistant/stream/cancel', { requestId: 'cancel-search' })).status).toBe(204);
    const body = await response.text(); expect(body).not.toContain('"type":"done"');
    expect(embed.mock.calls[0][1].aborted).toBe(true);
  });
  it('propagates nonstream socket closure into an in-flight embedding', async () => {
    blocked = true;
    const abort = new AbortController();
    const response = fetch(`${url}/admin/assistant/chat`, { method: 'POST', headers, body: JSON.stringify({ message: '팔 조임' }), signal: abort.signal }).catch(() => null);
    await embeddingStarted; abort.abort(); await response;
    for (let i = 0; i < 50 && !embed.mock.calls[0][1].aborted; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(embed.mock.calls[0][1].aborted).toBe(true);
  });
  it('reports indexing and disabled capability through the existing answer channel', async () => {
    await environment.db.query(`UPDATE ${searchTable(environment.db.manager, 'search_index_jobs')} SET status='pending'`);
    const pending = await post('/admin/assistant/chat', { message: '팔 조임' }); expect((await pending.json()).reply).toContain('indexing');
    config.set('AI_SEARCH_REVIEWS_ENABLED', 'false');
    const disabled = await post('/admin/assistant/chat', { message: '팔 조임' }); expect((await disabled.json()).reply).toContain('unsupported');
    expect(embed).not.toHaveBeenCalled();
  });

  it.each([
    [429, 'AI 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.'],
    [503, 'AI 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.'],
  ])('reports HTTP %s model failures in SSE without exposing the SDK body or claiming completion', async (status, message) => {
    llmFailure = { status: Number(status), message: 'secret@example.com 010-1234-5678 API-key=secret request body' };
    const response = await post('/admin/assistant/stream', { message: '팔 조임', requestId: `error-${status}` });
    const body = await response.text();
    const events = body.trim().split('\n\n').map(frame => JSON.parse(frame.replace(/^data: /, '')));
    expect(events.map(event => event.type)).toEqual(['meta', 'error']);
    expect(events[1]).toEqual({ type: 'error', message });
    expect(body).not.toMatch(/secret@example.com|010-1234-5678|API-key|request body/);
    expect(embed).not.toHaveBeenCalled();
  });

  it('sends a distinct timeout error over SSE without successful completion or a search request', async () => {
    llmFailure = new LlmTimeoutError('request', 60000, 60001);
    const response = await post('/admin/assistant/stream', { message: '팔 조임', requestId: 'sdk-timeout' });
    const events = (await response.text()).trim().split('\n\n').map(frame => JSON.parse(frame.replace(/^data: /, '')));
    expect(events).toEqual([
      { type: 'meta', conversationId: expect.any(String) },
      { type: 'error', message: 'AI 응답 대기 시간이 초과됐습니다. 잠시 후 다시 시도해주세요.' },
    ]);
    expect(embed).not.toHaveBeenCalled();
  });

  it('passes authenticated inquiry scope through HTTP and masks title, body, answer and the outbound question', async () => {
    toolName = 'summarize_inquiries';
    args = { query: '언제 발송하나요?', productId: 1, status: 'answered', startDate: '2026-10-13', endDate: '2026-10-13', take: 5 };
    const spy = jest.spyOn(search, 'searchInquiries');
    try {
      const response = await post('/admin/assistant/chat', { message: 'test@example.com 발송 예정일', requestId: 'http-inquiry' });
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.reply).toContain('문의 #101'); expect(body.reply).toContain('금요일 발송');
      expect(JSON.stringify(body)).not.toMatch(/title@example.com|buyer@example.com|answer@example.com|010-1234-5678|private-unique/);
      expect(JSON.stringify(seen[0].messages)).not.toContain('test@example.com');
      expect(spy.mock.calls.at(-1)?.[0]).toMatchObject({ query: '언제 발송하나요?', productIds: [1], status: 'answered', startDate: '2026-10-13', endDate: '2026-10-13', take: 5 });
      expect(spy.mock.calls.at(-1)?.[1]).toMatchObject({ actorId: 42, roles: ['admin'], requestId: 'http-inquiry', origin: 'http' });
      expect(toolResult?.scope).toMatchObject({ sourceType: 'inquiry', productIds: [1], status: 'answered', startDate: '2026-10-13', endDate: '2026-10-13' });
      expect(toolResult?.coverage).toMatchObject({ total: 1, ready: 1, partial: false });
    } finally { spy.mockRestore(); }
  });

  it('preserves inquiry SSE meta/tool/text/done frames with masked public evidence', async () => {
    toolName = 'summarize_inquiries'; args = { query: '발송 예정일', productId: 1 };
    const response = await post('/admin/assistant/stream', { message: '010-1234-5678 발송 예정일', requestId: 'sse-inquiry' });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = await response.text();
    const events = body.trim().split('\n\n').map(frame => JSON.parse(frame.replace(/^data: /, '')));
    expect(events.map(event => event.type)).toEqual(['meta', 'tool', 'text', 'done']);
    expect(events[1]).toEqual({ type: 'tool', name: 'summarize_inquiries' }); expect(events[2].delta).toContain('문의 #101');
    expect(body).not.toMatch(/title@example.com|buyer@example.com|answer@example.com|010-1234-5678|private-unique/);
    expect(JSON.stringify(seen[0].messages)).not.toContain('010-1234-5678');
  });

  it('returns no_data without embedding or counting secret-only inquiry scope', async () => {
    toolName = 'summarize_inquiries'; args = { query: '발송 예정일', productId: 2 };
    const response = await post('/admin/assistant/chat', { message: '상품 2 발송 문의' });
    const body = await response.json();
    expect(body.reply).toContain('no_data'); expect(JSON.stringify(body)).not.toContain('private-unique');
    expect(toolResult?.coverage).toEqual({ total: 0, ready: 0, pending: 0, failed: 0, partial: false });
    expect(toolResult?.data.sources).toEqual([]); expect(embed).not.toHaveBeenCalled();
  });

  it('omits inactive inquiry query from the model schema and returns unsupported for a forged query call', async () => {
    toolName = 'summarize_inquiries'; args = { query: '발송 예정일', productId: 1 };
    config.set('AI_SEARCH_INQUIRIES_ENABLED', 'false');
    const spy = jest.spyOn(search, 'searchInquiries');
    try {
      const response = await post('/admin/assistant/chat', { message: '발송 예정일' });
      expect((await response.json()).reply).toContain('unsupported');
      const definition = seen[0].tools.find(tool => tool.name === 'summarize_inquiries');
      expect((definition?.parameters as { properties: Record<string, unknown> }).properties.query).toBeUndefined();
      expect(spy).not.toHaveBeenCalled(); expect(embed).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it('cancels an in-flight inquiry embedding through the authenticated SSE cancel endpoint', async () => {
    toolName = 'summarize_inquiries'; args = { query: '발송 예정일', productId: 1 }; blocked = true;
    const response = await post('/admin/assistant/stream', { message: '발송 예정일', requestId: 'cancel-inquiry' });
    await embeddingStarted;
    expect((await post('/admin/assistant/stream/cancel', { requestId: 'cancel-inquiry' })).status).toBe(204);
    const body = await response.text(); expect(body).not.toContain('"type":"done"');
    expect(embed.mock.calls[0][1].aborted).toBe(true);
  });

  it('rejects buyer inquiry requests before LLM or search executes', async () => {
    toolName = 'summarize_inquiries'; args = { query: '발송 예정일', productId: 1 };
    const spy = jest.spyOn(search, 'searchInquiries');
    try {
      expect((await post('/admin/assistant/chat', { message: '발송 예정일' }, 'buyer')).status).toBe(403);
      expect((await post('/admin/assistant/stream', { message: '발송 예정일' }, 'buyer')).status).toBe(403);
      expect(seen).toHaveLength(0); expect(spy).not.toHaveBeenCalled(); expect(embed).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
