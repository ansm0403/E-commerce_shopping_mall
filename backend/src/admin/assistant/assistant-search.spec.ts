import { AssistantService } from './assistant.service';
import { adminToolContext, evaluationToolContext } from '../../search/tool-execution-context';
import type { LlmClient, LlmStreamEvent } from '../../intrastructure/ai/llm-client.interface';
import { SearchError } from '../../search/search-error';
import { BadRequestException } from '@nestjs/common';

jest.mock('../dashboard/dashboard.service', () => ({ DashboardService: class {} }));
jest.mock('../../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../../product/product.service', () => ({ ProductService: class {} }));
jest.mock('../../category/category.service', () => ({ CategoryService: class {} }));
jest.mock('../../review/review.service', () => ({ ReviewService: class {} }));
jest.mock('../../inquiry/inquiry.service', () => ({ InquiryService: class {} }));
jest.mock('./entity/conversation.entity', () => ({ AssistantConversationEntity: class {} }));
jest.mock('./entity/message.entity', () => ({ AssistantMessageEntity: class {} }));

function setup() {
  const search = { isReviewsEnabled: () => true, isInquiriesEnabled: () => true,
    searchReviews: jest.fn(async () => ({ status: 'indexing', mode: 'semantic', data: { sources: [] }, coverage: { pending: 1 } })),
    searchInquiries: jest.fn(async () => ({ status: 'indexing', mode: 'semantic', data: { sources: [] }, coverage: { pending: 1 } })),
  };
  const reviews = { getReviewsForAssistant: jest.fn(async () => [{ rating: 5, comment: 'test@example.com 010-1234-5678', createdAt: new Date('2026-10-13T00:00:00Z') }]) };
  const categories = { getCategoryIdsByName: jest.fn(async () => [1, 2]) };
  const inquiries = { getInquiriesForAssistant: jest.fn(async () => [{ title: 'test@example.com', content: '010-1234-5678', answer: null, createdAt: new Date('2026-10-13T00:00:00Z') }]) };
  const products = { getProductIdsByCategoryIds: jest.fn(async () => [7, 8]) };
  const audit = { getAuditLogs: jest.fn(async () => ({ data: [], meta: { total: 0 } })) };
  const rows: { id: number; conversationId: number; role: string; content: string }[] = [];
  const messages = { create: (v: object) => v, save: jest.fn(async (v: object) => { rows.push({ id: rows.length + 1, ...v } as never); return v; }), find: jest.fn(async () => [...rows].reverse()) };
  const conversations = { create: (v: object) => v, save: jest.fn(async (v: object) => ({ id: 1, ...v })), findOne: jest.fn() };
  const generateWithTools = jest.fn(async function* (params: Parameters<LlmClient['generateWithTools']>[0]): AsyncGenerator<LlmStreamEvent> {
    const call = { name: 'summarize_reviews', args: { query: '팔 조임' } };
    yield { type: 'tool_call', call };
    await params.executeTool(call);
    yield { type: 'text', delta: '색인이 아직 반영 중입니다.' };
    yield { type: 'done' };
  });
  const service = new AssistantService({ isEnabled: () => true, generateWithTools } as unknown as LlmClient,
    {} as never, audit as never, products as never, categories as never, reviews as never, inquiries as never, conversations as never, messages as never, search as never);
  return { service, search, reviews, inquiries, categories, products, audit, generateWithTools, rows };
}
const context = evaluationToolContext('unit');

describe('assistant review search boundary', () => {
  it('classifies domain argument limits as invalid arguments without exposing the exception body', async () => {
    const { service, audit } = setup();
    audit.getAuditLogs.mockRejectedValueOnce(new BadRequestException('range: test@example.com'));
    const result = await service.executeTool({ name: 'query_audit_logs', args: {} }, context);
    expect(result).toMatchObject({ status: 'invalid_arguments', error: { code: 'INVALID_ARGUMENTS' } });
    expect(JSON.stringify(result)).not.toContain('test@example.com');
  });
  it('dispatches a query with category descendants, exact caller context and semantic take', async () => {
    const { service, search } = setup();
    await service.executeTool({ name: 'summarize_reviews', args: { query: '팔 조임', categoryName: '의류', take: 10 } }, context);
    expect(search.searchReviews).toHaveBeenCalledWith(expect.objectContaining({ query: '팔 조임', productIds: [7, 8], categoryIds: [1, 2], take: 10 }), context);
  });

  it('preserves product precedence and an empty resolved category range', async () => {
    const { service, search, products, categories } = setup();
    await service.executeTool({ name: 'summarize_reviews', args: { query: 'q', productId: 7, categoryName: '의류' } }, context);
    expect(categories.getCategoryIdsByName).not.toHaveBeenCalled();
    expect(search.searchReviews.mock.calls[0][0]).toMatchObject({ productIds: [7], categoryIds: undefined });
    products.getProductIdsByCategoryIds.mockResolvedValueOnce([]);
    await service.executeTool({ name: 'summarize_reviews', args: { query: 'q', categoryName: '의류' } }, context);
    expect(search.searchReviews.mock.calls[1][0]).toMatchObject({ productIds: [] });
  });

  it('keeps query-less reads and masks nested results without losing Dates', async () => {
    const { service, reviews, search } = setup();
    const result = await service.executeTool({ name: 'summarize_reviews', args: { maxRating: 2, startDate: '2026-10-13' } }, context);
    expect(reviews.getReviewsForAssistant).toHaveBeenCalledWith(expect.objectContaining({ maxRating: 2, startDate: '2026-10-13T00:00:00.000+09:00' }));
    expect(search.searchReviews).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/test@example.com|010-1234-5678/);
    expect(JSON.stringify(result)).toContain('2026-10-13T00:00:00.000Z');
  });

  it('fails closed for missing/buyer context, forged actor fields and aborted requests', async () => {
    const { service, search, reviews } = setup();
    const call = { name: 'summarize_reviews', args: { query: 'q' } };
    expect(await service.executeTool(call)).toMatchObject({ status: 'forbidden' });
    expect(await service.executeTool(call, adminToolContext(1, ['buyer']))).toMatchObject({ status: 'forbidden' });
    expect(await service.executeTool({ ...call, args: { ...call.args, actorId: 1, roles: ['admin'] } }, context)).toMatchObject({ status: 'invalid_arguments' });
    expect(await service.executeTool(call, evaluationToolContext('aborted', AbortSignal.abort()))).toMatchObject({ status: 'unavailable', error: { code: 'ABORTED' } });
    expect(search.searchReviews).not.toHaveBeenCalled(); expect(reviews.getReviewsForAssistant).not.toHaveBeenCalled();
  });

  it('does not query domain services for a disabled semantic capability', async () => {
    const { service, search, categories } = setup(); search.isReviewsEnabled = () => false;
    expect(await service.executeTool({ name: 'summarize_reviews', args: { query: 'q', categoryName: '의류' } }, context)).toMatchObject({ status: 'unsupported' });
    expect(categories.getCategoryIdsByName).not.toHaveBeenCalled(); expect(search.searchReviews).not.toHaveBeenCalled();
  });

  it('never returns provider/DB error bodies to the model', async () => {
    const { service, search } = setup(); search.searchReviews.mockRejectedValueOnce(new Error('secret@example.com sql password'));
    const result = await service.executeTool({ name: 'summarize_reviews', args: { query: 'q' } }, context);
    expect(result).toMatchObject({ status: 'unavailable', error: { code: 'TOOL_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toMatch(/secret@example.com|sql password/);
    search.searchReviews.mockRejectedValueOnce(new SearchError('ABORTED'));
    expect(await service.executeTool({ name: 'summarize_reviews', args: { query: 'q' } }, context)).toMatchObject({ error: { code: 'ABORTED' } });
  });

  it('uses tools and authenticated context for nonstream chat, masks outgoing input and trace arguments', async () => {
    const { service, generateWithTools, search } = setup();
    await service.chat('연락처 test@example.com 010-1234-5678', context);
    expect(JSON.stringify(generateWithTools.mock.calls[0][0].messages)).not.toMatch(/test@example.com|010-1234-5678/);
    expect(search.searchReviews.mock.calls[0][1]).toBe(context);
    await expect(service.chat('q', adminToolContext(1, ['buyer']))).rejects.toMatchObject({ status: 403 });
  });

  it('reports cancellation when the provider closes silently after a partial answer', async () => {
    const { service, generateWithTools } = setup();
    const abort = new AbortController();
    generateWithTools.mockImplementationOnce(async function* (params) {
      params.onRequest?.();
      yield { type: 'text', delta: '부분 답변' };
      abort.abort();
    });
    await expect(service.chatWithTrace('q', evaluationToolContext('silent-abort', abort.signal)))
      .rejects.toMatchObject({ code: 'ABORTED', llmRequests: 1 });
  });

  it('preserves recovered SDK failures in a successful evaluation trace', async () => {
    const { service, generateWithTools } = setup();
    const failure = { code: 'LLM_UNAVAILABLE' as const, httpStatus: 503, message: 'safe outage' };
    generateWithTools.mockImplementationOnce(async function* (params) {
      params.onRequest?.(); params.onRequestFailure?.(failure); params.onRequest?.();
      yield { type: 'text', delta: '정상 답변' };
    });
    expect(await service.chatWithTrace('q', context)).toMatchObject({ reply: '정상 답변', llmRequests: 2, llmRequestFailures: [failure] });
  });

  it('masks persisted user/history on the model boundary while preserving the SSE wire contract', async () => {
    const { service, generateWithTools, rows } = setup();
    const events = [];
    for await (const event of service.streamChat({ message: 'test@example.com 010-1234-5678', adminUserId: 1, roles: ['admin'], requestId: 'stream' })) events.push(event);
    expect(events.map(event => event.type)).toEqual(['meta', 'tool', 'text', 'done']);
    expect(rows[0].content).toBe('test@example.com 010-1234-5678');
    expect(JSON.stringify(generateWithTools.mock.calls[0][0].messages)).not.toMatch(/test@example.com|010-1234-5678/);
  });
});

describe('assistant inquiry search boundary', () => {
  it('dispatches public semantic inquiries with server context and supported exact filters', async () => {
    const { service, search, inquiries } = setup();
    await service.executeTool({ name: 'summarize_inquiries', args: { query: '출고가 언제 되나요', categoryName: '식품', status: 'answered', startDate: '2026-10-01', endDate: '2026-10-14', take: 10 } }, context);
    expect(search.searchInquiries).toHaveBeenCalledWith({ query: '출고가 언제 되나요', productIds: [7, 8], categoryIds: [1, 2], categoryName: '식품', status: 'answered', startDate: '2026-10-01', endDate: '2026-10-14', take: 10 }, context);
    expect(inquiries.getInquiriesForAssistant).not.toHaveBeenCalled();
  });
  it('preserves product precedence and does not add implicit dates/status', async () => {
    const { service, search, categories } = setup();
    await service.executeTool({ name: 'summarize_inquiries', args: { query: 'q', productId: 7, categoryName: '식품' } }, context);
    expect(categories.getCategoryIdsByName).not.toHaveBeenCalled();
    expect(search.searchInquiries).toHaveBeenCalledWith(expect.objectContaining({ productIds: [7], categoryName: undefined, startDate: undefined, endDate: undefined, status: undefined }), context);
  });
  it('retains masked legacy inquiry reads when query is absent', async () => {
    const { service, search, inquiries } = setup();
    const result = await service.executeTool({ name: 'summarize_inquiries', args: { status: 'waiting', take: 50 } }, context);
    expect(inquiries.getInquiriesForAssistant).toHaveBeenCalledWith(expect.objectContaining({ status: 'waiting', take: 50 }));
    expect(search.searchInquiries).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/test@example.com|010-1234-5678/);
  });
  it('does not resolve a category or read domain data for a disabled query', async () => {
    const { service, search, categories, inquiries } = setup();
    search.isInquiriesEnabled = () => false;
    const result = await service.executeTool({ name: 'summarize_inquiries', args: { query: 'q', categoryName: '식품' } }, context);
    expect(result).toMatchObject({ status: 'unsupported', scope: { sourceType: 'inquiry' }, error: { code: 'INQUIRIES_DISABLED' } });
    expect(categories.getCategoryIdsByName).not.toHaveBeenCalled();
    expect(search.searchInquiries).not.toHaveBeenCalled();
    expect(inquiries.getInquiriesForAssistant).not.toHaveBeenCalled();
  });
  it('rejects forged authority and secret filters before any semantic query', async () => {
    const { service, search } = setup();
    for (const args of [{ query: 'q', actorId: 1 }, { query: 'q', isSecret: false }, { query: 'q', take: 11 }]) {
      expect(await service.executeTool({ name: 'summarize_inquiries', args }, context)).toMatchObject({ status: 'invalid_arguments' });
    }
    expect(await service.executeTool({ name: 'summarize_inquiries', args: { query: 'q' } }, adminToolContext(1, ['buyer']))).toMatchObject({ status: 'forbidden' });
    expect(search.searchInquiries).not.toHaveBeenCalled();
  });
  it('sanitizes inquiry service failure without widening to a legacy query', async () => {
    const { service, search, inquiries } = setup();
    search.searchInquiries.mockRejectedValueOnce(new Error('SQL password secret@example.com'));
    expect(await service.executeTool({ name: 'summarize_inquiries', args: { query: 'q' } }, context)).toMatchObject({ status: 'unavailable', error: { code: 'TOOL_UNAVAILABLE' } });
    expect(inquiries.getInquiriesForAssistant).not.toHaveBeenCalled();
  });
});
