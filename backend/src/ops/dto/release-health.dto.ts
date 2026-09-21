/**
 * GET /v1/ops/release-health 응답 — Sentry sessions API 의 축약형 (설계 §6 Release Health).
 *
 * **세션**은 "앱을 한 번 열어서 쓰는 동안"이다. 앱이 켜질 때 하나 시작되고, 백그라운드로
 * 일정 시간 이상 내려가거나 종료되면 끝난다. SDK 가 알아서 보내므로 우리가 계측할 것은 없다
 * (@sentry/react-native 의 enableAutoSessionTracking 기본 켜짐 — 실측으로 확인).
 *
 * **crash-free sessions** 는 그 세션 중 크래시 없이 끝난 비율이다. 에러 "건수"와 다른 지표인데,
 * 이 차이가 핵심이다 — 에러 100건이 한 사람에게서만 나면 심각도가 낮고, 1건이라도 열 때마다
 * 죽으면 치명적이다. 건수는 그걸 구분하지 못하고 비율은 구분한다.
 */
export interface ReleaseHealthItem {
  /** 릴리즈 이름. 예: "dev.ansmoon.opscompanion@1.0.0+1" */
  release: string;
  /** 0~1. Sentry 가 집계 기간 내 세션이 없으면 null 을 준다 */
  crashFreeRate: number | null;
  /** 집계 기간 내 세션 수 */
  sessions: number;
}

export interface ReleaseHealth {
  /** 집계 기간. 예: "14d" */
  period: string;
  /** 세션이 많은 순. 앱 요약 카드는 첫 항목을 크게 그린다 */
  releases: ReleaseHealthItem[];
}
