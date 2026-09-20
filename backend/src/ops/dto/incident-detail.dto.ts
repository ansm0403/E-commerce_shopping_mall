import { IncidentSummary } from './incident-summary.dto';

/**
 * GET /v1/ops/incidents/:id 응답 — Sentry issue + 최신 event 의 축약형 (설계 §4.3 S3 · §5.2).
 *
 * 최신 event raw 는 request 헤더·쿠키·user(IP/이메일)·debugmeta 까지 실려 수십 KB 다.
 * 앱 상세 화면이 그리는 것(예외·스택·breadcrumbs)만 남기고 나머지는 백엔드에서 버린다(§7 ⑤).
 */
export interface IncidentStackFrame {
  /** 예: "app:///_next/static/chunks/5585-….js", "src/order/order.service.ts" */
  filename: string | null;
  function: string | null;
  lineNo: number | null;
  colNo: number | null;
  /** true = 우리 코드, false = 라이브러리/런타임. 앱은 inApp 프레임을 강조한다 */
  inApp: boolean;
}

export interface IncidentException {
  /** 예: "AxiosError" */
  type: string | null;
  /** 예: "Network Error" — scrubText 로 이메일·전화 마스킹 */
  value: string | null;
  /** 최근 호출이 앞에 오도록 뒤집은 상위 N 프레임(Sentry 원본은 최근 호출이 마지막) */
  frames: IncidentStackFrame[];
}

export interface IncidentBreadcrumb {
  /** ISO 8601 */
  timestamp: string | null;
  /** 예: "xhr", "console", "navigation", "ui.click" */
  category: string | null;
  level: string | null;
  /** http 류는 "GET /api/categories → 0" 형태로 합성. scrubText 적용 */
  message: string | null;
}

export interface IncidentDetail extends IncidentSummary {
  /** 처음 발생 시각, ISO 8601 */
  firstSeen: string;
  /** 발생 위치 요약. 예: "GET /products" */
  culprit: string | null;
  /** Sentry 프로젝트 slug. 예: "e-commerse-frontend" */
  project: string | null;
  /** unresolved | resolved | ignored */
  status: string;
  /** 최신 event 에 예외가 없으면(메시지 이벤트 등) null */
  exception: IncidentException | null;
  /** 시간순(오래된 것 → 최근). 최근 N개만 */
  breadcrumbs: IncidentBreadcrumb[];
}
