/** a11y 측정 스크립트 공용 — 측정 계정 API 토큰 · 장바구니 1개 보장(주문서는 빈 장바구니면 /cart 로 튕긴다) */
export async function apiAuth(api, email, password) {
  const res = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`API 로그인 실패 ${res.status}`);
  const { accessToken } = await res.json();
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

export async function cartItems(api, auth) {
  const cart = await (await fetch(`${api}/cart`, { headers: auth })).json();
  return cart.items ?? cart.data?.items ?? [];
}

export async function ensureCartItem(api, auth, productId) {
  if ((await cartItems(api, auth)).length > 0) return;
  const add = await fetch(`${api}/cart/items`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ productId: Number(productId), quantity: 1 }),
  });
  if (!add.ok) throw new Error(`장바구니 담기 실패 ${add.status} ${await add.text()}`);
}
