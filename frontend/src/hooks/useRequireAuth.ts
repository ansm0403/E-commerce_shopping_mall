'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

/** 로그인 뒤 돌아올 경로를 실은 로그인 주소 */
export function loginPathWithRedirect(currentPath: string): string {
  return `/login?redirect=${encodeURIComponent(currentPath)}`;
}

/**
 * 로그인이 필요한 화면의 공용 가드.
 *
 * 인증 상태는 셋이다 — "모름(확인 중)" · "있음" · "없음". 로그인으로 보내는 것은 **"없음"이 확정된 뒤**에만 한다.
 * 예전 판정(`isHydrated && !user`)은 `/auth/me` 응답 전의 "모름"을 "없음"으로 읽어,
 * 로그인한 사용자가 새로고침만 해도 로그인 화면으로 튕겼다.
 *
 * 화면 쪽은 `isChecking` 동안 스켈레톤(또는 아무것도 안 그림), `isLoggedIn` 이면 내용을 그린다.
 * UX 레이어일 뿐이다 — 최종 판정은 백엔드 가드가 한다.
 */
export function useRequireAuth() {
  const { user, isHydrated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isChecking = !isHydrated || isLoading;
  const isLoggedIn = !!user;

  useEffect(() => {
    if (isChecking || isLoggedIn) return;
    // 쿼리스트링까지 되돌린다(예: /checkout/complete?orderNumber=…).
    // useSearchParams 는 Suspense 경계를 요구하므로 이동 시점에 주소에서 직접 읽는다.
    router.replace(loginPathWithRedirect(pathname + window.location.search));
  }, [isChecking, isLoggedIn, pathname, router]);

  return { user, isLoggedIn, isChecking };
}
