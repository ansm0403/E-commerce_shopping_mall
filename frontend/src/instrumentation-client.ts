// 브라우저(클라이언트) Sentry 초기화. Next.js가 클라이언트 진입 시 자동 로드한다.
// DSN은 빌드 타임에 인라인되어야 하므로 NEXT_PUBLIC_ 접두어 필수.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  // Session Replay: 일반 세션 10%, 에러 발생 세션 100% 기록
  integrations: [Sentry.replayIntegration()],
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

// App Router 클라이언트 내비게이션 트레이싱
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
