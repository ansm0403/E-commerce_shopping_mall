import axios from 'axios';
import { DataSource } from 'typeorm';
import { cleanupE2eEverything, createApprovedSeller, createDataSource, createUser, e2ePrefix, simulatePaidOrder } from '../support/db';
import { resetLoginRateLimits } from '../support/redis';
import { login } from '../support/login';
import { addToCart, auth, completeOrder, createApprovedProduct, createOrder, ORDER_FORM, rowOf } from '../support/commerce';

/**
 * 필드 경계(§4 C) — 상품·리뷰·문의·프로필·주문·장바구니·답변·출고·찜 본문에 **서버가 정하는 필드**를 섞어 보낸다.
 * (docs/roadmap/ex-security-api-boundary.md §4 시나리오 C. 셀러 신청은 seller-apply-field-boundary 스펙)
 *
 * 수정 뒤 허용되는 결과는 둘이다 — 어느 쪽이든 "본문의 값이 DB 에 들어간" 경우는 실패다.
 *   (a) 400 거절(forbidNonWhitelisted) → 행이 생기지 않고 기존 행이 그대로
 *   (b) 2xx 수용(whitelist 버리기) → 서버가 정한 값만 저장
 * 변조 필드는 세 종류: 소유자(userId·sellerId), 상태(status·approvalStatus·answer), 식별자(id)·시각(approvedAt·answeredAt).
 */

const SUITE = 'field';
const p = e2ePrefix(SUITE);
const emails = {
  sellerA: `${p}seller-a@test.local`,
  sellerB: `${p}seller-b@test.local`,
  admin: `${p}admin@test.local`,
  buyer: `${p}buyer@test.local`,
  victim: `${p}victim@test.local`, // 소유자 변조의 대상(아무것도 하지 않는 계정)
};

const FAR_PAST = '2000-01-01T00:00:00.000Z';

describe('필드 경계: 본문의 서버 전용 필드 (HTTP e2e)', () => {
  let ds: DataSource;
  let sellerA: string;
  let sellerB: string;
  let buyer: string;
  let sellerAId: number;
  let sellerBId: number;
  let buyerId: number;
  let victimId: number;
  let productA: number; // 셀러 A 의 승인 상품
  let productB: number; // 셀러 B 의 승인 상품
  let doneOrderId: number; // 구매자의 구매 확정 주문(상품 A) — 리뷰용
  let paidOrder: string; // 구매자의 결제 완료 주문(상품 A) — 출고용
  let inquiryOnB: number; // 구매자가 상품 B 에 남긴 문의 — 셀러 B 답변용

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();
    await cleanupE2eEverything(ds, SUITE);
    await resetLoginRateLimits();

    const userA = await createUser(ds, { email: emails.sellerA, role: 'seller' });
    sellerAId = await createApprovedSeller(ds, { userId: userA, businessName: `${p}A상회`, businessNumber: '999-22-00001' });
    const userB = await createUser(ds, { email: emails.sellerB, role: 'seller' });
    sellerBId = await createApprovedSeller(ds, { userId: userB, businessName: `${p}B상회`, businessNumber: '999-22-00002' });
    await createUser(ds, { email: emails.admin, role: 'admin' });
    buyerId = await createUser(ds, { email: emails.buyer, role: 'buyer' });
    victimId = await createUser(ds, { email: emails.victim, role: 'buyer' });

    sellerA = (await login(emails.sellerA)).accessToken;
    sellerB = (await login(emails.sellerB)).accessToken;
    const admin = (await login(emails.admin)).accessToken;
    buyer = (await login(emails.buyer)).accessToken;

    productA = await createApprovedProduct(sellerA, admin, { name: `${p}A상품`, price: 10000, stockQuantity: 100 });
    productB = await createApprovedProduct(sellerB, admin, { name: `${p}B상품`, price: 20000, stockQuantity: 100 });

    const done = await createOrder(buyer, [await addToCart(buyer, productA, 1)]);
    await completeOrder(ds, { orderNumber: done, sellerToken: sellerA, adminToken: admin, buyerToken: buyer });
    doneOrderId = (await ds.query(`SELECT id FROM orders WHERE order_number = $1`, [done]))[0].id;

    paidOrder = await createOrder(buyer, [await addToCart(buyer, productA, 1)]);
    await simulatePaidOrder(ds, paidOrder);

    const inquiry = await axios.post('/inquiries', { productId: productB, title: '문의', content: '내용' }, auth(buyer));
    if (inquiry.status !== 201) throw new Error(`문의 작성 실패 ${inquiry.status} ${JSON.stringify(inquiry.data)}`);
    inquiryOnB = inquiry.data.id;
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanupE2eEverything(ds, SUITE);
      await ds.destroy();
    }
  });

  /** 400 이면 "생기지 않았다", 2xx 면 "서버값만" — 두 경로를 한 함수로 */
  function expectEither(res: { status: number }, onRejected: () => Promise<void>, onAccepted: () => Promise<void>) {
    if (res.status === 400) return onRejected();
    expect([200, 201]).toContain(res.status);
    return onAccepted();
  }

  it('C-5 상품 등록: sellerId·approvalStatus·status·approvedAt·id 는 서버가 정한다', async () => {
    const name = `${p}변조상품`;
    const productBBefore = await rowOf(ds, 'products', 'id = $1', [productB]);
    const res = await axios.post(
      '/products',
      {
        name, description: '변조 테스트', price: 1000, brand: 'e2e',
        sellerId: sellerBId, approvalStatus: 'approved', status: 'published', approvedAt: FAR_PAST, id: productB,
      },
      auth(sellerA),
    );
    expect(await rowOf(ds, 'products', 'id = $1', [productB])).toEqual(productBBefore); // 남의 상품은 그대로
    await expectEither(
      res,
      async () => expect(await rowOf(ds, 'products', 'name = $1', [name])).toBeNull(),
      async () => {
        const row = await rowOf(ds, 'products', 'name = $1', [name]);
        expect(row).toMatchObject({ seller_id: sellerAId, approval_status: 'pending', status: 'draft', approved_at: null });
        expect(row?.id).not.toBe(productB);
      },
    );
  });

  it('C-6 상품 수정: 소유자·승인 상태·승인 시각은 본문으로 못 바꾼다', async () => {
    const before = await rowOf(ds, 'products', 'id = $1', [productA]);
    const res = await axios.patch(
      `/products/${productA}`,
      { name: `${p}A상품(수정)`, sellerId: sellerBId, approvalStatus: 'rejected', approvedAt: FAR_PAST, id: productB },
      auth(sellerA),
    );
    const after = await rowOf(ds, 'products', 'id = $1', [productA]);
    await expectEither(
      res,
      async () => expect(after).toEqual(before),
      async () => {
        // 승인된 상품을 수정하면 서버 규칙으로 재심사(pending, approvedAt null)가 된다 — 그건 서버가 정한 값이다.
        // 본문의 'rejected'·2000-01-01·남의 sellerId 가 들어가지 않았는지만 본다.
        expect(after).toMatchObject({ seller_id: sellerAId, name: `${p}A상품(수정)` });
        expect(after?.approval_status).not.toBe('rejected');
        expect(after?.approved_at === null || (after?.approved_at as Date).toISOString() !== FAR_PAST).toBe(true);
      },
    );
    expect(await rowOf(ds, 'products', 'id = $1', [productB])).toMatchObject({ seller_id: sellerBId });
  });

  it('C-7 리뷰 작성: userId·id·createdAt 은 서버가 정한다', async () => {
    const res = await axios.post(
      '/reviews',
      { orderId: doneOrderId, productId: productA, rating: 4, comment: '변조 리뷰', userId: victimId, id: 999999, createdAt: FAR_PAST },
      auth(buyer),
    );
    expect(await rowOf(ds, 'reviews', 'user_id = $1', [victimId])).toBeNull(); // 피해자 명의 리뷰는 없어야
    await expectEither(
      res,
      async () => expect(await rowOf(ds, 'reviews', 'order_id = $1', [doneOrderId])).toBeNull(),
      async () => {
        const row = await rowOf(ds, 'reviews', 'order_id = $1', [doneOrderId]);
        expect(row).toMatchObject({ user_id: buyerId, product_id: productA });
        expect(row?.id).not.toBe(999999);
      },
    );
  });

  it('C-8 문의 작성: userId·sellerId·status·answer·answeredAt 은 서버가 정한다', async () => {
    const title = `${p}변조문의`;
    const res = await axios.post(
      '/inquiries',
      { productId: productB, title, content: '내용', isSecret: false, userId: victimId, sellerId: sellerAId, status: 'answered', answer: '자문자답', answeredAt: FAR_PAST },
      auth(buyer),
    );
    expect(await rowOf(ds, 'inquiries', 'user_id = $1', [victimId])).toBeNull();
    await expectEither(
      res,
      async () => expect(await rowOf(ds, 'inquiries', 'title = $1', [title])).toBeNull(),
      async () => expect(await rowOf(ds, 'inquiries', 'title = $1', [title])).toMatchObject({
        user_id: buyerId, seller_id: sellerBId, status: 'waiting', answer: null, answered_at: null, // 초기 상태 enum 은 waiting
      }),
    );
  });

  it('C-9 프로필 수정: email·isDemo·isEmailVerified·password·roles 는 본문으로 못 바꾼다', async () => {
    const before = await rowOf(ds, 'users', 'id = $1', [buyerId]);
    const rolesBefore = await ds.query(`SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name`, [buyerId]);
    const res = await axios.patch(
      '/users/me',
      { nickName: '경계검증', email: `${p}hacker@test.local`, is_demo: true, isDemo: true, isEmailVerified: false, password: 'Hacked123!', roles: ['admin'] },
      auth(buyer),
    );
    const after = await rowOf(ds, 'users', 'id = $1', [buyerId]);
    await expectEither(
      res,
      async () => expect(after).toEqual(before),
      async () => {
        expect(after).toMatchObject({ email: before?.email, is_demo: false, isEmailVerified: true, password: before?.password, nickName: '경계검증' });
      },
    );
    const rolesAfter = await ds.query(`SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name`, [buyerId]);
    expect(rolesAfter).toEqual(rolesBefore);
  });

  it('C-10 주문 생성: totalAmount·status·userId·paidAt 은 서버가 계산한다', async () => {
    // 상품 A 는 C-6 의 수정으로 재심사 중(장바구니 불가)이라 승인 상태인 상품 B(20000원)를 쓴다
    const cartItemId = await addToCart(buyer, productB, 3);
    const ordersBefore = (await ds.query(`SELECT count(*)::int AS n FROM orders WHERE user_id = $1`, [buyerId]))[0].n;
    const res = await axios.post(
      '/orders',
      { cartItemIds: [cartItemId], ...ORDER_FORM, totalAmount: 1, status: 'completed', userId: victimId, paidAt: FAR_PAST },
      auth(buyer),
    );
    expect(await rowOf(ds, 'orders', 'user_id = $1', [victimId])).toBeNull();
    await expectEither(
      res,
      async () => expect((await ds.query(`SELECT count(*)::int AS n FROM orders WHERE user_id = $1`, [buyerId]))[0].n).toBe(ordersBefore),
      async () => {
        const row = await rowOf(ds, 'orders', 'order_number = $1', [(res as any).data.orderNumber]);
        expect(row).toMatchObject({ user_id: buyerId, status: 'pending_payment', paid_at: null }); // 초기 상태 enum
        expect(Number(row?.total_amount)).toBe(20000 * 3);
      },
    );
  });

  it('C-11 장바구니 담기: userId·price 는 본문으로 못 정한다', async () => {
    const res = await axios.post('/cart/items', { productId: productB, quantity: 1, userId: victimId, price: 1, cartId: 999999 }, auth(buyer));
    expect(await rowOf(ds, 'carts', 'user_id = $1', [victimId])).toBeNull(); // 피해자에게 장바구니가 생기면 안 된다
    await expectEither(
      res,
      async () => undefined,
      async () => {
        const item = (res as any).data.items.find((i: any) => i.productId === productB);
        expect(item).toBeDefined();
        expect(Number(item.product?.price ?? item.price ?? 20000)).toBe(20000);
        expect(await rowOf(ds, 'carts', 'id = (SELECT cart_id FROM cart_items WHERE id = $1)', [item.id])).toMatchObject({ user_id: buyerId });
      },
    );
  });

  it('C-12 문의 답변: status·answeredAt·userId·sellerId 는 서버가 정한다', async () => {
    const before = await rowOf(ds, 'inquiries', 'id = $1', [inquiryOnB]);
    const res = await axios.patch(
      `/seller/inquiries/${inquiryOnB}/answer`,
      { answer: '답변입니다', status: 'pending', userId: victimId, sellerId: sellerAId, answeredAt: FAR_PAST, id: 999999 },
      auth(sellerB),
    );
    const after = await rowOf(ds, 'inquiries', 'id = $1', [inquiryOnB]);
    await expectEither(
      res,
      async () => expect(after).toEqual(before),
      async () => {
        expect(after).toMatchObject({ user_id: buyerId, seller_id: sellerBId, status: 'answered', answer: '답변입니다' });
        expect(new Date(after?.answered_at as string).getTime()).toBeGreaterThan(Date.now() - 60_000);
      },
    );
  });

  it('C-13 출고: status·sellerId·deliveredAt 은 서버가 정한다', async () => {
    const where = 'order_id = (SELECT id FROM orders WHERE order_number = $1)';
    const before = await rowOf(ds, 'shipments', where, [paidOrder]);
    expect(before).toMatchObject({ seller_id: sellerAId, status: 'preparing' });
    const res = await axios.patch(
      `/seller/orders/${paidOrder}/ship`,
      { trackingNumber: 'E2E-FIELD-1', carrier: 'e2e택배', status: 'delivered', sellerId: sellerBId, deliveredAt: FAR_PAST },
      auth(sellerA),
    );
    const after = await rowOf(ds, 'shipments', where, [paidOrder]);
    await expectEither(
      res,
      async () => expect(after).toEqual(before),
      async () => expect(after).toMatchObject({ seller_id: sellerAId, status: 'shipped', delivered_at: null, tracking_number: 'E2E-FIELD-1' }),
    );
  });

  it('C-14 찜 토글: userId 는 본문으로 못 정한다', async () => {
    const res = await axios.post('/wishlist/toggle', { productId: productA, userId: victimId }, auth(buyer));
    expect(await rowOf(ds, 'wish_list_items', 'user_id = $1', [victimId])).toBeNull();
    await expectEither(
      res,
      async () => expect(await rowOf(ds, 'wish_list_items', 'user_id = $1 AND product_id = $2', [buyerId, productA])).toBeNull(),
      async () => expect(await rowOf(ds, 'wish_list_items', 'user_id = $1 AND product_id = $2', [buyerId, productA])).not.toBeNull(),
    );
  });
});
