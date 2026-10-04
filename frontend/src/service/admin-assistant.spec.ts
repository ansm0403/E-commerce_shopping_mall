import { TextDecoder, TextEncoder } from 'util';
import {
  cancelAssistantStream,
  fetchConversationMessages,
  streamAssistantChat,
  type AssistantEvent,
} from './admin-assistant';
import { refreshAccessToken } from '../lib/axios/axios-http-client';

/**
 * 스트리밍 경로의 401 처리 — "첫 응답이 401 이면 갱신 후 1회만 재시도"(04-ai-chat-ux D4).
 * 네트워크는 fetch mock, 갱신은 axios 쪽 refreshAccessToken mock(동시 1회 규칙은 그쪽 spec 이 고정한다).
 */

jest.mock('../lib/axios/axios-http-client', () => ({ refreshAccessToken: jest.fn() }));
// authStorage 가 탭 간 동기화용 BroadcastChannel 을 연다 — jsdom 엔 없으므로 막는다
jest.mock('./auth-channel', () => ({ getAuthChannel: () => null, closeAuthChannel: () => undefined }));

// jsdom 에는 TextEncoder/TextDecoder 가 없다
Object.assign(globalThis, { TextEncoder, TextDecoder });

const refreshMock = refreshAccessToken as jest.MockedFunction<typeof refreshAccessToken>;
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();

/** 청크 배열을 차례로 내주는 스트림 응답 */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 201,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

const status = (code: number, json: unknown = {}): Response =>
  ({ ok: code >= 200 && code < 300, status: code, body: null, json: async () => json }) as unknown as Response;

const frame = (ev: AssistantEvent) => `data: ${JSON.stringify(ev)}\n\n`;

const authOf = (call: number) =>
  (fetchMock.mock.calls[call][1]?.headers as Record<string, string> | undefined)?.Authorization;

async function collect(gen: AsyncGenerator<AssistantEvent>) {
  const out: AssistantEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

beforeEach(() => {
  fetchMock.mockReset();
  refreshMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem('accessToken', 'old-token');
});

describe('streamAssistantChat', () => {
  it('정상: 토큰을 붙여 한 번 요청하고 이벤트를 순서대로 낸다(갱신 없음)', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([frame({ type: 'meta', conversationId: '7' }), frame({ type: 'text', delta: '안녕' }) + frame({ type: 'done' })]),
    );

    const events = await collect(streamAssistantChat({ message: 'hi' }));

    expect(events.map((e) => e.type)).toEqual(['meta', 'text', 'done']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authOf(0)).toBe('Bearer old-token');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('프레임이 청크 경계에서 잘려 와도 이벤트가 온전하다', async () => {
    const whole = frame({ type: 'text', delta: '지난달 매출' }) + frame({ type: 'done' });
    fetchMock.mockResolvedValueOnce(sseResponse([whole.slice(0, 20), whole.slice(20)]));

    const events = await collect(streamAssistantChat({ message: 'hi' }));

    expect(events).toEqual([{ type: 'text', delta: '지난달 매출' }, { type: 'done' }]);
  });

  it('401 → 갱신 → 새 토큰으로 1회 재시도해 스트림을 받는다', async () => {
    fetchMock.mockResolvedValueOnce(status(401)).mockResolvedValueOnce(sseResponse([frame({ type: 'done' })]));
    refreshMock.mockResolvedValueOnce('new-token');

    const events = await collect(streamAssistantChat({ message: 'hi', conversationId: '3' }));

    expect(events).toEqual([{ type: 'done' }]);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authOf(0)).toBe('Bearer old-token');
    expect(authOf(1)).toBe('Bearer new-token');
    // 재시도도 같은 요청이다(본문·메서드 유지)
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ message: 'hi', conversationId: '3' }));
  });

  it('재시도한 요청이 또 401 이면 다시 갱신하지 않고 실패한다', async () => {
    fetchMock.mockResolvedValue(status(401));
    refreshMock.mockResolvedValue('new-token');

    await expect(collect(streamAssistantChat({ message: 'hi' }))).rejects.toThrow('HTTP 401');
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('갱신이 실패하면(null) 재시도하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(status(401));
    refreshMock.mockResolvedValueOnce(null);

    await expect(collect(streamAssistantChat({ message: 'hi' }))).rejects.toThrow('HTTP 401');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('401 이 아닌 실패(500)는 갱신 없이 그대로 실패한다', async () => {
    fetchMock.mockResolvedValueOnce(status(500));

    await expect(collect(streamAssistantChat({ message: 'hi' }))).rejects.toThrow('HTTP 500');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('중단 신호를 재시도 요청에도 넘긴다', async () => {
    fetchMock.mockResolvedValueOnce(status(401)).mockResolvedValueOnce(sseResponse([frame({ type: 'done' })]));
    refreshMock.mockResolvedValueOnce('new-token');
    const controller = new AbortController();

    await collect(streamAssistantChat({ message: 'hi' }, controller.signal));

    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
    expect(fetchMock.mock.calls[1][1]?.signal).toBe(controller.signal);
  });
});

describe('fetchConversationMessages — 복원 조회', () => {
  const messages = [{ role: 'user', content: 'q', createdAt: '2026-10-04T00:00:00Z' }];

  it('401 → 갱신 → 재시도로 메시지를 받는다(만료 토큰으로 새로고침해도 복원)', async () => {
    fetchMock.mockResolvedValueOnce(status(401)).mockResolvedValueOnce(status(200, { messages }));
    refreshMock.mockResolvedValueOnce('new-token');

    await expect(fetchConversationMessages('9')).resolves.toEqual(messages);
    expect(authOf(1)).toBe('Bearer new-token');
  });

  it('갱신 후에도 401 이면 null(일시 실패 — 호출부가 대화 id 를 지우지 않는다)', async () => {
    fetchMock.mockResolvedValue(status(401));
    refreshMock.mockResolvedValueOnce('new-token');

    await expect(fetchConversationMessages('9')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('200 빈 배열은 확정 결과(없음/타인 소유)', async () => {
    fetchMock.mockResolvedValueOnce(status(200, { messages: [] }));

    await expect(fetchConversationMessages('9')).resolves.toEqual([]);
  });

  it('네트워크 오류는 null', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(fetchConversationMessages('9')).resolves.toBeNull();
  });
});

describe('cancelAssistantStream — 명시적 중지 요청', () => {
  it('requestId 를 담아 stream/cancel 로 POST 한다(토큰 포함, keepalive)', async () => {
    fetchMock.mockResolvedValueOnce(status(204));

    await cancelAssistantStream('req-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/admin\/assistant\/stream\/cancel$/);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ requestId: 'req-1' }));
    expect(init?.keepalive).toBe(true);
    expect(authOf(0)).toBe('Bearer old-token');
  });

  it('네트워크 오류·서버 오류에도 던지지 않는다(화면 중지는 이미 끝났다)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(cancelAssistantStream('req-1')).resolves.toBeUndefined();

    fetchMock.mockResolvedValueOnce(status(404)); // 아직 이 엔드포인트가 없는 옛 백엔드
    await expect(cancelAssistantStream('req-1')).resolves.toBeUndefined();
  });

  it('스트림 요청 본문에 requestId 가 실린다', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([frame({ type: 'done' })]));

    await collect(streamAssistantChat({ message: 'hi', requestId: 'req-9' }));

    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ message: 'hi', requestId: 'req-9' }));
  });
});
