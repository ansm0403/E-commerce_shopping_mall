/**
 * Sentry 로 나가는 텍스트에서 민감정보를 지운다 (설계 §6 beforeSend · §7 ④).
 *
 * 규칙의 절반은 백엔드 [common/utils/scrub-text.ts] 와 **같은 것**(이메일·한국 전화번호)이고,
 * 나머지 절반은 **앱에만 있는 비밀 3종**이다. 앱은 토큰을 손에 들고 다니기 때문이다 —
 * SecureStore 에서 꺼낸 JWT, 요청 헤더의 `Bearer …`, 그리고 이 기기의 푸시 주소.
 * 이것들이 에러 메시지나 행동 기록에 섞여 Sentry 로 나가면, 대시보드를 볼 수 있는 사람이
 * 그대로 그 계정으로 API 를 부를 수 있다.
 *
 * 텍스트를 통째로 지우지 않고 해당 부분만 가리는 것도 백엔드와 같은 방침이다 —
 * 다 지우면 에러를 읽을 수 없게 되어 관측의 의미가 사라진다.
 */

/** 이메일. 백엔드 EMAIL_IN_TEXT 와 동일. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** 한국 전화번호(휴대폰·유선, +82 국제형 포함). 백엔드 PHONE_IN_TEXT 와 동일. */
const PHONE = /(?:\+?82[-.\s]?0?|0)(?:1[0-9]|[2-7][0-9]?)[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;

/** `Authorization: Bearer eyJ…` 헤더가 통째로 실려 나가는 경우. */
const BEARER = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;

/**
 * JWT 본체. `Bearer` 없이 값만 로그에 찍히는 경우를 잡는다.
 * 세 토막(header.payload.signature)이 점으로 이어지고 `eyJ`(= base64 의 `{"`)로 시작한다.
 */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g;

/** 이 기기의 푸시 주소. 유출되면 남이 이 폰으로 알림을 쏠 수 있다. */
const EXPO_PUSH_TOKEN = /Expo(?:nent)?PushToken\[[^\]]*\]/g;

/** 이메일 1건을 "앞 1글자 + ***@***" 로. 백엔드 maskEmailInText 와 동일. */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  return `${local.slice(0, 1) || '*'}***@***`;
}

/** 자유 텍스트에서 PII·자격증명을 마스킹한다. null/undefined 는 그대로 통과. */
export function scrubText<T extends string | null | undefined>(text: T): T {
  if (text == null) return text;
  return String(text)
    .replace(EXPO_PUSH_TOKEN, 'ExponentPushToken[***]')
    .replace(BEARER, 'Bearer ***')
    .replace(JWT, '***')
    .replace(EMAIL, maskEmail)
    .replace(PHONE, '***') as T;
}

/**
 * URL 에서 쿼리스트링과 해시를 떼어낸다.
 *
 * 쿼리에는 검색어·토큰·이메일이 실릴 수 있고, 남겨 두면 같은 엔드포인트가 쿼리마다 다른
 * 이슈로 갈라져 쿼터도 더 먹는다. 백엔드가 인시던트 상세의 breadcrumb 을 만들 때 쓰는
 * 방침과 같다(설계 §7 ⑤ · 학습 노트 2편 3-7).
 */
export function stripQuery(url: string | null | undefined): string | null {
  if (url == null) return null;
  return String(url).split(/[?#]/)[0];
}
