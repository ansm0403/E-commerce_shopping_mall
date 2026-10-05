import { renderHook } from '@testing-library/react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';
import { useRequireAuth } from './useRequireAuth';

/**
 * 로그인 가드의 판정 시점 (05-buyer-flow-complete §3 F5).
 *
 * 인증 상태는 셋이다 — 모름(확인 중) · 있음 · 없음. 예전 판정(`isHydrated && !user`)은 "모름"을 "없음"으로 읽어
 * 로그인한 사용자가 새로고침만 해도 로그인 화면으로 튕겼다. 여기서 고정하는 것은 **"모름"일 때는 움직이지 않는다**이다.
 */
jest.mock('next/navigation', () => ({ useRouter: jest.fn(), usePathname: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));

const mockedAuth = useAuth as jest.Mock;
const replace = jest.fn();

const auth = (state: { user?: object | null; isHydrated?: boolean; isLoading?: boolean }) =>
  mockedAuth.mockReturnValue({ user: null, isHydrated: true, isLoading: false, ...state });

describe('useRequireAuth', () => {
  beforeEach(() => {
    replace.mockReset();
    (useRouter as jest.Mock).mockReturnValue({ replace });
    (usePathname as jest.Mock).mockReturnValue('/my/orders');
    window.history.replaceState(null, '', '/my/orders');
  });

  it('하이드레이션 전에는 이동하지 않는다', () => {
    auth({ isHydrated: false });
    const { result } = renderHook(() => useRequireAuth());

    expect(replace).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ isChecking: true, isLoggedIn: false });
  });

  it('`/auth/me` 응답을 기다리는 동안에는 이동하지 않는다(새로고침 직후 — user 는 아직 없다)', () => {
    auth({ isHydrated: true, isLoading: true, user: null });
    const { result } = renderHook(() => useRequireAuth());

    expect(replace).not.toHaveBeenCalled();
    expect(result.current.isChecking).toBe(true);
  });

  it('응답이 와서 로그인 상태면 그대로 둔다', () => {
    auth({ user: { id: 1 } });
    const { result } = renderHook(() => useRequireAuth());

    expect(replace).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ isChecking: false, isLoggedIn: true });
  });

  it('응답이 와서 비로그인이 확정되면 돌아올 경로를 실어 로그인으로 보낸다', () => {
    auth({ user: null });
    renderHook(() => useRequireAuth());

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/login?redirect=%2Fmy%2Forders');
  });

  it('쿼리스트링까지 되돌린다(결제 완료 화면의 주문번호)', () => {
    (usePathname as jest.Mock).mockReturnValue('/checkout/complete');
    window.history.replaceState(null, '', '/checkout/complete?orderNumber=A-1');
    auth({ user: null });
    renderHook(() => useRequireAuth());

    expect(replace).toHaveBeenCalledWith('/login?redirect=%2Fcheckout%2Fcomplete%3ForderNumber%3DA-1');
  });

  it('확인 중 → 비로그인 확정으로 바뀌는 순간에 한 번 이동한다', () => {
    auth({ isLoading: true });
    const { rerender } = renderHook(() => useRequireAuth());
    expect(replace).not.toHaveBeenCalled();

    auth({ isLoading: false, user: null });
    rerender();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('확인 중 → 로그인 확정이면 끝까지 이동하지 않는다', () => {
    auth({ isLoading: true });
    const { rerender } = renderHook(() => useRequireAuth());

    auth({ isLoading: false, user: { id: 1 } });
    rerender();
    expect(replace).not.toHaveBeenCalled();
  });
});
