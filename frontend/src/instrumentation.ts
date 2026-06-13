// Next.js 서버 시작 시 실행되는 계측 진입점.
// 런타임(nodejs/edge)에 맞는 Sentry 설정을 로드하고,
// onRequestError로 서버 컴포넌트/라우트 핸들러의 에러를 Sentry로 보낸다.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
