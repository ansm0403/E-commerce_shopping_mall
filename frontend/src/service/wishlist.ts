import { authClient } from '../lib/axios/axios-http-client';

/**
 * 위시리스트 토글 (추가 ↔ 제거 자동 전환)
 * - 이미 찜한 상품이면 제거, 아니면 추가 (백엔드가 처리)
 * - response: { action: 'added' | 'removed', productId: number }
 * - authClient 사용: JWT 토큰 자동 첨부 (BUYER 권한 필요)
 */
export function toggleWishlist(productId: number) {
  return authClient.post<{ action: 'added' | 'removed'; productId: number }>(
    '/wishlist/toggle',
    { productId },
  );
}
