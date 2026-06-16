/**
 * 고객 작성 자유 텍스트(리뷰 comment / 문의 title·content·answer / AI 요약 입력)에서
 * 연락처 PII(이메일·전화번호)를 스크럽하는 leaf 유틸.
 *
 * - 무료티어(Gemini)로 보낸 입력은 학습에 활용될 수 있으므로(§4-2), 고객 텍스트를 LLM 에
 *   넘기기 전 여기서 이메일·전화만 골라 마스킹한다. 텍스트를 통째 마스킹하면 분석 가치가
 *   사라지므로 본문 의미는 보존한다.
 * - 의존 0(leaf) — review/inquiry/product 서비스가 admin/assistant 레이어를 역방향으로
 *   import 하지 않도록 common 으로 승격했다(원래 assistant-masking.ts 에 있던 scrubText 이전).
 */

/** 자유 텍스트 안의 이메일 패턴(여러 개) 탐지용. */
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * 한국 전화번호(휴대폰/유선, 구분자 -, ., 공백 또는 없음, +82 국제형 포함).
 * - 접두: 국제형 `+82`(뒤따르는 0은 생략 가능) 또는 국내형 선행 `0`.
 * - 식별번호: 휴대폰 1X(010/011/016~019) 또는 지역번호 2~7X(02/031/051/070 등).
 * - 가격(1,234,000)·주문번호(ORD-...-A1B2) 등은 자릿수/형식이 달라 매칭되지 않는다.
 */
const PHONE_IN_TEXT =
  /(?:\+?82[-.\s]?0?|0)(?:1[0-9]|[2-7][0-9]?)[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;

/** 텍스트 내 이메일 1건을 "앞 1글자 + ***@***" 로 마스킹(maskEmail 의 텍스트 인라인판). */
function maskEmailInText(email: string): string {
  const at = email.indexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  const head = local.slice(0, 1) || '*';
  return `${head}***@***`;
}

/**
 * 자유 텍스트에서 이메일·전화번호 PII 를 마스킹한다(본문 의미는 보존).
 * null/undefined 는 그대로 통과(메타-only 행 등).
 */
export function scrubText(text: string | null | undefined): string | null {
  if (text == null) return null;
  return String(text)
    .replace(EMAIL_IN_TEXT, (m) => maskEmailInText(m))
    .replace(PHONE_IN_TEXT, '***');
}
