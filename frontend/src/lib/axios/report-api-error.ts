import * as Sentry from '@sentry/nextjs';
import axios from 'axios';

/**
 * API 실패를 Sentry 이슈로 올리는 리포터.
 *
 * 왜 필요한가: Sentry 는 "처리되지 않은" 에러만 자동으로 잡는다. axios 실패는 TanStack Query 가
 * 받아 화면의 에러 상태로 바꾸므로 **처리된 에러**가 되고, 그래서 백엔드가 통째로 죽어도 프론트
 * 인시던트는 0건이었다(docs/blog/sentry-axios-silent-failure.md — 대조군 실험 2회 재현).
 *
 * 보내는 것 : 네트워크 계층 실패(서버 부재·타임아웃·DNS) + 5xx
 * 버리는 것 : 4xx (401 만료, 403 권한, 404 없음, 400 검증 실패) — 전부 "설계된 흐름"이라
 *            이슈로 올리면 노이즈만 되고 월 5K 쿼터를 녹인다(블로그 §8)
 *            취소된 요청(페이지 이탈), axios 가 아닌 에러(예: 로그아웃 중 요청 차단)
 *
 * 중복 억제(2026-09-20): 백엔드 다운을 한 번 재현했더니 첫 화면 로드만으로 **16건**이 올라갔다
 * (/products·/categories 가 재시도까지 하며 각각 여러 번 실패). 이슈는 fingerprint 로 묶여도
 * **이벤트 수는 조직 공용 월 5,000건 쿼터를 그대로 깎는다.** 그래서 같은 fingerprint 는
 * 60초에 1건, 탭 하나당 총 10건까지만 보낸다. 무작위 샘플링을 쓰지 않은 이유는,
 * 새 이슈의 첫 이벤트가 버려지면 그 이슈를 근거로 도는 RN 앱 푸시(Phase 1)를 놓치기 때문이다.
 */
export type ApiClientName = 'public' | 'auth';

/** 같은 fingerprint 를 다시 보낼 수 있게 되는 간격 */
const DEDUPE_WINDOW_MS = 60_000;
/** 탭 하나가 살아 있는 동안 보낼 수 있는 최대 이벤트 수(장애가 길어질 때의 상한) */
const MAX_EVENTS_PER_TAB = 10;

/** fingerprint 키 → 마지막 전송 시각. 탭 단위 메모리라 새로고침하면 초기화된다. */
const lastSentAt = new Map<string, number>();
let sentCount = 0;

/** 테스트 전용 — 모듈 상태를 비운다. 운영 코드에서 부르지 않는다. */
export function resetApiErrorDedupe(): void {
  lastSentAt.clear();
  sentCount = 0;
}

/** 쿼리스트링을 떼어낸다. fingerprint 가 페이지·정렬마다 갈라지는 걸 막는다. */
function toPath(url?: string): string {
  if (!url) return 'unknown';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

export function reportApiError(error: unknown, client: ApiClientName): void {
  // 로그아웃 중 요청 인터셉터가 던지는 Error('Logging out...') 같은 것은 response 가 없어
  // 네트워크 실패처럼 보인다. axios 에러가 아니면 보고 대상이 아니다.
  if (!axios.isAxiosError(error)) return;
  if (axios.isCancel(error) || error.code === 'ERR_CANCELED') return;

  const status = error.response?.status;
  const isNetworkFailure = !error.response; // 응답 자체가 없음
  const isServerFailure = (status ?? 0) >= 500;
  if (!isNetworkFailure && !isServerFailure) return;

  const method = (error.config?.method ?? 'get').toUpperCase();
  const path = toPath(error.config?.url);
  const label = String(status ?? error.code ?? 'NETWORK');

  // 여기서부터 억제 판정. 같은 실패의 연타와 장애 장기화 두 경우를 각각 막는다.
  if (sentCount >= MAX_EVENTS_PER_TAB) return;

  const key = `${client}|${method}|${path}|${label}`;
  const now = Date.now();
  const previous = lastSentAt.get(key);
  if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) return;

  lastSentAt.set(key, now);
  sentCount += 1;

  Sentry.captureException(error, {
    // 같은 엔드포인트의 같은 실패를 한 이슈로 묶는다.
    // 안 묶으면 URL 하나하나가 별개 이슈가 되어 무료 쿼터가 순식간에 녹는다.
    fingerprint: ['api', client, method, path, label],
    level: 'error',
    tags: {
      'api.client': client,
      'api.method': method,
      'api.path': path,
      'api.status': label,
    },
    contexts: {
      api: {
        path,
        method,
        status: status ?? null,
        code: error.code ?? null, // ERR_NETWORK, ECONNABORTED ...
        timeoutMs: error.config?.timeout ?? null,
        fullUrl: error.config?.url ?? null, // 쿼리 포함 원본은 여기 남긴다
      },
    },
  });
}
