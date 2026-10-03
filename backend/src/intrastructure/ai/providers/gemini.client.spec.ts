import { ConfigService } from '@nestjs/config';
import { GeminiClient } from './gemini.client';
import type { LlmStreamEvent, LlmToolCall } from '../llm-client.interface';

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

function setup(rounds: Chunk[][]) {
  const config = {
    get: (key: string, fallback?: string) => (key === 'GEMINI_API_KEY' ? 'test-key' : fallback),
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

  it('signal 을 SDK 요청 config.abortSignal 로 넘긴다(진행 중 응답 읽기를 끊기 위해)', async () => {
    const controller = new AbortController();
    const { client, generateContentStream } = setup([[textChunk('답변')]]);

    await collect(client.generateWithTools({ ...base, executeTool: jest.fn(), signal: controller.signal }));

    expect(generateContentStream.mock.calls[0][0].config?.abortSignal).toBe(controller.signal);
  });

  it('signal 이 없으면 config 에 abortSignal 을 넣지 않는다(ops 분석 등 기존 호출 불변)', async () => {
    const { client, generateContentStream } = setup([[textChunk('답변')]]);

    await collect(client.generateWithTools({ ...base, executeTool: jest.fn() }));

    expect(generateContentStream.mock.calls[0][0].config).not.toHaveProperty('abortSignal');
  });
});
