import axios from 'axios';
import { DataSource } from 'typeorm';
import { cleanupE2eEverything, createApprovedSeller, createDataSource, createUser, e2ePrefix } from '../support/db';
import { resetLoginRateLimits } from '../support/redis';
import { login } from '../support/login';
import { addToCart, auth, completeOrder, createApprovedProduct, createOrder, expectRejectedAndUnchanged, rowOf } from '../support/commerce';

/**
 * 객체 경계(§4 A) — 구매자가 **남의** 주문·결제·리뷰·문의·장바구니를 건드린다.
 * (docs/roadmap/ex-security-api-boundary.md §4 시나리오 A, 구매자 편)
 *
 * 공격자 모델: 정상 가입한 구매자. 화면에서 본 주소에 남의 식별자(주문번호·리뷰 id·장바구니 항목 id)를 넣어 직접 호출한다.
 * 기대: 403 또는 404 이고 **DB 행이 한 글자도 바뀌지 않는다**. 거절 코드만 보면 "거절했지만 일부는 저장됨" 을 놓치므로
 * 모든 시나리오가 전후 스냅샷을 비교한다.
 *
 * 피해자 데이터는 전부 실제 HTTP 로 만든다(상품 등록·승인 → 장바구니 → 주문 → 결제 시뮬레이션 → 출고 → 배송 → 확정 → 리뷰).
 */

const SUITE = 'obj-buyer';
const p = e2ePrefix(SUITE);
const emails = {
  seller: `${p}seller@test.local`,
  admin: `${p}admin@test.local`,
  victim: `${p}victim@test.local`,
  attacker: `${p}attacker@test.local`,
};

describe('객체 경계: 구매자가 남의 주문·리뷰·문의·장바구니·결제에 접근 (HTTP e2e)', () => {
  let ds: DataSource;
  let victim: string;
  let attacker: string;

  let pendingOrder: string; // 피해자의 결제 대기 주문
  let doneOrder: string; // 피해자의 구매 확정 주문
  let paymentId: string; // 피해자 결제 대기 주문의 결제 식별자(merchant_uid)
  let reviewId: number;
  let inquiryId: number;
  let cartItemId: number; // 피해자 장바구니에 남아 있는 항목

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();
    await cleanupE2eEverything(ds, SUITE);
    await resetLoginRateLimits();

    const sellerUser = await createUser(ds, { email: emails.seller, role: 'seller' });
    await createApprovedSeller(ds, { userId: sellerUser, businessName: `${p}상회`, businessNumber: '999-44-00001' });
    await createUser(ds, { email: emails.admin, role: 'admin' });
    await createUser(ds, { email: emails.victim, role: 'buyer' });
    await createUser(ds, { email: emails.attacker, role: 'buyer' });

    const seller = (await login(emails.seller)).accessToken;
    const admin = (await login(emails.admin)).accessToken;
    victim = (await login(emails.victim)).accessToken;
    attacker = (await login(emails.attacker)).accessToken;

    const productId = await createApprovedProduct(seller, admin, { name: `${p}상품`, price: 12000, stockQuantity: 50 });

    // 피해자: 결제 대기 주문 1건
    pendingOrder = await createOrder(victim, [await addToCart(victim, productId, 1)]);
    paymentId = (await ds.query(`SELECT p.merchant_uid FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.order_number = $1`, [pendingOrder]))[0].merchant_uid;

    // 피해자: 구매 확정 주문 1건 + 리뷰
    doneOrder = await createOrder(victim, [await addToCart(victim, productId, 2)]);
    await completeOrder(ds, { orderNumber: doneOrder, sellerToken: seller, adminToken: admin, buyerToken: victim });
    const [{ id: doneOrderId }] = await ds.query(`SELECT id FROM orders WHERE order_number = $1`, [doneOrder]);
    const review = await axios.post('/reviews', { orderId: doneOrderId, productId, rating: 5, comment: '피해자 리뷰' }, auth(victim));
    if (review.status !== 201) throw new Error(`리뷰 작성 실패 ${review.status} ${JSON.stringify(review.data)}`);
    reviewId = review.data.id;

    // 피해자: 비밀 문의 1건, 장바구니에 남은 항목 1개
    const inquiry = await axios.post('/inquiries', { productId, title: '피해자 문의', content: '배송 문의', isSecret: true }, auth(victim));
    if (inquiry.status !== 201) throw new Error(`문의 작성 실패 ${inquiry.status} ${JSON.stringify(inquiry.data)}`);
    inquiryId = inquiry.data.id;
    cartItemId = await addToCart(victim, productId, 1);
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanupE2eEverything(ds, SUITE);
      await ds.destroy();
    }
  });

  const orderRow = () => rowOf(ds, 'orders', 'order_number = $1', [pendingOrder]);

  it('A-1 남의 주문 조회 → 거절, 내 주문 목록에도 남의 주문이 없다', async () => {
    const res = await axios.get(`/orders/${pendingOrder}`, auth(attacker));
    expect([403, 404]).toContain(res.status);

    const mine = await axios.get('/orders', { ...auth(attacker), params: { page: 1, take: 50 } });
    expect(mine.status).toBe(200);
    const numbers = JSON.stringify(mine.data);
    expect(numbers).not.toContain(pendingOrder);
    expect(numbers).not.toContain(doneOrder);
  });

  it('A-2 남의 결제 대기 주문 취소 → 거절, 상태 불변', async () => {
    const before = await orderRow();
    const res = await axios.patch(`/orders/${pendingOrder}/cancel`, {}, auth(attacker));
    expectRejectedAndUnchanged(res, before, await orderRow());
  });

  it('A-3 남의 주문 구매확정·테스트 배송완료 → 거절, 상태 불변', async () => {
    const before = await orderRow();
    const confirm = await axios.patch(`/orders/${pendingOrder}/confirm`, {}, auth(attacker));
    const testDeliver = await axios.patch(`/orders/${pendingOrder}/test-deliver`, {}, auth(attacker));
    expectRejectedAndUnchanged(confirm, before, await orderRow());
    expectRejectedAndUnchanged(testDeliver, before, await orderRow());
  });

  it('A-4 남의 결제 검증(paymentId 로) → 거절, 결제·주문 불변', async () => {
    const payBefore = await rowOf(ds, 'payments', 'merchant_uid = $1', [paymentId]);
    const orderBefore = await orderRow();
    const res = await axios.post('/payments/verify', { paymentId, transactionId: 'e2e-forged-tx' }, auth(attacker));
    expectRejectedAndUnchanged(res, payBefore, await rowOf(ds, 'payments', 'merchant_uid = $1', [paymentId]));
    expect(await orderRow()).toEqual(orderBefore);
  });

  it('A-5 남의 결제 취소(환불) 요청 → 거절, 주문 불변', async () => {
    const before = await rowOf(ds, 'orders', 'order_number = $1', [doneOrder]);
    const res = await axios.post(`/payments/${doneOrder}/cancel`, { reason: '남의 주문 환불 시도' }, auth(attacker));
    expectRejectedAndUnchanged(res, before, await rowOf(ds, 'orders', 'order_number = $1', [doneOrder]));
  });

  it('A-6 남의 리뷰 수정·삭제 → 거절, 리뷰 불변', async () => {
    const before = await rowOf(ds, 'reviews', 'id = $1', [reviewId]);
    const patch = await axios.patch(`/reviews/${reviewId}`, { rating: 1, comment: '변조' }, auth(attacker));
    expectRejectedAndUnchanged(patch, before, await rowOf(ds, 'reviews', 'id = $1', [reviewId]));
    const del = await axios.delete(`/reviews/${reviewId}`, auth(attacker));
    expectRejectedAndUnchanged(del, before, await rowOf(ds, 'reviews', 'id = $1', [reviewId]));
  });

  it('A-7 남의 문의 삭제 → 거절, 문의 불변', async () => {
    const before = await rowOf(ds, 'inquiries', 'id = $1', [inquiryId]);
    const res = await axios.delete(`/inquiries/${inquiryId}`, auth(attacker));
    expectRejectedAndUnchanged(res, before, await rowOf(ds, 'inquiries', 'id = $1', [inquiryId]));
  });

  it('A-8 남의 장바구니 항목 수량 변경·삭제 → 거절, 항목 불변', async () => {
    const before = await rowOf(ds, 'cart_items', 'id = $1', [cartItemId]);
    expect(before).not.toBeNull();
    const patch = await axios.patch(`/cart/items/${cartItemId}`, { quantity: 99 }, auth(attacker));
    expectRejectedAndUnchanged(patch, before, await rowOf(ds, 'cart_items', 'id = $1', [cartItemId]));
    const del = await axios.delete(`/cart/items/${cartItemId}`, auth(attacker));
    expectRejectedAndUnchanged(del, before, await rowOf(ds, 'cart_items', 'id = $1', [cartItemId]));
  });
});
