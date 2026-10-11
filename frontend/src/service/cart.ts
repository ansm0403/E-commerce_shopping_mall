import { authClient } from '../lib/axios/axios-http-client';

export function getMyCart(signal?: AbortSignal) {
  return authClient.get('/cart',{signal});
}

/**
 * 장바구니에 상품 추가
 * - 이미 담긴 상품이면 수량이 합산됨 (백엔드 로직)
 */
export function addCartItem(productId: number, quantity: number) {
  return authClient.post('/cart/items', { productId, quantity });
}

export function updateCartItem(itemId: number, quantity: number) {
  return authClient.patch(`/cart/items/${itemId}`, { quantity });
}

export function removeCartItem(itemId: number) {
  return authClient.delete(`/cart/items/${itemId}`);
}

export function clearCart() {
  return authClient.delete('/cart');
}
