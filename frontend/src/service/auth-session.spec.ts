import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { AccountMutationCache } from '../lib/react-query/account-mutation-cache';
import { clearAccountQueries } from '../lib/react-query/clear-account-queries';
import {
  advanceAuthRevision,
  authRevision,
  withSessionLock,
} from './auth-session';
import { authStorage } from './auth-storage';
import {
  authClient,
  publicClient,
  refreshAccessToken,
  resetLoggingOutFlag,
} from '../lib/axios/axios-http-client';
import { demoLogin, logout } from './auth';
import * as queryClients from '../lib/react-query/get-query-client';

jest.mock('./auth-channel', () => ({ getAuthChannel: () => null }));
jest.mock('../lib/react-query/get-query-client', () => ({
  getQueryClient: jest.fn(),
}));
jest.mock('../lib/axios/report-api-error', () => ({
  reportApiError: jest.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Account transitions', () => {
  let client: QueryClient;
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetLoggingOutFlag();
    client = new QueryClient({ mutationCache: new AccountMutationCache() });
    jest.mocked(queryClients.getQueryClient).mockReturnValue(client);
  });
  afterEach(() => {
    client.clear();
    jest.restoreAllMocks();
  });

  it('never reads or shares an old tab token after another tab changes account', () => {
    authStorage.setAccessToken('buyer-token', false);
    expect(authStorage.getAccessToken()).toBe('buyer-token');
    advanceAuthRevision();
    expect(authStorage.getAccessToken()).toBeNull();
    authStorage.setTokenFromBroadcast('seller-token');
    expect(authStorage.getAccessToken()).toBe('seller-token');
  });

  it('clears orders, cart, roles and private product queries while keeping the public catalog', async () => {
    const privateKeys = [
      ['auth', 'me'],
      ['orders'],
      ['cart'],
      ['products', 'my'],
      ['inquiries', 'product', 1],
      ['seller', 'dashboard'],
    ];
    const publicKeys = [
      ['products', 'detail', 1],
      ['paginate', 'products', 1],
      ['categories', 'tree'],
    ];
    for (const key of [...privateKeys, ...publicKeys])
      client.setQueryData(key, 'data');
    await clearAccountQueries(client);
    for (const key of privateKeys)
      expect(client.getQueryData(key)).toBeUndefined();
    for (const key of publicKeys) expect(client.getQueryData(key)).toBe('data');
  });

  it('does not remove the next account data when an old cleanup finishes late', async () => {
    const gate = deferred<void>();
    jest.spyOn(client, 'cancelQueries').mockReturnValue(gate.promise);
    const cleanup = clearAccountQueries(client);
    advanceAuthRevision();
    client.setQueryData(['orders'], 'new seller orders');
    gate.resolve();
    await cleanup;
    expect(client.getQueryData(['orders'])).toBe('new seller orders');
  });

  it('ignores late mutation callbacks even if React updates its options while pending', async () => {
    const reply = deferred<string>();
    const started = deferred<void>();
    const update = jest.fn();
    const alert = jest.fn();
    const observer = new MutationObserver(client, {
      mutationFn: () => {
        started.resolve();
        return reply.promise;
      },
      onSuccess: update,
      onSettled: update,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const result = observer.mutate(undefined, {
      onSuccess: alert,
      onSettled: alert,
    });
    await started.promise;
    advanceAuthRevision();
    observer.setOptions({
      mutationFn: () => reply.promise,
      onSuccess: update,
      onSettled: update,
    });
    reply.resolve('old buyer result');
    await result;
    expect(update).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(observer.getCurrentResult().isPending).toBe(false);
    unsubscribe();
  });

  it('keeps callbacks for changes completed within the same account', async () => {
    const update = jest.fn();
    await client
      .getMutationCache()
      .build(client, { mutationFn: async () => 'done', onSuccess: update })
      .execute(undefined);
    expect(update).toHaveBeenCalled();
  });

  it('serializes delayed refresh, logout and the next login including cookie writes', async () => {
    let queue: Promise<unknown> = Promise.resolve();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: jest.fn((_name, action) => {
          const next = queue.then(action);
          queue = next.catch(() => undefined);
          return next;
        }),
      },
    });
    const reply = deferred<{ data: { accessToken: string } }>();
    const paths: string[] = [];
    jest.spyOn(publicClient, 'post').mockImplementation(async (path) => {
      paths.push(path);
      if (path === '/auth/refresh') return reply.promise as never;
      if (path === '/auth/demo-login')
        return {
          data: { accessToken: 'seller-token', user: { id: 2 } },
        } as never;
      return { data: {} } as never;
    });
    authStorage.setAccessToken('buyer-token', false);
    const refresh = refreshAccessToken();
    await Promise.resolve();
    await Promise.resolve();
    const exit = logout();
    const login = demoLogin('seller');
    expect(paths).toEqual(['/auth/refresh']);
    reply.resolve({ data: { accessToken: 'refreshed-buyer' } });
    await Promise.all([refresh, exit, login]);
    expect(paths).toEqual([
      '/auth/refresh',
      '/auth/logout',
      '/auth/demo-login',
    ]);
    expect(authStorage.getAccessToken()).toBe('seller-token');
    expect(client.getQueryData(['auth', 'user'])).toEqual({ id: 2 });
    expect(authRevision()).not.toBe('initial');
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
  });

  it('queues cookie changes in a single tab when Web Locks is unavailable', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
    const gate = deferred<void>();
    const actions: string[] = [];
    const first = withSessionLock(async () => {
      actions.push('first');
      await gate.promise;
    });
    const second = withSessionLock(async () => {
      actions.push('second');
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(actions).toEqual(['first']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(actions).toEqual(['first', 'second']);
  });

  it('keeps a failed server logout pending and finishes it before another role login', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
    authStorage.setAccessToken('buyer-token', false);
    const post = jest
      .spyOn(publicClient, 'post')
      .mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(logout()).rejects.toThrow('Network unavailable');
    expect(authStorage.getAccessToken()).toBeNull();
    expect(authStorage.isLogoutPending()).toBe(true);
    expect(await refreshAccessToken()).toBeNull();
    post.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({
      data: { accessToken: 'seller-token', user: { id: 2 } },
    });
    await demoLogin('seller');
    expect(post.mock.calls.map((call) => call[0])).toEqual([
      '/auth/logout',
      '/auth/logout',
      '/auth/demo-login',
    ]);
    expect(authStorage.isLogoutPending()).toBe(false);
    expect(authStorage.getAccessToken()).toBe('seller-token');
  });
  it('finishes a pending cookie session after reloading before issuing the next role login', async () => {
    authStorage.markLogoutPending(true);
    const post = jest
      .spyOn(publicClient, 'post')
      .mockResolvedValueOnce({ data: { accessToken: 'previous-session' } })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { accessToken: 'seller-token', user: { id: 2 } },
      });
    await demoLogin('seller');
    expect(post.mock.calls.map((call) => call[0])).toEqual([
      '/auth/refresh',
      '/auth/logout',
      '/auth/demo-login',
    ]);
    expect(authStorage.getAccessToken()).toBe('seller-token');
  });
  it('cancels an outstanding private API even when its service omitted a query signal', async () => {
    authStorage.setAccessToken('buyer-token', false);
    const started = deferred<void>();
    const reply = deferred<void>();
    const request = authClient.get('/orders', {
      adapter: async (config) => {
        started.resolve();
        await reply.promise;
        return {
          data: 'old private data',
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });
    await started.promise;
    advanceAuthRevision();
    await clearAccountQueries(client);
    reply.resolve();
    await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  });

  it('does not execute an old account mutation after its asynchronous preparation finishes', async () => {
    const started = deferred<void>();
    const gate = deferred<void>();
    const write = jest.fn(async () => 'saved');
    const callback = jest.fn();
    const mutation = client.getMutationCache().build(client, {
      mutationFn: write,
      onMutate: async () => {
        started.resolve();
        await gate.promise;
      },
      onError: callback,
      onSettled: callback,
    });
    const result = mutation.execute(undefined);
    await started.promise;
    advanceAuthRevision();
    gate.resolve();
    await expect(result).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(write).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('aborts private requests with a caller signal when AbortSignal.any is unavailable', async () => {
    const any = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
    Object.defineProperty(AbortSignal, 'any', {
      configurable: true,
      value: undefined,
    });
    authStorage.setAccessToken('buyer-token', false);
    const started = deferred<AbortSignal>();
    const reply = deferred<void>();
    const request = authClient.get('/orders', {
      signal: new AbortController().signal,
      adapter: async (config) => {
        started.resolve(config.signal as AbortSignal);
        await reply.promise;
        return {
          data: 'old data',
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      },
    });
    const rejection = expect(request).rejects.toMatchObject({
      code: 'ERR_CANCELED',
    });
    try {
      const signal = await started.promise;
      await clearAccountQueries(client);
      expect(signal.aborted).toBe(true);
    } finally {
      reply.resolve();
      await rejection;
      if (any) Object.defineProperty(AbortSignal, 'any', any);
      else delete (AbortSignal as { any?: unknown }).any;
    }
  });

  it('forgets a failed logout from an old tab after another tab finishes it and logs in', async () => {
    authStorage.setAccessToken('buyer-token', false);
    const post = jest
      .spyOn(publicClient, 'post')
      .mockRejectedValueOnce(new Error('Offline'));
    await expect(logout()).rejects.toThrow('Offline');
    // Shared storage changes made by the other tab after its successful retry.
    authStorage.markLogoutPending(false);
    authStorage.setAccessToken('seller-token', false);
    post.mockImplementation(async (path) =>
      path === '/auth/demo-login'
        ? ({ data: { accessToken: 'admin-token', user: { id: 3 } } } as never)
        : ({ data: {} } as never)
    );
    await demoLogin('admin');
    expect(post.mock.calls.slice(1).map((call) => call[0])).toEqual([
      '/auth/demo-login',
    ]);
    expect(authStorage.getAccessToken()).toBe('admin-token');
  });

  it.each([503, 429, 'network'])(
    'keeps the current session on a temporary refresh failure (%s) and allows a later retry',
    async (failure) => {
      authStorage.setAccessToken('buyer-token', false);
      const revision = authRevision();
      const error =
        failure === 'network'
          ? new Error('Network unavailable')
          : { response: { status: failure } };
      const post = jest
        .spyOn(publicClient, 'post')
        .mockRejectedValueOnce(error);
      await expect(refreshAccessToken()).rejects.toBe(error);
      expect(authRevision()).toBe(revision);
      expect(authStorage.getAccessToken()).toBe('buyer-token');
      post.mockResolvedValueOnce({ data: { accessToken: 'refreshed-buyer' } });
      await expect(refreshAccessToken()).resolves.toBe('refreshed-buyer');
      expect(authStorage.getAccessToken()).toBe('refreshed-buyer');
    }
  );

  it('still clears an expired cookie session on refresh 401 and stops retrying', async () => {
    // jsdom reports navigation as unsupported; this test verifies session state.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    authStorage.setAccessToken('buyer-token', false);
    const revision = authRevision();
    const post = jest
      .spyOn(publicClient, 'post')
      .mockRejectedValueOnce({ response: { status: 401 } });
    await expect(refreshAccessToken()).resolves.toBeNull();
    expect(authStorage.getAccessToken()).toBeNull();
    expect(authRevision()).not.toBe(revision);
    await expect(refreshAccessToken()).resolves.toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('preserves caller cancellation across a 401 refresh retry without AbortSignal.any', async () => {
    const any = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
    Object.defineProperty(AbortSignal, 'any', {
      configurable: true,
      value: undefined,
    });
    const refreshing = deferred<void>();
    const reply = deferred<{ data: { accessToken: string } }>();
    jest.spyOn(publicClient, 'post').mockImplementation(async () => {
      refreshing.resolve();
      return reply.promise as never;
    });
    const caller = new AbortController();
    const adapter = jest.fn(async (config) => {
      if (!config._retry)
        throw new AxiosError('Unauthorized', undefined, config, undefined, {
          data: {},
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config,
        });
      return {
        data: 'response',
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    });
    const request = authClient.get('/orders', {
      signal: caller.signal,
      adapter,
    });
    const rejection = expect(request).rejects.toMatchObject({
      code: 'ERR_CANCELED',
    });
    try {
      await refreshing.promise;
      caller.abort();
      reply.resolve({ data: { accessToken: 'refreshed-buyer' } });
      await rejection;
      expect(adapter).toHaveBeenCalledTimes(1);
    } finally {
      if (any) Object.defineProperty(AbortSignal, 'any', any);
      else delete (AbortSignal as { any?: unknown }).any;
    }
  });
});
