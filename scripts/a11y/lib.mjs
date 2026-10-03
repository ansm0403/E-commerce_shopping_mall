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

/**
 * --admin 모드 로그인 — 로그인 화면의 데모 관리자 버튼(비밀번호 없음, 백엔드 DEMO_LOGIN_ENABLED=true 필요).
 * 관리자 화면은 AdminGuard 가 /auth/me 응답을 기다리므로 이후 주소 직접 진입이 가능하다(구매자 화면과 다름).
 */
export async function loginAsDemoAdmin(page, base) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /관리자 페이지 체험하기/ }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/admin/dashboard', { timeout: 15000 });
}

/** --admin 모드에서 재는 페이지(주소 직접 진입) */
export const ADMIN_PAGES = [{ name: 'AI 어시스턴트', path: '/admin/assistant' }];

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
