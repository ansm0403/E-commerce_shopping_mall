/**
 * LLM 클라이언트 DI 토큰.
 *
 * 어시스턴트/도구 로직은 구체 구현(GeminiClient 등)이 아니라 이 토큰으로 주입받은
 * `LlmClient` 인터페이스에만 의존한다. 추후 Claude 전환 시 provider 구현체만 교체하면
 * 소비 측 코드는 변경되지 않는다. (email 모듈의 'EMAIL_PROVIDER' 토큰과 같은 결)
 */
export const LLM_CLIENT = 'LLM_CLIENT';
