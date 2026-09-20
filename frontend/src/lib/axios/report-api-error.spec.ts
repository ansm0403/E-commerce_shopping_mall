import * as Sentry from '@sentry/nextjs';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { reportApiError, resetApiErrorDedupe } from './report-api-error';

jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));
const capture = Sentry.captureException as jest.Mock;

const config = (url = '/products?page=2&sort=new', method = 'get'): InternalAxiosRequestConfig => ({
  url,
  method,
  timeout: 5000,
  headers: new AxiosHeaders(),
});

/** 응답이 있는 실패(status) 또는 응답이 없는 실패(code) 를 만든다. */
function axiosError(opts: { status?: number; code?: string; url?: string }): AxiosError {
  const cfg = config(opts.url);
  const response = opts.status
    ? { status: opts.status, statusText: '', headers: {}, config: cfg, data: {} }
    : undefined;
  return new AxiosError('fail', opts.code, cfg, undefined, response);
}

describe('reportApiError', () => {
  beforeEach(() => {
    capture.mockClear();
    resetApiErrorDedupe();
  });

  it('응답이 없는 네트워크 실패는 보낸다 — 백엔드가 죽은 상황', () => {
    reportApiError(axiosError({ code: 'ERR_NETWORK' }), 'public');

    expect(capture).toHaveBeenCalledTimes(1);
    const [, ctx] = capture.mock.calls[0];
    // 쿼리스트링은 fingerprint 에서 빠진다 — 페이지마다 이슈가 갈라지지 않게
    expect(ctx.fingerprint).toEqual(['api', 'public', 'GET', '/products', 'ERR_NETWORK']);
    expect(ctx.contexts.api.fullUrl).toBe('/products?page=2&sort=new');
  });

  it('5xx 는 보낸다', () => {
    reportApiError(axiosError({ status: 503 }), 'auth');

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][1].tags['api.status']).toBe('503');
  });

  it.each([400, 401, 403, 404, 429])('%i 는 설계된 흐름이라 보내지 않는다', (status) => {
    reportApiError(axiosError({ status }), 'auth');
    expect(capture).not.toHaveBeenCalled();
  });

  it('취소된 요청은 보내지 않는다', () => {
    reportApiError(axiosError({ code: 'ERR_CANCELED' }), 'public');
    expect(capture).not.toHaveBeenCalled();
  });

  it('axios 에러가 아니면 보내지 않는다 — 로그아웃 중 요청 차단 Error 등', () => {
    reportApiError(new Error('Logging out...'), 'auth');
    expect(capture).not.toHaveBeenCalled();
  });

  describe('중복 억제 — 월 5,000건 쿼터 방어(2026-09-20 실측: 다운 1회 재현 = 16건)', () => {
    afterEach(() => jest.useRealTimers());

    it('같은 실패의 연타는 60초에 1건만 보낸다', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-20T12:00:00Z'));

      for (let i = 0; i < 8; i += 1) {
        reportApiError(axiosError({ code: 'ERR_NETWORK', url: '/products?page=1' }), 'public');
      }
      expect(capture).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(59_000);
      reportApiError(axiosError({ code: 'ERR_NETWORK', url: '/products?page=1' }), 'public');
      expect(capture).toHaveBeenCalledTimes(1);

      // 창이 지나면 다시 보낸다 — 장애가 계속되고 있다는 사실 자체는 알려야 한다
      jest.advanceTimersByTime(2_000);
      reportApiError(axiosError({ code: 'ERR_NETWORK', url: '/products?page=1' }), 'public');
      expect(capture).toHaveBeenCalledTimes(2);
    });

    it('다른 엔드포인트·상태는 각각 1건씩 나간다 — 첫 화면 16건이 2건으로 줄어든다', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-20T12:00:00Z'));

      // 백엔드 다운 재현과 같은 패턴: 두 엔드포인트가 재시도까지 하며 반복 실패
      for (let i = 0; i < 8; i += 1) {
        reportApiError(axiosError({ code: 'ERR_NETWORK', url: '/products?page=1&take=8' }), 'public');
        reportApiError(axiosError({ code: 'ERR_NETWORK', url: '/categories' }), 'public');
      }

      expect(capture).toHaveBeenCalledTimes(2);
      expect(capture.mock.calls.map((c) => c[1].fingerprint[3])).toEqual(['/products', '/categories']);
    });

    it('새 이슈의 첫 이벤트는 절대 버리지 않는다 — RN 앱 푸시가 이 이벤트에 걸려 있다', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-20T12:00:00Z'));

      reportApiError(axiosError({ code: 'ERR_NETWORK', url: '/products' }), 'public');
      capture.mockClear();

      // 같은 창 안이지만 처음 보는 조합(경로·상태·클라이언트가 다름)이면 즉시 보낸다
      reportApiError(axiosError({ status: 500, url: '/products' }), 'public');
      reportApiError(axiosError({ code: 'ERR_NETWORK', url: '/orders' }), 'public');
      reportApiError(axiosError({ code: 'ERR_NETWORK', url: '/products' }), 'auth');
      expect(capture).toHaveBeenCalledTimes(3);
    });

    it('탭당 10건을 넘기면 더 보내지 않는다(장애 장기화 상한)', () => {
      for (let i = 0; i < 15; i += 1) {
        reportApiError(axiosError({ code: 'ERR_NETWORK', url: `/p${i}` }), 'public');
      }
      expect(capture).toHaveBeenCalledTimes(10);
    });
  });
});
