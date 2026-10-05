import { queryOptions, keepPreviousData } from '@tanstack/react-query';
import { getWishlist, getWishlistIds } from '../../service/wishlist';

/**
 * 찜 쿼리 키.
 *   ['wishlist','ids']            — 내가 찜한 상품 id 배열. **하트가 보이는 모든 곳의 진실 원천**(상품 상세, 나중에 상품 카드)
 *   ['wishlist','list',page,take] — 위시리스트 화면의 목록
 * 토글은 ids 를 먼저(낙관적으로) 바꾸고 list 는 무효화한다(hooks/useWishlist.ts).
 */
export const wishlistKeys = {
  all: ['wishlist'] as const,
  ids: () => [...wishlistKeys.all, 'ids'] as const,
  lists: () => [...wishlistKeys.all, 'list'] as const,
  list: (page: number, take: number) => [...wishlistKeys.lists(), page, take] as const,
};

/** 순수 함수 — 토글을 캐시에 반영한 새 id 배열 */
export function applyWishToggle(ids: number[], productId: number, wished: boolean): number[] {
  const without = ids.filter((id) => id !== productId);
  return wished ? [productId, ...without] : without;
}

export const wishlistQueryOptions = {
  ids: () =>
    queryOptions({
      queryKey: wishlistKeys.ids(),
      queryFn: () => getWishlistIds().then((res) => res.data.productIds),
      staleTime: 1000 * 60,
    }),

  list: (page: number, take: number) =>
    queryOptions({
      queryKey: wishlistKeys.list(page, take),
      queryFn: () => getWishlist({ page, take }).then((res) => res.data),
      staleTime: 1000 * 30,
      placeholderData: keepPreviousData,
    }),
};
