import { expect, test } from '@playwright/test';
import { addToCart, clearCart, expectedTotal, login, readFixtures, SHIPPING_LABEL, won } from '../support/api';
import { autoDismissDialogs, loginViaForm } from '../support/browser';

const fx = readFixtures();

/**
 * 장바구니 → 주문서 → "결제하기" 까지. PortOne 결제창은 CI 가 승인할 수 없으므로 **열지 않는다** —
 * 결제창으로 나가는 요청을 끊어 SDK 가 실패하게 두고, 화면이 그 실패를 어떻게 다루는지까지 본다.
 * 결제가 끝난 뒤의 화면은 checkout-complete.spec 이 DB 로 결제된 주문을 만들어 확인한다.
 */
test.describe('주문서: 장바구니에서 결제창 직전까지', () => {
  test.beforeEach(async () => {
    const { accessToken } = await login(fx.buyer);
    await clearCart(accessToken);
    await addToCart(accessToken, fx.productId, 1);
  });

  test('화면의 총 결제금액이 서버가 만든 주문의 금액과 같고, 결제창을 못 열면 주문 상세로 보낸다', async ({ page }) => {
    const dialogs = autoDismissDialogs(page);
    await loginViaForm(page, fx.buyer);

    await page.goto('/cart');
    await expect(page.getByText(fx.productName)).toBeVisible();
    await page.getByRole('button', { name: '구매하기', exact: true }).click();
    await page.waitForURL('**/checkout');
    await expect(page.getByRole('heading', { name: '주문서 작성' })).toBeVisible();

    // 상품 19,900원, 배송비 "무료"(서버 규칙 — 결정 (a)). 금액 문자열은 헤더 장바구니 링크·상품 줄에도
    // 나오므로 "결제 금액" 요약의 행 단위로 본다(가장 안쪽 div = 그 행).
    const total = expectedTotal(fx.price);
    const summaryRow = (label: string) =>
      page.locator('div', { has: page.getByText(label, { exact: true }) }).last();
    await expect(summaryRow('상품 금액')).toContainText(won(fx.price));
    await expect(summaryRow('배송비')).toContainText(SHIPPING_LABEL);
    await expect(summaryRow('총 결제금액')).toContainText(won(total));

    await page.getByLabel('수령인').fill('e2e구매자');
    await page.getByLabel('연락처').fill('01000000000');
    await page.getByLabel('배송지 주소').fill('서울시 테스트구 e2e로 1');

    // 결제창(PortOne) 으로 나가는 요청은 전부 끊는다 — 실제 결제 시도 0
    await page.route(/portone|iamport/i, (route) => route.abort());

    const orderCreated = page.waitForResponse(
      (res) => res.request().method() === 'POST' && /\/orders$/.test(new URL(res.url()).pathname),
    );
    await page.getByRole('button', { name: '결제하기', exact: true }).click();

    const res = await orderCreated;
    expect(res.status()).toBe(201);
    const order = await res.json();
    expect(order.status).toBe('pending_payment');
    // 결제창에 넘기는 금액은 화면이 아니라 서버가 저장한 주문 금액이다 — 둘이 같아야 한다
    console.log(`[checkout] 화면 총 결제금액 ${won(total)} / 서버 주문 totalAmount ${won(Number(order.totalAmount))}`);
    // 2026-10-16 첫 실행에서 실패했던 단언: 화면 22,900원 / 서버 19,900원 — 백엔드에는 배송비 개념이 없고 화면만 3,000원을 더했다.
    //   결정 (a)(docs/roadmap/ex-frontend-e2e.md §4, 2026-10-21)로 화면을 서버에 맞춤. 다시 어긋나면 여기서 빨간불.
    expect(Number(order.totalAmount), '화면 총 결제금액과 서버 주문 금액').toBe(total);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].productId).toBe(fx.productId);

    // 결제창을 못 열었다 → 안내 뒤 주문 상세로(서버 상태를 확인하게). "결제 실패" 로 단정하지 않는다.
    await page.waitForURL(`**/my/orders/${order.orderNumber}`, { timeout: 30_000 });
    expect(dialogs.length).toBeGreaterThan(0);
    await expect(page.getByText(order.orderNumber)).toBeVisible();
  });

  test('품절·빈 장바구니가 아니면 결제하기 버튼이 활성, 필수 항목을 비우면 제출되지 않는다', async ({ page }) => {
    await loginViaForm(page, fx.buyer);
    await page.goto('/checkout');
    await expect(page.getByRole('heading', { name: '주문서 작성' })).toBeVisible();

    const pay = page.getByRole('button', { name: '결제하기', exact: true });
    await expect(pay).toBeEnabled();

    // 수령인·연락처·주소가 required — 비운 채 누르면 브라우저 검증에 걸려 주문 요청이 나가지 않는다
    let orderRequests = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/orders$/.test(new URL(req.url()).pathname)) orderRequests += 1;
    });
    await pay.click();
    await page.waitForTimeout(500);
    expect(orderRequests).toBe(0);
    await expect(page).toHaveURL(/\/checkout$/);
    expect(await page.getByLabel('수령인').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  });
});
