/**
 * 관리자 AI 어시스턴트 SSE 와이어 이벤트 — 백엔드가 `data:` 프레임으로 보내고 프론트가 그대로 읽는다.
 * 한쪽만 고치면 어긋나므로 양쪽이 이 타입 하나를 쓴다(백엔드는 `import type` 만).
 */
export type AssistantStreamEvent =
  /** 스트림 시작 시 1회 — 대화 식별자 통지 */
  | { type: 'meta'; conversationId: string }
  /** 답변 텍스트 조각 */
  | { type: 'text'; delta: string }
  /** 도구 실행 **직전** — 이름만 보낸다(인자·결과는 보내지 않는다). 끝남은 다음 text/tool/done 으로 안다 */
  | { type: 'tool'; name: string }
  /** 정상 종료. 클라이언트가 중지한 경우에는 오지 않는다 */
  | { type: 'done' }
  | { type: 'error'; message: string };
