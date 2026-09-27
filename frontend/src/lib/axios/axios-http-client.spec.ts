import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

/**
 * authClient 401 인터셉터 — "동시 401 → refresh 1회 + 큐 재시도" (PROJECT_CARD 트러블슈팅 ①).
 *
 * 네트워크 대신 axios **어댑터**를 갈아 끼운다. 인터셉터·헤더 조립·재시도는 전부 진짜 axios 가 돌고,
 * 어댑터만 "서버가 이렇게 답했다"를 연기한다. 그래서 단언 대상은 어댑터가 받은 요청(URL·Authorization)이다.
 *
 * 모듈 전역 상태(isRefreshing·isLoggingOut)가 있어 케이스마다 모듈을 새로 읽는다(jest.resetModules).
 */

jest.mock('./report-api-error', () => ({ reportApiError: jest.fn() }));
// authStorage 가 탭 간 동기화용 BroadcastChannel 을 연다 — jsdom 엔 없으므로 막는다
jest.mock('../../service/auth-channel', () => ({ getAuthChannel: () => null, closeAuthChannel: () => undefined }));

type Client = typeof import('./axios-http-client');

const ok = (config: InternalAxiosRequestConfig, data: unknown): AxiosResponse => ({
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
  data,
});

const unauthorized = (config: InternalAxiosRequestConfig) =>
  new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
    data: { statusCode: 401, message: 'jwt expired' },
  });

const authHeader = (config: InternalAxiosRequestConfig) =>
  AxiosHeaders.from(config.headers).get('Authorization') as string | undefined;

/** 마이크로태스크·setTimeout(0) 까지 비운다 — 인터셉터 체인이 끝까지 돌 시간 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 모듈을 새로 읽고, 두 클라이언트의 어댑터를 mock 으로 바꾼다 */
async function loadClient() {
  jest.resetModules();
  const mod: Client = await import('./axios-http-client');
  const authAdapter = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>();
  const publicAdapter = jest.fn<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>();
  mod.authClient.defaults.adapter = authAdapter;
  mod.publicClient.defaults.adapter = publicAdapter;
  return { ...mod, authAdapter, publicAdapter };
}

describe('authClient 401 인터셉터', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem('accessToken', 'old-token');
    // 인터셉터의 "[Auth API] 요청 전" 로그와 jsdom 의 "Not implemented: navigation" 을 가린다
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('동시 401 두 건 → /auth/refresh 는 1번만 나가고, 둘 다 새 토큰으로 재시도된다', async () => {
    const { authClient, authAdapter, publicAdapter } = await loadClient();

    // 낡은 토큰이면 401, 새 토큰이면 200 — "재시도가 새 토큰을 들고 왔는지"를 서버 입장에서 판정
    authAdapter.mockImplementation((config) =>
      authHeader(config) === 'Bearer new-token'
        ? Promise.resolve(ok(config, { url: config.url }))
        : Promise.reject(unauthorized(config)),
    );

    // refresh 응답을 손에 쥔다 — 두 번째 401 이 도착할 때까지 첫 refresh 가 "진행 중"이어야 큐가 생긴다
    let releaseRefresh: (() => void) | undefined;
    publicAdapter.mockImplementation(
      (config) =>
        new Promise((resolve) => {
          releaseRefresh = () => resolve(ok(config, { accessToken: 'new-token' }));
        }),
    );

    const first = authClient.get('/orders');
    const second = authClient.get('/cart');
    await flush();

    // 두 요청 모두 401 을 받았지만 refresh 는 아직 1건만 열려 있다
    expect(authAdapter).toHaveBeenCalledTimes(2);
    expect(publicAdapter).toHaveBeenCalledTimes(1);
    expect(publicAdapter.mock.calls[0][0].url).toBe('/auth/refresh');

    releaseRefresh?.();
    const [r1, r2] = await Promise.all([first, second]);

    expect(r1.data).toEqual({ url: '/orders' });
    expect(r2.data).toEqual({ url: '/cart' });
    // 원 요청 2 + 재시도 2 = 4, refresh 는 여전히 1
    expect(authAdapter).toHaveBeenCalledTimes(4);
    expect(publicAdapter).toHaveBeenCalledTimes(1);

    const retried = authAdapter.mock.calls.slice(2).map(([config]) => [config.url, authHeader(config)]);
    expect(retried).toEqual(
      expect.arrayContaining([
        ['/orders', 'Bearer new-token'],
        ['/cart', 'Bearer new-token'],
      ]),
    );
    // 새 토큰은 원래 저장 위치(sessionStorage = rememberMe 아님)에 들어갔다
    expect(sessionStorage.getItem('accessToken')).toBe('new-token');
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('refresh 까지 401 이면 토큰을 지우고 로그아웃 절차 — 이후 요청은 서버에 닿기 전에 차단된다', async () => {
    const { authClient, authAdapter, publicAdapter, resetLoggingOutFlag } = await loadClient();
    authAdapter.mockImplementation((config) => Promise.reject(unauthorized(config)));
    publicAdapter.mockImplementation((config) => Promise.reject(unauthorized(config)));

    // 원 요청은 자신의 401 로 실패한다(refresh 실패로 덮어쓰지 않음)
    await expect(authClient.get('/orders')).rejects.toMatchObject({ response: { status: 401 } });
    expect(publicAdapter).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('accessToken')).toBeNull();

    // isLoggingOut 이 켜져 있어 다음 요청은 어댑터(네트워크)까지 가지 않는다 — 401 폭풍 방지
    authAdapter.mockClear();
    await expect(authClient.get('/cart')).rejects.toThrow('Logging out...');
    expect(authAdapter).not.toHaveBeenCalled();

    // 다시 로그인하면 플래그를 풀어 요청이 나간다
    resetLoggingOutFlag();
    sessionStorage.setItem('accessToken', 'fresh-login-token');
    authAdapter.mockImplementation((config) => Promise.resolve(ok(config, 'ok')));
    await expect(authClient.get('/cart')).resolves.toMatchObject({ data: 'ok' });
    expect(authHeader(authAdapter.mock.calls[0][0])).toBe('Bearer fresh-login-token');
  });

  it('새 토큰으로도 계속 401 이면 최대 3회 재시도 후 토큰을 지우고 포기한다(무한 루프 방지)', async () => {
    const { authClient, authAdapter, publicAdapter } = await loadClient();
    authAdapter.mockImplementation((config) => Promise.reject(unauthorized(config)));
    publicAdapter.mockImplementation((config) => Promise.resolve(ok(config, { accessToken: 'new-token' })));

    await expect(authClient.get('/orders')).rejects.toMatchObject({ response: { status: 401 } });

    // 원 요청 1 + 재시도 3 = 4, 그 사이 refresh 3
    expect(authAdapter).toHaveBeenCalledTimes(4);
    expect(publicAdapter).toHaveBeenCalledTimes(3);
    expect(sessionStorage.getItem('accessToken')).toBeNull();
  });

  it('/auth/refresh 자신의 401 은 그대로 돌려준다 — refresh 가 refresh 를 부르지 않는다', async () => {
    const { authClient, authAdapter, publicAdapter } = await loadClient();
    authAdapter.mockImplementation((config) => Promise.reject(unauthorized(config)));

    await expect(authClient.post('/auth/refresh')).rejects.toMatchObject({ response: { status: 401 } });

    expect(authAdapter).toHaveBeenCalledTimes(1);
    expect(publicAdapter).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('accessToken')).toBe('old-token');
  });

  it('401 이 아닌 실패(500)는 refresh 없이 그대로 던진다', async () => {
    const { authClient, authAdapter, publicAdapter } = await loadClient();
    authAdapter.mockImplementation((config) =>
      Promise.reject(
        new AxiosError('Server Error', 'ERR_BAD_RESPONSE', config, undefined, {
          status: 500,
          statusText: '',
          headers: {},
          config,
          data: {},
        }),
      ),
    );

    await expect(authClient.get('/orders')).rejects.toMatchObject({ response: { status: 500 } });
    expect(publicAdapter).not.toHaveBeenCalled();
  });
});
