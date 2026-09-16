/**
 * GET /v1/ops/incidents 응답 항목 — Sentry issue 의 축약형.
 *
 * Sentry raw JSON(40여 필드: permalink·assignedTo·seer* 등)을 그대로 넘기지 않는다.
 * 앱 목록 화면에 필요한 5개만 남기는 것이 §7 보안 원칙(불필요한 내부 정보 유출 차단)이자
 * 앱 payload 다이어트다. (docs/roadmap/ops-companion-design.md §5.2)
 */
export type IncidentLevel = 'error' | 'warning' | 'info';

export interface IncidentSummary {
  /** Sentry issue id (문자열 — 64bit 정수라 JS number 로 옮기면 정밀도가 깨진다) */
  id: string;
  /** 예: "TypeError: cannot read property 'name'" */
  title: string;
  level: IncidentLevel;
  /** 집계 기간(statsPeriod) 내 발생 횟수. Sentry 는 문자열로 주므로 숫자로 변환 */
  count: number;
  /** 마지막 발생 시각, ISO 8601 */
  lastSeen: string;
}
