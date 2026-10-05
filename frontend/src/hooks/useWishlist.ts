'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { clearWishlist, toggleWishlist } from '@/service/wishlist';
import { authStorage } from '@/service/auth-storage';
import { useAuth } from '@/contexts/AuthContext';
import { hasRole } from '@/lib/roles';
import {
  applyWishToggle,
  wishlistKeys,
  wishlistQueryOptions,
} from '@/lib/react-query/wishlist-query-options';

/**
 * 내가 찜한 상품 id 목록 — 구매자로 로그인했을 때만 조회한다(찜은 BUYER 전용, 다른 역할은 서버가 403).
 * `isWished(productId)` 로 하트 상태를 읽는다.
 */
export function useWishlistIds() {
  const { user, isHydrated, isLoading: isAuthLoading } = useAuth();
  const enabled = hasRole(user, 'buyer');
  const query = useQuery({ ...wishlistQueryOptions.ids(), enabled });
  const ids = enabled ? query.data : undefined;

  return {
    ids,
    // 로그인 여부를 아직 모르는 동안도 "받는 중"이다 — 그 사이에 누르면 찜 여부를 모른 채 토글하게 된다
    isLoading: !isHydrated || isAuthLoading || (enabled && query.isLoading),
    isWished: (productId: number) => !!ids?.includes(productId),
  };
}

/**
 * 위시리스트 토글 mutation hook — 낙관적 갱신.
 *
 *   onMutate  : (로그인 확인 후) ids 캐시를 먼저 뒤집는다 → 하트가 응답을 기다리지 않고 바뀐다
 *   onError   : 뒤집기 전 값으로 되돌린다
 *   onSuccess : 서버가 알려 준 action 으로 최종 상태를 **확정**한다(서버가 진실 — 낙관값과 어긋나도 서버를 따른다)
 *   onSettled : 목록(list)은 무효화해 다시 받는다
 *
 * 연타 경쟁: 진행 중에는 버튼을 비활성(`isPending`)해 토글 요청이 겹치지 않게 한다.
 * ids 캐시가 아직 없으면(조회 전) 낙관적 갱신은 건너뛰고 onSuccess 에서만 반영한다 — 모르는 상태를 뒤집을 수는 없다.
 */
export function useWishlistToggle() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (productId: number) => toggleWishlist(productId),

    onMutate: async (productId) => {
      // 요청 직전: 로그인 상태 확인
      if (!authStorage.getAccessToken()) {
        router.push('/login');
        throw new Error('로그인이 필요합니다.');
      }

      // 진행 중인 ids 조회가 낙관값을 덮어쓰지 않게 멈춘다
      await queryClient.cancelQueries({ queryKey: wishlistKeys.ids() });
      const previous = queryClient.getQueryData<number[]>(wishlistKeys.ids());
      if (previous) {
        queryClient.setQueryData(
          wishlistKeys.ids(),
          applyWishToggle(previous, productId, !previous.includes(productId)),
        );
      }
      return { previous };
    },

    onError: (error: any, _productId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(wishlistKeys.ids(), context.previous);
      }
      if (error?.message === '로그인이 필요합니다.') return;

      const message = error?.response?.data?.message ?? '오류가 발생했습니다. 다시 시도해주세요.';
      alert(message);
    },

    onSuccess: (res) => {
      const { action, productId } = res.data;
      queryClient.setQueryData<number[]>(wishlistKeys.ids(), (current) =>
        applyWishToggle(current ?? [], productId, action === 'added'),
      );
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: wishlistKeys.lists() });
    },
  });
}

/** 전체 비우기 — 성공하면 ids 를 비우고 목록을 다시 받는다 */
export function useClearWishlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => clearWishlist().then((res) => res.data),
    onSuccess: () => {
      queryClient.setQueryData<number[]>(wishlistKeys.ids(), []);
      queryClient.invalidateQueries({ queryKey: wishlistKeys.lists() });
    },
  });
}
