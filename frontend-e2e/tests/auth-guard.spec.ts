import { expect, test } from '@playwright/test';
import { clearCart, login, readFixtures } from '../support/api';
import { loginViaForm } from '../support/browser';

const fx = readFixtures();

/**
 * 결제 동선의 로그인 가드(useRequireAuth) — 인증 상태는 "모름·있음·없음" 셋이다.
 * 비로그인은 돌아올 경로를 실어 로그인으로, 로그인 상태는 새로고침·직접 진입에도 머문다(05 구매자 흐름 ⑩).
 */
test.describe('결제 동선 로그인 가드', () => {
  test('비로그인으로 주문서에 들어오면 돌아올 경로를 실어 로그인으로 보낸다', async ({ page }) => {
    await page.goto('/checkout');
    await page.waitForURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/checkout');
  });

  test('비로그인으로 결제 완료 페이지에 들어와도 주문번호(쿼리)까지 보존해 로그인으로 보낸다', async ({ page }) => {
    await page.goto('/checkout/complete?orderNumber=ORD-E2E-GUARD');
    await page.waitForURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/checkout/complete?orderNumber=ORD-E2E-GUARD');
  });

  test('로그인했고 장바구니가 비어 있으면 주문서는 장바구니로 보낸다', async ({ page }) => {
    const { accessToken } = await login(fx.buyer);
    await clearCart(accessToken);

    await loginViaForm(page, fx.buyer);
    await page.goto('/checkout');
    await page.waitForURL('**/cart');
  });

  test('로그인 상태로 장바구니를 새로고침해도 로그인 화면으로 튕기지 않는다', async ({ page }) => {
    await loginViaForm(page, fx.buyer);
    await page.goto('/cart');
    await expect(page).toHaveURL(/\/cart$/);

    await page.reload();
    // "아직 모름" 을 "없음" 으로 읽으면 여기서 /login 으로 간다 — 3초 안에 이동이 없어야 한다
    await page.waitForTimeout(3000);
    await expect(page).toHaveURL(/\/cart$/);
  });
});
