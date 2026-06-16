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

/**
 * system 프롬프트 — 정적 prefix + 동적 suffix 분리. (Phase 6)
 *
 * 캐싱(implicit/explicit)은 "안정적 prefix"가 핵심이다. 매 요청 바뀌는 값(오늘 날짜 등)이
 * 정적 규칙 사이에 끼면 prefix가 흔들려 캐시 적중이 깨진다. 그래서 변하지 않는 부분(static)과
 * 매번 바뀌는 부분(dynamic)을 분리하고, 프로바이더 구현체가 각자 문법으로 캐시 경계를 잡는다:
 *  - Gemini: systemInstruction = static + '\n' + dynamic (날짜를 suffix로 → static+tools가 안정 prefix)
 *  - Claude(추후): system = [{text:static, cache_control:'ephemeral'}, {text:dynamic}] (breakpoint after static)
 * 인터페이스엔 프로바이더 고유 어휘(cache_control/cachedContent)를 노출하지 않는다 — 중립 개념만.
 */
export interface LlmSystemPrompt {
  /** 변하지 않는 부분(역할/규칙/도구 안내). 캐시 prefix의 본체. */
  static: string;
  /** 매 요청 바뀌는 부분(예: 오늘 날짜). static 뒤에 붙는다. 캐시 경계 밖. */
  dynamic?: string;
}

/** 토큰 사용량(usage). 캐시 적중 측정용. (Phase 6) */
export interface LlmUsage {
  /** 입력(프롬프트) 토큰. 캐시 적중분(cachedTokens)을 포함한 총 입력. */
  inputTokens: number;
  /** 출력(생성) 토큰. */
  outputTokens: number;
  /** 입력 중 캐시에서 재사용된 토큰(적중량). 0이면 미적중. */
  cachedTokens: number;
  /** thinking 모델의 추론 토큰(있을 때만). */
  thoughtsTokens?: number;
  /** 전체 토큰(프로바이더가 줄 때만). */
  totalTokens?: number;
}

/** 스트리밍 중 흘러나오는 이벤트 단위. (Phase 2~3, Phase 6 usage) */
export type LlmStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: LlmToolCall }
  | { type: 'usage'; usage: LlmUsage }
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
  generate(params: {
    system: LlmSystemPrompt;
    messages: LlmMessage[];
  }): Promise<string>;

  /**
   * 스트리밍 호출. 응답 텍스트를 조각(delta)으로 흘려보낸다. (Phase 2)
   * 텍스트 조각마다 { type:'text', delta } 를 yield 하고, 마지막에 { type:'done' }.
   * 비활성 상태에서 호출하면 안 된다(호출 측이 먼저 확인).
   */
  generateStream(params: {
    system: LlmSystemPrompt;
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
    system: LlmSystemPrompt;
    messages: LlmMessage[];
    tools: LlmToolDef[];
    executeTool: (call: LlmToolCall) => Promise<unknown>;
  }): AsyncIterable<LlmStreamEvent>;
}
