/**
 * 웹 → 앱 연동 확인 — "방문자 테스트 에러" 만들기·보내기 (설계 §9 "웹 → 앱 연동 확인" 결정 ①②⑥).
 *
 * 이 파일이 만드는 에러는 **의도된 테스트 에러**다. 버그가 아니다.
 * 포트폴리오 방문자가 `/admin/ops-app` 의 버튼을 누르면 여기서 만든 에러가 프론트 Sentry 프로젝트로 가고,
 * 운영 앱(Ops Companion)의 인시던트 목록에 `[방문자 테스트 A7K2]` 처럼 방문자가 고른 코드와 함께 나타난다 —
 * 웹과 앱이 같은 운영 데이터를 본다는 것을 방문자가 스스로 확인하는 장치다.
 *
 * 왜 백엔드 "테스트 에러 API" 가 아니라 브라우저에서 던지는가: 실제 프론트 장애와 같은 길(프론트 프로젝트 → 소스맵 →
 * 앱의 AI 분석이 이 파일을 GitHub 에서 읽는다)을 타야 "진짜"다. throw 하지 않고 captureException 만 부르는 이유는
 * global-error 화면으로 방문자를 내쫓지 않기 위해서다.
 */
import * as Sentry from '@sentry/nextjs';
import {
  OPS_VISITOR_TEST_FINGERPRINT,
  buildVisitorTestTitle,
  visitorTestMarker,
} from '@shopping-mall/shared';

/** 코드 4자 — 0/O/1/I 처럼 헷갈리는 글자는 뺀다. 방문자가 앱 목록에서 눈으로 찾는 값이다 */
export const VISITOR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const VISITOR_CODE_LENGTH = 4;

/** 브라우저당 쿨다운(결정 ⑥). 연타로 이슈를 양산하지 않게. 서버 측 상한은 두지 않는다(이슈 하나당 이벤트 1건) */
export const VISITOR_TEST_COOLDOWN_MS = 60_000;
const COOLDOWN_STORAGE_KEY = 'ops-app:visitor-test:lastSentAt';

export { visitorTestMarker };

export function generateVisitorCode(): string {
  const bytes = new Uint8Array(VISITOR_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => VISITOR_CODE_ALPHABET[b % VISITOR_CODE_ALPHABET.length]).join('');
}

/** Sentry 이슈 제목이 `VisitorTestError: [방문자 테스트 A7K2] …` 가 되도록 이름을 고정한다 */
export class VisitorTestError extends Error {
  constructor(public readonly code: string) {
    super(buildVisitorTestTitle(code));
    this.name = 'VisitorTestError';
  }
}

/**
 * 이름 있는 함수에서 만든다 — 스택 최상단 프레임이 이 파일·이 함수가 되어,
 * 앱의 AI 분석(v3.1)이 소스맵을 따라 이 파일을 읽고 "의도된 테스트 에러" 라고 답할 수 있다.
 */
export function raiseVisitorTestError(code: string): VisitorTestError {
  return new VisitorTestError(code);
}

/** DSN 이 없는 환경(로컬 기본)에서는 captureException 이 아무 데도 보내지 않는다 — 화면에 그 사실을 알린다 */
export function isSentryEnabled(): boolean {
  return Boolean(Sentry.getClient()?.getDsn());
}

export interface VisitorTestSend {
  code: string;
  eventId: string | undefined;
  sentAt: Date;
}

/**
 * fingerprint 에 코드를 넣어 **방문자마다 이슈 하나**(결정 ②). Sentry 는 같은 에러를 한 이슈로 묶으므로
 * 이 줄이 없으면 모든 방문자의 테스트가 이슈 하나에 이벤트로만 쌓인다.
 */
export function sendVisitorTestError(code: string): VisitorTestSend {
  const error = raiseVisitorTestError(code);
  const eventId = Sentry.withScope((scope) => {
    scope.setFingerprint([OPS_VISITOR_TEST_FINGERPRINT, code]);
    scope.setTag('visitor_test', 'true');
    scope.setTag('visitor_code', code);
    scope.setLevel('error');
    return Sentry.captureException(error);
  });
  return { code, eventId, sentAt: new Date() };
}

export type SendConfirmation =
  | { status: 'confirmed'; statusCode?: number }
  | { status: 'failed'; reason: 'no-client' | 'timeout' | 'rejected'; statusCode?: number };

/**
 * 전송이 **실제로 서버에 닿았는지** 기다린다. `captureException` 이 돌려주는 event id 는 브라우저 안에서 만든 값이라
 * 전송 성공의 증거가 아니다 — 2026-09-27 운영 실기기에서 광고 차단기(EasyPrivacy 는 Sentry 터널 경로 `/monitoring?o=…&p=…` 까지 막는다)가
 * 전송을 막았는데 화면은 "Sentry event 899f…" 를 보여줬다. SDK 는 응답을 받은 뒤 `afterSendEvent` 훅을 부르고,
 * fetch 가 차단돼 거부되면 훅이 오지 않는다 → 시간 제한으로 실패를 판정한다.
 */
export function waitForSend(eventId: string | undefined, timeoutMs = 8000): Promise<SendConfirmation> {
  const client = Sentry.getClient();
  if (!client || !eventId) return Promise.resolve({ status: 'failed', reason: 'no-client' });
  return new Promise((resolve) => {
    let done = false;
    let off: (() => void) | undefined;
    const finish = (result: SendConfirmation) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off?.();
      resolve(result);
    };
    off = client.on('afterSendEvent', (event, response) => {
      if (event.event_id !== eventId) return;
      const code = response?.statusCode;
      if (code === undefined || (code >= 200 && code < 300)) finish({ status: 'confirmed', statusCode: code });
      else finish({ status: 'failed', reason: 'rejected', statusCode: code });
    });
    const timer = setTimeout(() => finish({ status: 'failed', reason: 'timeout' }), timeoutMs);
  });
}

/** 남은 쿨다운(ms). localStorage 가 막힌 환경(시크릿 등)에서는 0 — 쿨다운은 예의이지 보안이 아니다 */
export function readCooldownRemainingMs(now: number = Date.now()): number {
  try {
    const last = Number(localStorage.getItem(COOLDOWN_STORAGE_KEY));
    if (!Number.isFinite(last) || last <= 0) return 0;
    return Math.max(0, last + VISITOR_TEST_COOLDOWN_MS - now);
  } catch {
    return 0;
  }
}

export function markVisitorTestSent(now: number = Date.now()): void {
  try {
    localStorage.setItem(COOLDOWN_STORAGE_KEY, String(now));
  } catch {
    /* 저장 불가 환경 — 쿨다운 없이 진행 */
  }
}

/** 버튼을 누른 시각을 KST 로 — 앱 상세의 "처음 N분 전" 과 맞춰 보는 두 번째 증거(결정 ⑦) */
export function formatKst(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
