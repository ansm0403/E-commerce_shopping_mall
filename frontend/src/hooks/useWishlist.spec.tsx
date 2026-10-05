import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toggleWishlist } from '../service/wishlist';
import { authStorage } from '../service/auth-storage';
import { wishlistKeys } from '../lib/react-query/wishlist-query-options';
import { useWishlistToggle } from './useWishlist';

/**
 * 찜 토글의 낙관적 갱신 (05-buyer-flow-complete §5·§8).
 *
 *   누르는 순간  : ids 캐시를 먼저 뒤집는다(응답을 기다리지 않는다)
 *   실패        : 뒤집기 전 값으로 되돌린다
 *   성공        : 서버가 알려 준 action 으로 확정한다 — 낙관값과 어긋나면 서버를 따른다
 *   캐시가 없음  : 모르는 상태는 뒤집지 않는다(응답이 온 뒤에만 반영)
 */
jest.mock('next/navigation', () => ({ useRouter: jest.fn() }));
jest.mock('../service/wishlist', () => ({
  ...jest.requireActual('../service/wishlist'),
  toggleWishlist: jest.fn(),
  clearWishlist: jest.fn(),
}));
jest.mock('../service/auth-storage', () => ({ authStorage: { getAccessToken: jest.fn() } }));
// 이 훅 파일은 useAuth 도 가져오지만(useWishlistIds) 토글은 쓰지 않는다 — 실제 AuthContext(axios 등)를 끌고 오지 않게 막는다
jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));

const mockedToggle = toggleWishlist as jest.Mock;
const mockedToken = authStorage.getAccessToken as jest.Mock;
const push = jest.fn();

/** 밖에서 끝내는 약속 — "응답 전" 상태를 볼 수 있게 한다 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(initialIds?: number[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (initialIds) client.setQueryData(wishlistKeys.ids(), initialIds);
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useWishlistToggle(), { wrapper });
  const ids = () => client.getQueryData<number[]>(wishlistKeys.ids());
  return { result, ids, invalidate };
}

describe('useWishlistToggle — 낙관적 갱신', () => {
  beforeEach(() => {
    mockedToggle.mockReset();
    mockedToken.mockReset().mockReturnValue('token');
    push.mockReset();
    (useRouter as jest.Mock).mockReturnValue({ push });
    window.alert = jest.fn();
  });

  it('응답이 오기 전에 캐시가 먼저 바뀐다(추가)', async () => {
    const pending = deferred<{ data: { action: 'added'; productId: number } }>();
    mockedToggle.mockReturnValue(pending.promise);
    const { result, ids } = setup([3]);

    act(() => result.current.mutate(7));
    await waitFor(() => expect(ids()).toEqual([7, 3]));
    expect(result.current.isPending).toBe(true); // 아직 응답 전

    await act(async () => pending.resolve({ data: { action: 'added', productId: 7 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids()).toEqual([7, 3]);
  });

  it('응답이 오기 전에 캐시가 먼저 바뀐다(해제)', async () => {
    const pending = deferred<{ data: { action: 'removed'; productId: number } }>();
    mockedToggle.mockReturnValue(pending.promise);
    const { result, ids } = setup([3, 7]);

    act(() => result.current.mutate(7));
    await waitFor(() => expect(ids()).toEqual([3]));

    await act(async () => pending.resolve({ data: { action: 'removed', productId: 7 } }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids()).toEqual([3]);
  });

  it('실패하면 뒤집기 전 값으로 되돌리고 서버 문구를 알린다', async () => {
    const pending = deferred<never>();
    mockedToggle.mockReturnValue(pending.promise);
    const { result, ids } = setup([3]);

    act(() => result.current.mutate(7));
    await waitFor(() => expect(ids()).toEqual([7, 3]));

    await act(async () => pending.reject({ response: { data: { message: '판매 중인 상품만 찜할 수 있습니다.' } } }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(ids()).toEqual([3]);
    expect(window.alert).toHaveBeenCalledWith('판매 중인 상품만 찜할 수 있습니다.');
  });

  it('성공하면 서버의 action 으로 확정한다 — 낙관값과 어긋나도 서버를 따른다', async () => {
    // 캐시에는 없던 상품이라 "추가"로 뒤집지만, 서버는 (다른 탭에서 이미 찜해 둬서) 해제했다고 답한다
    mockedToggle.mockResolvedValue({ data: { action: 'removed', productId: 7 } });
    const { result, ids } = setup([3]);

    act(() => result.current.mutate(7));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(ids()).toEqual([3]);
  });

  it('ids 캐시가 아직 없으면 낙관적으로 뒤집지 않고, 응답이 온 뒤에만 반영한다', async () => {
    const pending = deferred<{ data: { action: 'added'; productId: number } }>();
    mockedToggle.mockReturnValue(pending.promise);
    const { result, ids } = setup();

    act(() => result.current.mutate(7));
    await waitFor(() => expect(mockedToggle).toHaveBeenCalledWith(7));
    expect(ids()).toBeUndefined();

    await act(async () => pending.resolve({ data: { action: 'added', productId: 7 } }));
    await waitFor(() => expect(ids()).toEqual([7]));
  });

  it('끝나면(성공·실패 모두) 위시리스트 목록 캐시를 무효화한다', async () => {
    mockedToggle.mockResolvedValue({ data: { action: 'added', productId: 7 } });
    const { result, invalidate } = setup([3]);

    act(() => result.current.mutate(7));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: wishlistKeys.lists() });
  });

  it('토큰이 없으면 요청하지 않고 로그인으로 보낸다(캐시도 건드리지 않는다)', async () => {
    mockedToken.mockReturnValue(null);
    const { result, ids } = setup([3]);

    act(() => result.current.mutate(7));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(push).toHaveBeenCalledWith('/login');
    expect(mockedToggle).not.toHaveBeenCalled();
    expect(ids()).toEqual([3]);
    expect(window.alert).not.toHaveBeenCalled();
  });
});
