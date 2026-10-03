import type { AssistantStreamEvent } from '@shopping-mall/shared';
import { authStorage } from './auth-storage';
import { parseSseChunk } from './assistant-sse';

/**
 * 관리자 AI 어시스턴트 — 스트리밍 클라이언트.
 *
 * 스트리밍은 axios(authClient)로는 다루기 어렵고, 네이티브 EventSource는 POST·Authorization
 * 헤더를 못 쓴다. 그래서 fetch + ReadableStream으로 직접 호출하고 SSE `data:` 프레임을 파싱한다.
 * (업계 표준: "SSE 포맷 + fetch 스트림")
 */

/** 백엔드 SSE 와이어 이벤트 — 백엔드와 같은 타입을 shared 에서 가져온다. */
export type AssistantEvent = AssistantStreamEvent;

// axios baseURL과 동일 규칙: 브라우저 `/api/*` → next.config rewrites → 백엔드 `/v1/*`
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/** 새로고침 후 UI 복원용 — 대화의 저장된 메시지(시간순). */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/**
 * Bearer 토큰을 붙인 fetch + **401 이면 토큰을 갱신해 1회만 재시도**.
 *
 * 스트리밍 경로는 axios(authClient) 인터셉터를 타지 않으므로 같은 규칙을 여기서 한 번 더 적용한다.
 * - 갱신은 axios 쪽과 **같은 함수**(refreshAccessToken)를 쓴다 → "동시 refresh 는 1회" 규칙을 공유한다.
 *   갱신에 실패하면 그 함수가 토큰을 지우고 로그인으로 보낸다(null 반환) — 여기서는 첫 401 응답을 그대로 돌려준다.
 * - 인증은 요청을 시작할 때 한 번만 검사되므로, 스트림 도중의 만료는 다루지 않는다.
 * - 재시도한 요청이 또 401 이면 다시 갱신하지 않는다(무한 반복 방지).
 * - axios 모듈은 401 일 때만 동적으로 불러온다 — 정적 import 면 이 라우트 First Load 가 22 kB 늘어난다(측정).
 *   동적으로 불러와도 모듈 인스턴스는 하나라 갱신 큐는 그대로 공유된다.
 */
async function fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  const withToken = (token: string | null): RequestInit => ({
    ...init,
    headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

  const res = await fetch(url, withToken(authStorage.getAccessToken()));
  if (res.status !== 401) return res;

  const { refreshAccessToken } = await import('../lib/axios/axios-http-client');
  const newToken = await refreshAccessToken();
  if (!newToken) return res;
  return fetch(url, withToken(newToken));
}

/**
 * 대화 메시지 조회. 스트리밍이 아니므로 일반 fetch GET.
 * 반환 의미를 구분한다(복원 로직이 "id를 지울지" 판단해야 하므로):
 * - `ConversationMessage[]`(빈 배열 포함): **확정 결과**. 200 OK. 빈 배열 = 없음/타인 소유 → id 폐기 가능.
 * - `null`: **일시적 실패**(네트워크/갱신 후에도 401 등). id를 지우면 안 됨(다음에 복원 가능).
 *   (만료 토큰으로 마운트 시 401을 빈 결과로 오인해 유효한 id를 날리는 사고 방지.)
 */
export async function fetchConversationMessages(
  conversationId: string,
): Promise<ConversationMessage[] | null> {
  try {
    const res = await fetchWithAuth(
      `${API_BASE}/admin/assistant/conversations/${conversationId}/messages`,
    );
    if (!res.ok) return null; // 갱신 후에도 401·5xx 등 일시적 실패 → 호출부가 id 유지
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
  const res = await fetchWithAuth(`${API_BASE}/admin/assistant/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    // 끝난 프레임만 꺼내고, 잘린 나머지는 다음 청크 앞에 붙인다.
    const { events, rest } = parseSseChunk<AssistantEvent>(
      buffer + decoder.decode(value, { stream: true }),
    );
    buffer = rest;
    yield* events;
  }
}
