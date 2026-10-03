import type { AssistantStreamEvent } from '@shopping-mall/shared';
import { AssistantService } from './assistant.service';
import type {
  LlmClient,
  LlmStreamEvent,
} from '../../intrastructure/ai/llm-client.interface';

/**
 * streamChat 의 와이어 계약 — LLM 은 mock, DB 는 메모리.
 *  - B-1: 도구 실행 직전에 tool(name) 을 보낸다(인자·결과는 보내지 않는다)
 *  - B-2: 중단되면 그때까지 보낸 텍스트만 저장하고 done 을 보내지 않는다
 */

// 도구 디스패처가 쓰는 서비스들은 이 spec 에서 호출되지 않는다(mock LLM 이 도구를 실제로 실행하지 않음).
// 진짜 모듈을 읽으면 주문 엔티티의 순환 import(order ↔ order-item)가 @swc/jest 에서 TDZ 로 죽는다 → 빈 클래스로 대체.
jest.mock('../dashboard/dashboard.service', () => ({ DashboardService: class {} }));
jest.mock('../../audit/audit.service', () => ({ AuditService: class {} }));
jest.mock('../../product/product.service', () => ({ ProductService: class {} }));
jest.mock('../../category/category.service', () => ({ CategoryService: class {} }));
jest.mock('../../review/review.service', () => ({ ReviewService: class {} }));
jest.mock('../../inquiry/inquiry.service', () => ({ InquiryService: class {} }));
// 대화 ↔ 메시지 엔티티도 서로를 import 한다(같은 TDZ). 저장소는 아래에서 메모리 객체로 준다.
jest.mock('./entity/conversation.entity', () => ({ AssistantConversationEntity: class {} }));
jest.mock('./entity/message.entity', () => ({ AssistantMessageEntity: class {} }));

type Saved = { conversationId: number; role: string; content: string };

/** generateWithTools 가 받은 인자(도구 실행 콜백·signal)를 테스트가 쓸 수 있게 넘겨준다 */
type Script = (params: Parameters<LlmClient['generateWithTools']>[0]) => AsyncIterable<LlmStreamEvent>;

function setup(script: Script) {
  const saved: Saved[] = [];
  const messageRepo = {
    create: (v: Saved) => v,
    save: jest.fn(async (v: Saved) => {
      saved.push(v);
      return v;
    }),
    find: jest.fn(async () => saved.map((m, i) => ({ id: i + 1, ...m })).reverse()),
  };
  const conversationRepo = {
    findOne: jest.fn(async () => null),
    create: (v: object) => v,
    save: jest.fn(async (v: object) => ({ id: 7, ...v })),
  };
  const generateWithTools = jest.fn<ReturnType<Script>, Parameters<Script>>(script);
  const llm = { isEnabled: () => true, generateWithTools } as unknown as LlmClient;
  const none = {} as never;
  const service = new AssistantService(
    llm,
    none,
    none,
    none,
    none,
    none,
    none,
    conversationRepo as never,
    messageRepo as never,
  );
  jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  return { service, saved, generateWithTools };
}

async function collect(gen: AsyncGenerator<AssistantStreamEvent>) {
  const out: AssistantStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

const params = { message: '지난달 매출 알려줘', adminUserId: 1 };
const usage = { inputTokens: 10, outputTokens: 5, cachedTokens: 0 };
const assistantRows = (saved: Saved[]) => saved.filter((m) => m.role === 'assistant');

describe('AssistantService.streamChat — 와이어 이벤트', () => {
  it('B-1: tool_call → text → done 이면 와이어는 meta → tool → text → done', async () => {
    const { service, saved } = setup(async function* () {
      yield { type: 'tool_call', call: { name: 'get_sales_summary', args: { startDate: '2026-09-01' } } };
      yield { type: 'text', delta: '지난달 매출은 ' };
      yield { type: 'text', delta: '0원입니다.' };
      yield { type: 'usage', usage };
      yield { type: 'done' };
    });

    const events = await collect(service.streamChat(params));

    expect(events).toEqual([
      { type: 'meta', conversationId: '7' },
      { type: 'tool', name: 'get_sales_summary' },
      { type: 'text', delta: '지난달 매출은 ' },
      { type: 'text', delta: '0원입니다.' },
      { type: 'done' },
    ]);
    expect(assistantRows(saved)).toEqual([
      { conversationId: 7, role: 'assistant', content: '지난달 매출은 0원입니다.' },
    ]);
  });

  it('B-1: tool 이벤트에는 이름만 실린다(인자는 브라우저로 가지 않는다)', async () => {
    const { service } = setup(async function* () {
      yield { type: 'tool_call', call: { id: 'c1', name: 'query_audit_logs', args: { email: 'a@b.c' } } };
      yield { type: 'done' };
    });

    const events = await collect(service.streamChat(params));

    expect(events.find((e) => e.type === 'tool')).toEqual({ type: 'tool', name: 'query_audit_logs' });
  });

  it('도구가 여러 개면 tool 이 순서대로 여러 번 온다', async () => {
    const { service } = setup(async function* () {
      yield { type: 'tool_call', call: { name: 'get_sales_summary', args: {} } };
      yield { type: 'tool_call', call: { name: 'get_order_stats', args: {} } };
      yield { type: 'text', delta: '정리했습니다.' };
      yield { type: 'done' };
    });

    const events = await collect(service.streamChat(params));

    expect(events.map((e) => (e.type === 'tool' ? `tool:${e.name}` : e.type))).toEqual([
      'meta',
      'tool:get_sales_summary',
      'tool:get_order_stats',
      'text',
      'done',
    ]);
  });

  it('LLM 호출에 signal 을 그대로 넘긴다', async () => {
    const { service, generateWithTools } = setup(async function* () {
      yield { type: 'done' };
    });
    const controller = new AbortController();

    await collect(service.streamChat(params, controller.signal));

    const passed = generateWithTools.mock.calls[0][0] as { signal?: AbortSignal };
    expect(passed.signal).toBe(controller.signal);
  });

  it('user 메시지는 LLM 호출 전에 저장된다', async () => {
    const { service, saved } = setup(async function* () {
      yield { type: 'done' };
    });

    await collect(service.streamChat(params));

    expect(saved[0]).toEqual({ conversationId: 7, role: 'user', content: params.message });
  });
});

describe('AssistantService.streamChat — 중단(B-2)', () => {
  it('텍스트 2조각 뒤 중단: 그 2조각만 저장하고 done 을 보내지 않는다', async () => {
    const controller = new AbortController();
    const { service, saved } = setup(async function* () {
      yield { type: 'text', delta: '6월 매출은 ' };
      yield { type: 'text', delta: '1,200,000원' };
      controller.abort(); // 클라이언트가 여기서 "중지"
      yield { type: 'text', delta: '이고 주문은 12건입니다.' }; // 중단 뒤 도착 — 사용자가 보지 못한 조각
      yield { type: 'done' };
    });

    const events = await collect(service.streamChat(params, controller.signal));

    expect(events).toEqual([
      { type: 'meta', conversationId: '7' },
      { type: 'text', delta: '6월 매출은 ' },
      { type: 'text', delta: '1,200,000원' },
    ]);
    expect(assistantRows(saved)).toEqual([
      { conversationId: 7, role: 'assistant', content: '6월 매출은 1,200,000원' },
    ]);
  });

  it('텍스트가 오기 전에 중단(도구 실행 중): assistant 를 저장하지 않고 done·error 도 없다', async () => {
    const controller = new AbortController();
    const { service, saved } = setup(async function* () {
      yield { type: 'tool_call', call: { name: 'get_sales_summary', args: {} } };
      controller.abort();
      yield { type: 'text', delta: '보지 못한 답변' };
      yield { type: 'done' };
    });

    const events = await collect(service.streamChat(params, controller.signal));

    expect(events.map((e) => e.type)).toEqual(['meta', 'tool']);
    expect(assistantRows(saved)).toEqual([]);
  });

  it('중단으로 LLM 이 예외를 던져도(SDK AbortError) 오류가 아니라 부분 저장으로 끝난다', async () => {
    const controller = new AbortController();
    const { service, saved } = setup(async function* () {
      yield { type: 'text', delta: '부분 ' };
      yield { type: 'text', delta: '답변' };
      controller.abort();
      throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    });

    const events = await collect(service.streamChat(params, controller.signal));

    expect(events.map((e) => e.type)).toEqual(['meta', 'text', 'text']);
    expect(assistantRows(saved)).toEqual([{ conversationId: 7, role: 'assistant', content: '부분 답변' }]);
  });

  it('중단이 아닌 LLM 실패는 종전대로 error 를 보내고 assistant 를 저장하지 않는다', async () => {
    const { service, saved } = setup(async function* () {
      yield { type: 'text', delta: '부분' };
      throw new Error('503 UNAVAILABLE');
    });

    const events = await collect(service.streamChat(params, new AbortController().signal));

    expect(events.map((e) => e.type)).toEqual(['meta', 'text', 'error']);
    expect(assistantRows(saved)).toEqual([]);
  });
});
