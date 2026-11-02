import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createShopMcpServer, SHOP_MCP_INSTRUCTIONS, ShopMcpServerDeps } from './shop-mcp-server';
import { assistantTools } from '../assistant-tools';
import { AssistantService } from '../assistant.service';
import { adminToolContext } from '../../../search/tool-execution-context';
import type { LlmClient, LlmToolCall } from '../../../intrastructure/ai/llm-client.interface';

/**
 * MCP 서버 팩토리 — 실제 SDK Client 를 InMemory 쌍으로 붙여 프로토콜을 한 바퀴 돈다(ex-mcp-practice.md §4 순서 2).
 *  - tools/list 가 채팅과 같은 도구 정의를 변환 없이 싣는가(D2)
 *  - tools/call 결과가 structuredContent + 같은 JSON 텍스트이고, 실패도 isError 없는 구조화 결과인가(D3·D7)
 */

// assistant.service.spec 과 같은 이유(엔티티 순환 import 가 @swc/jest 에서 TDZ) — 이 spec 은 디스패처 아래까지 내려가지 않는다.
jest.mock('../../dashboard/dashboard.service', () => ({ DashboardService: class {} }));
jest.mock('../../../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../../../product/product.service', () => ({ ProductService: class {} }));
jest.mock('../../../category/category.service', () => ({ CategoryService: class {} }));
jest.mock('../../../review/review.service', () => ({ ReviewService: class {} }));
jest.mock('../../../inquiry/inquiry.service', () => ({ InquiryService: class {} }));
jest.mock('../entity/conversation.entity', () => ({ AssistantConversationEntity: class {} }));
jest.mock('../entity/message.entity', () => ({ AssistantMessageEntity: class {} }));

async function connect(deps: ShopMcpServerDeps) {
  const server = createShopMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'spec', version: '0' });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function assistantService(semantic?: { reviews: boolean; inquiries: boolean }) {
  const none = {} as never;
  const semanticSearch = semantic && { isReviewsEnabled: () => semantic.reviews, isInquiriesEnabled: () => semantic.inquiries };
  return new AssistantService({} as LlmClient, none, none, none, none, none, none, none, none, semanticSearch as never);
}

const unusedCall = async () => { throw new Error('호출되면 안 된다'); };

describe('createShopMcpServer — tools/list', () => {
  it.each([
    ['의미 검색 꺼짐', false, false],
    ['의미 검색 켜짐(union 스키마)', true, true],
  ])('%s: 도구 6개의 name·description·inputSchema 가 채팅 도구 정의와 깊은 동등', async (_label, reviews, inquiries) => {
    const tools = assistantTools(reviews, inquiries);
    const { client, close } = await connect({ listTools: () => tools, callTool: unusedCall });
    try {
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(6);
      expect(listed.tools.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema }))).toEqual(tools);
    } finally { await close(); }
  });

  it('initialize 응답에 사용 규칙(instructions)을 싣는다', async () => {
    const { client, close } = await connect({ listTools: () => [], callTool: unusedCall });
    try {
      expect(client.getInstructions()).toBe(SHOP_MCP_INSTRUCTIONS);
      expect(client.getServerCapabilities()?.tools).toBeDefined();
    } finally { await close(); }
  });
});

describe('createShopMcpServer — tools/call', () => {
  it('성공: 받은 이름·인자·signal 로 실행하고, 결과를 JSON 정규화해 structuredContent 와 같은 텍스트로 돌려준다', async () => {
    const callTool = jest.fn<Promise<unknown>, [LlmToolCall, AbortSignal]>(async () => ({
      startDate: '2026-10-01', totalSales: 1234000, orderCount: 3, at: new Date('2026-10-02T00:00:00.000Z'), skipped: undefined,
    }));
    const { client, close } = await connect({ listTools: () => [], callTool });
    try {
      const result = await client.callTool({ name: 'get_sales_summary', arguments: { startDate: '2026-10-01', endDate: '2026-10-31' } });
      expect(callTool).toHaveBeenCalledWith({ name: 'get_sales_summary', args: { startDate: '2026-10-01', endDate: '2026-10-31' } }, expect.any(AbortSignal));
      // Date → ISO 문자열, undefined 키 제거 — HTTP 로 직렬화된 것과 같은 값(D7)
      expect(result.structuredContent).toEqual({ startDate: '2026-10-01', totalSales: 1234000, orderCount: 3, at: '2026-10-02T00:00:00.000Z' });
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
      expect(result.isError).toBeUndefined();
    } finally { await close(); }
  });

  it('인자가 없는 호출은 빈 객체로 넘긴다', async () => {
    const callTool = jest.fn(async () => ({ ok: true }));
    const { client, close } = await connect({ listTools: () => [], callTool });
    try {
      await client.callTool({ name: 'get_product_info' });
      expect(callTool).toHaveBeenCalledWith({ name: 'get_product_info', args: {} }, expect.any(AbortSignal));
    } finally { await close(); }
  });

  it('객체가 아닌 결과는 structuredContent 없이 텍스트만 싣는다', async () => {
    const { client, close } = await connect({ listTools: () => [], callTool: async () => [1, 2] });
    try {
      const result = await client.callTool({ name: 'x', arguments: {} });
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([{ type: 'text', text: '[1,2]' }]);
    } finally { await close(); }
  });

  it('클라이언트가 호출을 취소하면 실행 중인 도구의 signal 이 끊긴다', async () => {
    let seen: AbortSignal | undefined;
    let started!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    const callTool = (_call: LlmToolCall, signal: AbortSignal) => new Promise<unknown>(resolve => {
      seen = signal;
      started();
      signal.addEventListener('abort', () => resolve({ aborted: true }), { once: true });
    });
    const { client, close } = await connect({ listTools: () => [], callTool });
    try {
      const abort = new AbortController();
      const pending = client.callTool({ name: 'get_order_stats', arguments: {} }, undefined, { signal: abort.signal });
      await running;
      abort.abort();
      await expect(pending).rejects.toThrow();
      await new Promise(resolve => setImmediate(resolve)); // notifications/cancelled 가 서버에 닿을 때까지
      expect(seen?.aborted).toBe(true);
    } finally { await close(); }
  });
});

describe('createShopMcpServer + 실제 executeTool — 실패도 isError 없는 구조화 결과', () => {
  const failureOf = (status: string, code: string) => expect.objectContaining({ status, mode: 'structured', data: null, error: expect.objectContaining({ code }) });

  async function callWith(context: Parameters<AssistantService['executeTool']>[1], name: string, args: Record<string, unknown>) {
    const service = assistantService();
    const { client, close } = await connect({ listTools: () => service.availableTools(), callTool: (call: LlmToolCall) => service.executeTool(call, context) });
    try { return await client.callTool({ name, arguments: args }); } finally { await close(); }
  }

  it.each([
    ['권한 없는 context → forbidden', undefined, 'get_sales_summary', { startDate: '2026-10-01', endDate: '2026-10-31' }, 'forbidden', 'FORBIDDEN'],
    ['관리자 아님 → forbidden', adminToolContext(1, ['buyer']), 'get_sales_summary', { startDate: '2026-10-01', endDate: '2026-10-31' }, 'forbidden', 'FORBIDDEN'],
    ['없는 도구 → unsupported', adminToolContext(1, ['admin']), 'drop_tables', {}, 'unsupported', 'UNKNOWN_TOOL'],
    ['스키마 밖 인자 → invalid_arguments', adminToolContext(1, ['admin']), 'get_order_stats', { startDate: '2026-10-01', endDate: '2026-10-31', owner: 'admin' }, 'invalid_arguments', 'INVALID_ARGUMENTS'],
    ['기간 역전 → invalid_arguments', adminToolContext(1, ['admin']), 'get_sales_summary', { startDate: '2026-10-31', endDate: '2026-10-01' }, 'invalid_arguments', 'INVALID_DATE_RANGE'],
  ])('%s', async (_label, context, name, args, status, code) => {
    const result = await callWith(context, name, args);
    expect(result.structuredContent).toEqual(failureOf(status, code));
    expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual(result.structuredContent);
    expect(result.isError).toBeUndefined();
  });
});

describe('AssistantService.availableTools', () => {
  it.each([
    [undefined, false, false],
    [{ reviews: true, inquiries: false }, true, false],
    [{ reviews: false, inquiries: true }, false, true],
  ])('의미 검색 플래그 %j → assistantTools(%s, %s) 와 같다', (semantic, reviews, inquiries) => {
    expect(assistantService(semantic).availableTools()).toEqual(assistantTools(reviews, inquiries));
  });
});
