// Sentry 초기화 — 반드시 다른 모듈보다 "먼저" 로드되어야 한다(main.ts 최상단 import).
// 그래야 NestJS/Express/DB 등에 자동 계측(instrumentation)이 정상적으로 붙는다.
//
// SENTRY_DSN 이 없으면 Sentry SDK는 자동으로 비활성(no-op) 상태가 되어
// 로컬/개발 환경에서 별도 분기 없이도 안전하게 동작한다.
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  // 트레이싱 샘플링: 운영은 10%(비용/성능), 개발은 100%
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
