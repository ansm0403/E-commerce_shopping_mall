import { queryOptions } from '@tanstack/react-query';
import { getMyCart } from '../../service/cart';

/**
 * 장바구니 쿼리 키
 *
 * cartKeys.all    → ['cart']        invalidateQueries 시 장바구니 관련 전체 무효화
 * cartKeys.myCart → ['cart', 'my']  내 장바구니 조회 쿼리 키
 *
 * React Query는 prefix 매칭을 사용하므로
 * invalidateQueries({ queryKey: cartKeys.all }) 하면
 * ['cart']로 시작하는 모든 쿼리가 자동으로 무효화됩니다.
 */
export const cartKeys = {
  all: ['cart'] as const,
  myCart: ['cart', 'my'] as const,
};

export const cartQueryOptions = {
  myCart: (enabled = true) =>
    queryOptions({
      queryKey: cartKeys.myCart,
      queryFn: ({signal}) => getMyCart(signal),
      staleTime: 1000 * 60 * 5, // 5분간 캐시 유지 (뮤테이션 성공 시 invalidation으로 갱신)
      enabled,
    }),
};
