/**
 * 채팅 메시지 모델 + 스트림 이벤트를 메시지에 반영하는 순수 함수.
 * React·네트워크를 모른다 → 상태 전이(도구 진행 표시·중지)를 단위 테스트로 고정한다.
 */

/** 도구 1회 실행의 표시 상태. running → done(다음 이벤트가 옴) | stopped(끝나기 전에 중지·오류) */
export interface ToolRun {
  name: string;
  status: 'running' | 'done' | 'stopped';
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 이 답변을 만들며 실행한 도구(시간순). 새로고침 후 복원된 메시지에는 없다(저장하지 않는다). */
  tools?: ToolRun[];
  /** 사용자가 중지한 답변. 복원된 메시지에는 없다. */
  stopped?: boolean;
}

/**
 * 도구 이름 → 화면 문구. 서버는 이름만 보내고 문구는 UI 가 소유한다.
 * 표에 없는 이름(백엔드에 도구가 추가됐는데 프론트가 아직 모름)은 기본 문구로.
 */
const TOOL_LABELS: Record<string, string> = {
  get_sales_summary: '매출 데이터',
  get_order_stats: '주문 통계',
  query_audit_logs: '감사 로그',
  get_product_info: '상품 정보',
  summarize_reviews: '리뷰',
  summarize_inquiries: '고객 문의',
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? '데이터';
}

/** "매출 데이터 조회 중" / "매출 데이터 조회 완료" / "매출 데이터 조회 중단" */
export function toolStatusText(tool: ToolRun): string {
  const suffix = tool.status === 'running' ? '조회 중' : tool.status === 'done' ? '조회 완료' : '조회 중단';
  return `${toolLabel(tool.name)} ${suffix}`;
}

/** 실행 중인 도구를 모두 같은 상태로 닫는다. 바뀐 게 없으면 같은 배열을 돌려준다. */
function closeRunning(tools: ToolRun[] | undefined, status: 'done' | 'stopped'): ToolRun[] | undefined {
  if (!tools?.some((t) => t.status === 'running')) return tools;
  return tools.map((t) => (t.status === 'running' ? { ...t, status } : t));
}

/**
 * 진행 중인 assistant 메시지에 이벤트 하나를 반영한다.
 * 서버는 도구의 "끝"을 따로 알리지 않는다 — 다음 text/tool/done 이 오면 앞 도구가 끝난 것이다.
 */
export function applyStreamEvent(
  message: ChatMessage,
  ev: { type: 'text'; delta: string } | { type: 'tool'; name: string } | { type: 'done' },
): ChatMessage {
  const tools = closeRunning(message.tools, 'done');
  switch (ev.type) {
    case 'text':
      return { ...message, tools, content: message.content + ev.delta };
    case 'tool':
      return { ...message, tools: [...(tools ?? []), { name: ev.name, status: 'running' }] };
    case 'done':
      return tools === message.tools ? message : { ...message, tools };
  }
}

/**
 * 스트림이 done 없이 끝났을 때(중지·오류·연결 끊김) 메시지를 닫는다.
 * 실행 중이던 도구는 "중단"으로, 사용자가 중지한 경우에만 stopped 표시를 단다.
 */
export function closeInterrupted(message: ChatMessage, byUser: boolean): ChatMessage {
  const tools = closeRunning(message.tools, 'stopped');
  if (tools === message.tools && !byUser) return message;
  return { ...message, tools, ...(byUser ? { stopped: true } : {}) };
}
