/**
 * Sentry 기본 설치 (설계 §6 — 역할 B: 이 앱 자신의 관측).
 *
 * DSN 이 없으면 init 을 건너뛴다 = 자동 비활성(no-op). 백엔드 `SENTRY_DSN`,
 * `ops` 모듈의 키 미설정 처리와 같은 관례다. 개발 초기에 DSN 없이도 앱이 그냥 돌아야 한다.
 *
 * ⚠ 쿼터는 조직 전체가 나눠 쓴다(월 5,000 errors). 앱 전용 프로젝트를 새로 만들어도
 * 쇼핑몰과 같은 한도를 공유하므로, 노이즈 필터(beforeSend)는 Phase 2 의 쿼터 방어 장치다.
 */
import * as Sentry from '@sentry/react-native';
import { APP_VERSION, SENTRY_DSN } from './config';

export function initSentry(): void {
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    // 개발 중 뜨는 에러까지 전부 올리면 5K 쿼터가 금방 닳는다.
    enabled: !__DEV__,
    release: APP_VERSION,
    // 성능 추적은 Phase 3(AI 호출 span)에서 켠다. 지금은 에러만.
    tracesSampleRate: 0,
  });
}

/** 로그인/로그아웃 시 사용자 컨텍스트. 이메일 등 PII 는 싣지 않는다(설계 §7 ④). */
export function setSentryUser(userId: number | null): void {
  if (!SENTRY_DSN) return;
  Sentry.setUser(userId === null ? null : { id: String(userId) });
}

/**
 * Sentry 연결 확인용 테스트 이벤트(Phase 0 DoD "의도적 에러 1건이 대시보드에 보인다").
 * 크래시를 일으키지 않고 captureException 으로 직접 보낸다 — 파이프라인(앱→Sentry)만 확인하면 되고,
 * 운영 앱이 테스트 때문에 죽을 이유는 없다. 개발 모드(__DEV__)에서는 init 의 enabled:false 때문에
 * 전송되지 않으므로 `yarn start --no-dev --minify` 로 실행해서 누른다.
 */
export function isSentryActive(): boolean {
  return Boolean(SENTRY_DSN) && !__DEV__;
}

export function sendSentryTestError(): string | undefined {
  if (!isSentryActive()) return undefined;
  return Sentry.captureException(new Error(`[ops-companion] Sentry 연결 테스트 ${new Date().toISOString()}`));
}
