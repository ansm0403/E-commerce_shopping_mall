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

/** 새로고침 후 UI 복원용 — 대화의 저장된 메시지(시간순). */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/**
 * 대화 메시지 조회. 스트리밍이 아니므로 일반 fetch GET.
 * 반환 의미를 구분한다(복원 로직이 "id를 지울지" 판단해야 하므로):
 * - `ConversationMessage[]`(빈 배열 포함): **확정 결과**. 200 OK. 빈 배열 = 없음/타인 소유 → id 폐기 가능.
 * - `null`: **일시적 실패**(네트워크/401 등). id를 지우면 안 됨(다음에 복원 가능).
 *   (만료 토큰으로 마운트 시 401을 빈 결과로 오인해 유효한 id를 날리는 사고 방지.)
 */
export async function fetchConversationMessages(
  conversationId: string,
): Promise<ConversationMessage[] | null> {
  try {
    const token = authStorage.getAccessToken();
    const res = await fetch(
      `${API_BASE}/admin/assistant/conversations/${conversationId}/messages`,
      { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
    );
    if (!res.ok) return null; // 401/5xx 등 일시적 실패 → 호출부가 id 유지
    const data = (await res.json()) as { messages?: ConversationMessage[] };
    return data.messages ?? [];
  } catch {
    return null; // 네트워크/파싱 실패 → 일시적
  }
}

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
