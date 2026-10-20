import { expect, test } from '@playwright/test';
import {
  addToCart,
  clearCart,
  createDataSource,
  createOrder,
  expectedTotal,
  login,
  readFixtures,
  simulatePaidOrder,
  won,
} from '../support/api';
import { loginViaForm } from '../support/browser';

const fx = readFixtures();

/**
 * 결제 완료 페이지는 verify 응답이 아니라 **주문을 다시 조회해** 그린다.
 * 결제 직후 백엔드 리스너가 주문을 paid → preparing 으로 넘기므로, 이 페이지가 열릴 땐 이미 preparing 이다 —
 * `status === 'paid'` 만 보던 옛 판정은 성공한 결제를 "확인할 수 없습니다" 로 보였다(2026-10-16 운영 실결제, PR #79).
 * PortOne 을 거치지 않고 그 상태를 DB 로 만들어(backend-e2e 의 simulatePaidOrder) 화면을 확인한다.
 */
test.describe('결제 완료 페이지', () => {
  let paidOrderNumber: string;
  let pendingOrderNumber: string;

  test.beforeAll(async () => {
    const ds = createDataSource();
    await ds.initialize();
    try {
      const { accessToken } = await login(fx.buyer);
      await clearCart(accessToken);

      const paidItem = await addToCart(accessToken, fx.productId, 1);
      paidOrderNumber = await createOrder(accessToken, [paidItem]);
      await simulatePaidOrder(ds, paidOrderNumber); // orders.status=preparing, paid_at 기록

      const pendingItem = await addToCart(accessToken, fx.productId, 1);
      pendingOrderNumber = await createOrder(accessToken, [pendingItem]); // pending_payment 그대로
    } finally {
      await ds.destroy();
    }
  });

  test('결제된 주문(리스너가 preparing 으로 넘긴 뒤)은 "결제가 완료되었습니다" 와 금액을 보인다', async ({ page }) => {
    await loginViaForm(page, fx.buyer);
    await page.goto(`/checkout/complete?orderNumber=${paidOrderNumber}`);

    await expect(page.getByRole('heading', { name: '결제가 완료되었습니다!' })).toBeVisible();
    await expect(page.getByText(paidOrderNumber)).toBeVisible();
    // ⚠ 2026-10-16 첫 실행에서 실패: 완료 페이지는 서버 금액 19,900원을 보이고 주문서는 22,900원을 보였다(배송비 불일치, ex-frontend-e2e.md §4)
    await expect(page.getByText(won(expectedTotal(fx.price)), { exact: true }), '주문서가 보여 준 총 결제금액이 완료 페이지에도').toBeVisible();
    await expect(page.getByText('결제 완료 상태를 확인할 수 없습니다.')).toHaveCount(0);

    await page.getByRole('button', { name: '주문 상세 보기' }).click();
    await page.waitForURL(`**/my/orders/${paidOrderNumber}`);
  });

  test('결제 대기 주문은 완료로 보이지 않고 주문 내역으로 안내한다', async ({ page }) => {
    await loginViaForm(page, fx.buyer);
    await page.goto(`/checkout/complete?orderNumber=${pendingOrderNumber}`);

    await expect(page.getByText('결제 완료 상태를 확인할 수 없습니다.')).toBeVisible();
    await expect(page.getByRole('heading', { name: '결제가 완료되었습니다!' })).toHaveCount(0);

    await page.getByRole('button', { name: '주문 내역에서 확인하기' }).click();
    await page.waitForURL('**/my/orders');
  });
});
