import * as Sentry from '@sentry/nextjs';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { reportApiError } from './report-api-error';

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
  beforeEach(() => capture.mockClear());

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
});
