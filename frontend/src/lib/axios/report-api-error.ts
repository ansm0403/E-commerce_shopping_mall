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
 */
export type ApiClientName = 'public' | 'auth';

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
