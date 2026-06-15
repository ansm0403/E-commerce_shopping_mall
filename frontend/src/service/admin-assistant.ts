import { authStorage } from './auth-storage';

/**
 * 관리자 AI 어시스턴트 — 스트리밍 클라이언트.
 *
 * 스트리밍은 axios(authClient)로는 다루기 어렵고, 네이티브 EventSource는 POST·Authorization
 * 헤더를 못 쓴다. 그래서 fetch + ReadableStream으로 직접 호출하고 SSE `data:` 프레임을 파싱한다.
 * (업계 표준: "SSE 포맷 + fetch 스트림")
 */

/** 백엔드 SSE 와이어 이벤트 (AssistantStreamEvent와 1:1). */
export type AssistantEvent =
  | { type: 'meta'; conversationId: string }
  | { type: 'text'; delta: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

// axios baseURL과 동일 규칙: 브라우저 `/api/*` → next.config rewrites → 백엔드 `/v1/*`
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/**
 * 어시스턴트 스트리밍 호출. SSE 이벤트를 순서대로 yield 하는 async generator.
 * @param body message + (선택) conversationId
 * @param signal 중단용 AbortSignal
 */
export async function* streamAssistantChat(
  body: { message: string; conversationId?: string },
  signal?: AbortSignal,
): AsyncGenerator<AssistantEvent> {
  const token = authStorage.getAccessToken();

  const res = await fetch(`${API_BASE}/admin/assistant/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`assistant stream 실패: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 프레임은 빈 줄(\n\n)로 구분된다.
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      const dataLine = frame
        .split('\n')
        .find((line) => line.startsWith('data:'));
      if (!dataLine) continue;

      const json = dataLine.slice(5).trim();
      if (json) yield JSON.parse(json) as AssistantEvent;
    }
  }
}
