/**
 * 어시스턴트 도구 결과의 PII 비식별화(§4-2 데이터 등급 게이트).
 *
 * 무료티어(Gemini)로 보낸 입력은 학습에 활용될 수 있으므로, query_audit_logs 처럼
 * 이메일·IP 등 PII를 포함하는 도구 결과는 LLM 전송 전 여기서 마스킹한다.
 * (도구 결과는 ClassSerializerInterceptor 를 거치지 않아 @Exclude 가 안 먹는다 — 직접 가공.)
 *
 * 유료(Claude/Vertex) 전환 시엔 학습 미사용이 보장되므로, 호출부에서 마스킹을 건너뛰도록
 * 게이트를 추가할 수 있다(현재는 항상 마스킹).
 */

/** "john.doe@example.com" → "j***@***" (앞 1글자만 남기고 로컬·도메인 마스킹). */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  const head = local.slice(0, 1) || '*';
  return `${head}***@***`;
}

/** "192.168.0.5" → "192.168.*.*", IPv6/기타는 보수적으로 마스킹. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.split('.');
  if (v4.length === 4) return `${v4[0]}.${v4[1]}.*.*`;
  if (ip.includes(':')) return `${ip.split(':')[0]}:***`; // IPv6
  return '***';
}

/** 값이 이메일 형태인지(대략) 판별. metadata 자유필드 안의 PII 탐지용. */
function looksLikeEmail(v: unknown): v is string {
  return typeof v === 'string' && /\S+@\S+\.\S+/.test(v);
}

/**
 * 자유 텍스트(리뷰/문의 본문)의 연락처 PII 스크럽은 공용 leaf 유틸로 승격됨:
 * `src/common/utils/scrub-text.ts` 의 `scrubText`. (Phase 5c — 도메인 서비스의 admin/assistant
 * 역방향 의존 해소 + product 요약에서도 재사용.)
 */

/**
 * metadata(자유형 JSON)를 선택적으로 비식별화한다.
 * - 통째 드롭하면 분석에 중요한 비-PII 진단정보(reason='invalid_password'/'user_not_found',
 *   count, orderNumbers 등)까지 잃어 모델이 원인을 "추측"하게 된다 → 키 단위로 처리.
 * - 키 이름에 email/ip 가 들어가거나 값이 이메일 형태면 마스킹, 그 외는 그대로 보존.
 */
export function sanitizeMetadata(
  md: Record<string, any> | null | undefined,
): Record<string, any> | null {
  if (!md || typeof md !== 'object') return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(md)) {
    const key = k.toLowerCase();
    if (key.includes('email') || looksLikeEmail(v)) out[k] = maskEmail(String(v));
    else if (key === 'ip' || key.includes('ipaddress')) out[k] = maskIp(String(v));
    else out[k] = v;
  }
  return out;
}

/** getAuditLogs 의 enriched 행에서 LLM 전송에 안전한 형태만 남긴다. */
export interface MaskedAuditLog {
  id: number;
  userId: number | null;
  userNickName: string | null;
  userEmail: string | null; // 마스킹됨
  action: string;
  ipAddress: string | null; // 마스킹됨
  success: boolean;
  errorMessage: string | null;
  metadata: Record<string, any> | null; // email/ip 키만 마스킹, reason 등 진단정보 보존
  createdAt: Date;
}

/**
 * 감사 로그 배열을 비식별화한다.
 * - 마스킹: userEmail, ipAddress, metadata 내 email/ip 키
 * - 드롭: userAgent(브라우저 지문)
 * - 유지: id/userId(내부 식별자), userNickName(관리자 화면 노출값),
 *         action/success/errorMessage/createdAt, metadata의 비-PII 키(reason 등)
 */
export function maskAuditLogs(rows: any[]): MaskedAuditLog[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    userId: r.userId ?? null,
    userNickName: r.userNickName ?? null,
    userEmail: maskEmail(r.userEmail),
    action: r.action,
    ipAddress: maskIp(r.ipAddress),
    success: r.success,
    errorMessage: r.errorMessage ?? null,
    metadata: sanitizeMetadata(r.metadata),
    createdAt: r.createdAt,
  }));
}
