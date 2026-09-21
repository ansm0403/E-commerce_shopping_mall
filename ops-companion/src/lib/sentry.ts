/**
 * Sentry 설치와 계측 (설계 §6 — 역할 B: 이 앱 자신의 관측).
 *
 * DSN 이 없으면 init 을 건너뛴다 = 자동 비활성(no-op). 백엔드 `SENTRY_DSN`,
 * `ops` 모듈의 키 미설정 처리와 같은 관례다. 개발 초기에 DSN 없이도 앱이 그냥 돌아야 한다.
 *
 * Phase 2 에서 더한 것 세 가지(§6 의 beforeSend·태그 행):
 *   ① 노이즈 상한  — 같은 에러 60초 1건 + 실행당 20건. **쿼터 방어 장치**다.
 *   ② PII 마스킹   — 나가는 모든 텍스트를 scrubText 로 거른다.
 *   ③ 태그         — screen(useScreenTag) · appVersion · 사용자 id.
 *
 * ⚠ 쿼터는 조직 전체가 나눠 쓴다(월 5,000 errors). 앱 전용 프로젝트를 새로 만들어도
 * 쇼핑몰과 같은 한도를 공유한다. 그래서 ① 은 "있으면 좋은 것"이 아니라 필수다.
 */
import * as Sentry from '@sentry/react-native';
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';
import { APP_VERSION, SENTRY_DSN } from './config';
import { scrubText, stripQuery } from './scrub';

/** 같은 에러를 다시 보낼 수 있게 되는 간격. 쇼핑몰 프론트 리포터와 같은 값. */
const DEDUPE_WINDOW_MS = 60_000;

/**
 * 앱을 한 번 실행하는 동안 보낼 수 있는 최대 이벤트 수.
 * 렌더 루프 안에서 에러가 나면 초당 수십 건이 나갈 수 있다(설계 §6 "무한 루프성 에러를 조심").
 * 웹의 탭(10건)보다 넉넉한 이유는 앱이 며칠씩 켜져 있기 때문이다.
 */
const MAX_EVENTS_PER_SESSION = 20;

/** 연결 확인용 이벤트임을 나타내는 표식. 이 이벤트만 ① 의 억제를 건너뛴다. */
const TEST_TAG = 'ops.test';

/** 에러 signature → 마지막 전송 시각. 앱을 껐다 켜면 초기화된다. */
const lastSentAt = new Map<string, number>();
let sentCount = 0;

/** 테스트·디버그 전용 — 억제 상태를 비운다. 화면 코드에서 부르지 않는다. */
export function resetSentryNoiseFilter(): void {
  lastSentAt.clear();
  sentCount = 0;
}

/**
 * 같은 에러인지 판정할 열쇠.
 *
 * Sentry 서버도 이벤트를 이슈로 묶어 주지만, **묶여도 이벤트 수는 쿼터를 그대로 깎는다.**
 * 그래서 보내기 전에 앱에서 먼저 센다. 예외 종류·메시지에 더해 **우리 코드의 첫 프레임**을
 * 넣는 이유는, 같은 메시지라도 다른 화면에서 터진 것은 다른 문제이기 때문이다.
 */
function signatureOf(event: ErrorEvent): string {
  const first = event.exception?.values?.[0];
  const frame = first?.stacktrace?.frames?.filter((f) => f.in_app).pop();
  return [
    first?.type ?? event.message ?? 'unknown',
    first?.value ?? '',
    frame ? `${frame.filename}:${frame.lineno}` : '',
  ].join('|');
}

/** 이벤트 안의 모든 자유 텍스트를 마스킹한다. 놓치는 자리가 없도록 한곳에 모았다. */
function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.message) event.message = scrubText(event.message);

  for (const value of event.exception?.values ?? []) {
    value.value = scrubText(value.value);
  }

  event.breadcrumbs = event.breadcrumbs?.map(scrubBreadcrumb);

  // 사용자 식별자는 **id 만** 남긴다(설계 §7 ④). setSentryUser 가 이미 id 만 넣지만,
  // SDK 통합이나 나중의 코드가 이메일을 붙일 수 있으니 나가는 길목에서 한 번 더 막는다.
  if (event.user) {
    event.user = { id: event.user.id };
  }

  if (event.request?.url) event.request.url = stripQuery(event.request.url) ?? undefined;

  return event;
}

/** 행동 기록 한 줄을 마스킹한다. http 류는 URL 의 쿼리스트링도 떼어낸다. */
function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const next: Breadcrumb = { ...crumb, message: scrubText(crumb.message) };

  if (crumb.data) {
    next.data = { ...crumb.data };
    // xhr/fetch 기록의 url. 검색어·토큰이 쿼리에 실릴 수 있다.
    if (typeof next.data.url === 'string') next.data.url = stripQuery(next.data.url);
    // console 기록의 인자 등 나머지 문자열 값.
    for (const [key, value] of Object.entries(next.data)) {
      if (key !== 'url' && typeof value === 'string') next.data[key] = scrubText(value);
    }
  }

  return next;
}

export function initSentry(): void {
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    // 개발 중 뜨는 에러까지 전부 올리면 5K 쿼터가 금방 닳는다.
    enabled: !__DEV__,
    // release 는 **일부러 적지 않는다.** 비워 두면 SDK 가 네이티브 빌드 정보로
    // `dev.ansmoon.opscompanion@1.0.0+1`(패키지@버전+빌드번호)을 채운다
    // (@sentry/react-native integrations/release.js — init 옵션이 네이티브 값보다 우선한다).
    // 빌드 때 Gradle(sentry.gradle)이 소스맵을 올리며 붙이는 --release/--dist 가 바로 그 이름이라,
    // 여기서 '1.0.0' 으로 덮어쓰면 에러와 소스맵·Release Health 의 릴리즈 이름이 서로 어긋난다.
    // 성능 추적(트랜잭션)은 **AI 분석 요청만** 보낸다(설계 §6 "AI 호출 계측").
    // tracesSampleRate 를 0 보다 크게 주면 SDK 기본 통합이 앱 시작·화면 이동 트랜잭션까지 만들어
    // 에러와 같은 쿼터를 깎는다. 그래서 비율 하나가 아니라 **이름으로 고른다** — 우리가 만든 span 은 100%,
    // 나머지는 0%. beforeSend 가 에러에 하는 일을 트랜잭션에는 이 함수가 한다.
    tracesSampler: ({ name }) => (name.startsWith(ANALYSIS_SPAN_PREFIX) ? 1 : 0),
    initialScope: { tags: { appVersion: APP_VERSION } },
    beforeSend,
    // 행동 기록은 **쌓일 때** 한 번 거른다. beforeSend 의 scrubEvent 도 같은 일을 하지만,
    // 이쪽이 먼저라 앱 메모리에 원문이 머무는 시간 자체가 없어진다. 마스킹은 멱등이라
    // 두 번 거쳐도 결과가 같다(가려진 `***` 는 어느 패턴에도 다시 걸리지 않는다).
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

/** 나가기 직전의 마지막 관문 — 억제 판정을 먼저 하고, 통과한 것만 마스킹해 내보낸다. */
function beforeSend(event: ErrorEvent): ErrorEvent | null {
  const scrubbed = scrubEvent(event);

  // 연결 확인 버튼은 "눌렀는데 안 왔다" 가 되면 확인 도구로서 쓸모가 없다. 억제에서 뺀다.
  if (scrubbed.tags?.[TEST_TAG] === 'true') return scrubbed;

  if (sentCount >= MAX_EVENTS_PER_SESSION) return null;

  const key = signatureOf(scrubbed);
  const now = Date.now();
  const previous = lastSentAt.get(key);
  if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) return null;

  lastSentAt.set(key, now);
  sentCount += 1;
  return scrubbed;
}

/** AI 분석 span 의 이름 접두어. tracesSampler 가 이 이름만 통과시킨다 */
const ANALYSIS_SPAN_PREFIX = 'ops.analysis';

/**
 * AI 분석 요청 한 번을 Sentry span 으로 감싼다(설계 §6 "AI 호출 계측").
 *
 * span = "이 구간이 얼마나 걸렸고 어떻게 끝났나"를 기록하는 단위다. 에러 이벤트가 "터졌다"만 남긴다면
 * span 은 "느렸다"를 남긴다. AI 응답은 몇 초씩 걸리고 실패 방식도 여러 가지(스키마 위반·429·타임아웃)라,
 * 지연과 결과를 같은 자리에서 봐야 "AI 를 관측한다"고 말할 수 있다.
 *
 * 속성에는 식별자와 상태만 싣는다. 원문·프롬프트는 싣지 않는다 — span 속성은 beforeSend 를 거치지 않는다.
 * Sentry 가 꺼져 있으면(DSN 없음·개발 모드) startSpan 은 콜백만 실행하고 아무것도 보내지 않는다.
 */
export function traceAnalysisRequest<T>(
  incidentId: string,
  force: boolean,
  run: (setStatus: (status: string) => void) => Promise<T>,
): Promise<T> {
  return Sentry.startSpan(
    {
      name: `${ANALYSIS_SPAN_PREFIX}.request`,
      op: 'http.client',
      attributes: { 'ops.incident_id': incidentId, 'ops.force': force },
    },
    async (span) => {
      try {
        return await run((status) => span.setAttribute('ops.analysis.status', status));
      } catch (error) {
        // HTTP 상태만 남긴다(429·409·503 을 구분해 보려고). 메시지는 싣지 않는다.
        const status = (error as { response?: { status?: number } })?.response?.status;
        span.setAttribute('ops.analysis.status', status ? `http_${status}` : 'network_error');
        throw error;
      }
    },
  );
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
  // 메시지에 시각을 넣지 않는다 — 넣으면 누를 때마다 **다른 이슈**가 생겨 쿼터를 쪼갠다.
  // 누른 시각은 이슈 안에서 보면 되므로 extra 로 내린다.
  return Sentry.captureException(new Error('[ops-companion] Sentry 연결 테스트'), {
    tags: { [TEST_TAG]: 'true' },
    extra: { pressedAt: new Date().toISOString() },
  });
}
