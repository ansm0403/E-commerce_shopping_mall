// Sentry 초기화 — 반드시 다른 모듈보다 "먼저" 로드되어야 한다(main.ts 최상단 import).
// 그래야 NestJS/Express/DB 등에 자동 계측(instrumentation)이 정상적으로 붙는다.
//
// SENTRY_DSN 이 없으면 Sentry SDK는 자동으로 비활성(no-op) 상태가 되어
// 로컬/개발 환경에서 별도 분기 없이도 안전하게 동작한다.
import * as Sentry from '@sentry/nestjs';

// 릴리즈 = 배포 커밋(짧은 SHA). Dockerfile 이 --build-arg GIT_SHA 로 APP_VERSION 에 넣는 값과 같다(/v1/health 의 version).
// 이 값이 있어야 Sentry 이벤트가 "어느 커밋에서 났는지"를 알고, Ops Companion 의 AI 분석이 그 커밋의 소스를 읽는다
// (ops-companion-design §9 Phase 5 결정 ②). 로컬(APP_VERSION 없음·'unknown')은 릴리즈 없이 보낸다 — 가짜 릴리즈를 만들지 않는다.
const appVersion = process.env.APP_VERSION?.trim();
const release = appVersion && appVersion !== 'unknown' ? appVersion : undefined;

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  release,
  // 트레이싱 샘플링: 운영은 10%(비용/성능), 개발은 100%
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
