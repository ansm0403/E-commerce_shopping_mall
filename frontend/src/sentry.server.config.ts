// Next.js 서버(Node 런타임) Sentry 초기화. instrumentation.ts의 register()에서 로드된다.
// NEXT_PUBLIC_SENTRY_DSN 이 비어 있으면 Sentry는 자동 비활성화된다.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
