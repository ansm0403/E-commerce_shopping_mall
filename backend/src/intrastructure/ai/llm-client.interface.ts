/**
 * 프로바이더 비종속 LLM 클라이언트 인터페이스.
 *
 * 목적: 어시스턴트/도구 로직이 특정 LLM SDK(현재 Gemini, 추후 Claude)의 어휘에
 * 묶이지 않게 한다. Gemini의 `functionDeclarations`/`functionResponse`, Claude의
 * `tool_use`/`tool_result` 같은 프로바이더 고유 포맷은 각 구현체(GeminiClient 등)
 * 내부에 가두고, 바깥에는 아래의 중립 타입만 노출한다.
 *
 * 단계적 확장(계획서 ex-ai-assistant.md §5):
 *  - Phase 0~1: isEnabled() + generate()  ← 완료
 *  - Phase 2  : generateStream()          ← 스트리밍 완료
 *  - Phase 3  : generateWithTools()       ← function calling(tool use) (현재)
 */

/** 대화 한 턴. 프로바이더의 role 표기(user/model, user/assistant)는 구현체가 변환한다. */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** AI에게 "쓸 수 있다"고 알려줄 도구 정의. parameters는 중립 JSON Schema. (Phase 3) */
export interface LlmToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** AI가 "이 도구를 호출해달라"고 요청한 내용. (Phase 3) */
export interface LlmToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/** 스트리밍 중 흘러나오는 이벤트 단위. (Phase 2~3) */
export type LlmStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: LlmToolCall }
  | { type: 'done' };

export interface LlmClient {
  /**
   * 기능 활성 여부. API 키가 없으면 false → 어시스턴트는 no-op 처리한다.
   * (Sentry DSN / 이메일 모듈의 "설정 없으면 비활성" 패턴과 동일)
   */
  isEnabled(): boolean;

  /**
   * 단일/멀티턴 1회 호출. messages 전체(누적된 대화)를 보내고 응답 텍스트를 받는다.
   * LLM API는 stateless이므로 "기억"은 messages를 매번 통째로 보내는 것으로 구현된다.
   * 비활성(isEnabled()=false) 상태에서 호출하면 안 된다(호출 측이 먼저 확인).
   */
  generate(params: { system: string; messages: LlmMessage[] }): Promise<string>;

  /**
   * 스트리밍 호출. 응답 텍스트를 조각(delta)으로 흘려보낸다. (Phase 2)
   * 텍스트 조각마다 { type:'text', delta } 를 yield 하고, 마지막에 { type:'done' }.
   * 비활성 상태에서 호출하면 안 된다(호출 측이 먼저 확인).
   */
  generateStream(params: {
    system: string;
    messages: LlmMessage[];
  }): AsyncIterable<LlmStreamEvent>;

  /**
   * 도구(function calling) 포함 스트리밍 호출. (Phase 3)
   * - 모델이 도구 호출을 요청하면 { type:'tool_call' } 을 yield 하고, executeTool 콜백으로
   *   실제 실행한 뒤 결과를 모델에 되돌려 최종 답변을 잇는 루프를 내부에서 처리한다.
   * - 도구 실행 자체는 호출 측(executeTool)이 소유 → 클라이언트는 비즈니스 로직을 모른다.
   * - 텍스트는 { type:'text' } 델타로, 종료 시 { type:'done' }.
   */
  generateWithTools(params: {
    system: string;
    messages: LlmMessage[];
    tools: LlmToolDef[];
    executeTool: (call: LlmToolCall) => Promise<unknown>;
  }): AsyncIterable<LlmStreamEvent>;
}
