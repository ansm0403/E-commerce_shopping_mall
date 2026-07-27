import axios from 'axios';
import { DataSource } from 'typeorm';
import {
  cleanupE2eData,
  cleanupE2eOrders,
  cleanupE2eProducts,
  createApprovedSeller,
  createDataSource,
  createUser,
  e2ePrefix,
  makeEmails,
  simulatePaidOrder,
  E2E_PASSWORD,
} from '../support/db';
import { resetLoginRateLimits } from '../support/redis';

/** 이 스펙 전용 이름공간 — 다른 스펙과 계정·상품이 겹치지 않게 한다 */
const SUITE = 'seller-product';
const emails = makeEmails(SUITE);
const productName = (label: string) => `${e2ePrefix(SUITE)}${label}`;

/**
 * 셀러 상품 라이프사이클 HTTP e2e (01-seller-core §1-A②).
 *
 * Step 5 에서 뚫은 "게시 경로"를 처음부터 끝까지 고정한다:
 *   등록(draft/pending) → 공개 목록 미노출·장바구니 차단
 *   → 관리자 승인 = 게시(approved + published) → 공개 목록 노출 → 실제 주문 생성
 *   → 셀러 숨김/재게시 토글(재심사 미발동) → 반려 → 수정 = 재제출(PENDING 복귀) → 재승인
 *
 * 셀러 계정은 DB 로 프로비저닝한다(신청→승인 왕복은 seller-approval 스펙이 HTTP 로 검증).
 * 전제: postgres·redis + `yarn nx serve backend` (support/global-setup.ts)
 */

async function login(email: string) {
  const res = await axios.post('/auth/login', { email, password: E2E_PASSWORD });
  expect(res.status).toBe(201);
  return { accessToken: res.data.accessToken as string };
}

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/** 공개 목록(GET /products)에 상품이 보이는지 — sellerId 필터로 시드 349건과 격리 */
async function visibleInShop(sellerId: number, productId: number): Promise<boolean> {
  const res = await axios.get('/products', {
    params: { page: 1, take: 50, sellerId },
  });
  expect(res.status).toBe(200);
  return res.data.data.some((p: any) => p.id === productId);
}

describe('셀러 상품 라이프사이클 (HTTP e2e)', () => {
  let ds: DataSource;
  let sellerId: number;
  let seller: { accessToken: string };
  let buyer: { accessToken: string };
  let admin: { accessToken: string };
  /** 배송 왕복 테스트가 만든 주문 — 정산 API 테스트가 이어받는다 */
  let settledOrderNumber: string;

  const cleanup = async () => {
    await cleanupE2eOrders(ds, SUITE);
    await cleanupE2eProducts(ds, SUITE);
    await cleanupE2eData(ds, SUITE);
  };

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();

    await cleanup();
    await resetLoginRateLimits();

    const sellerUserId = await createUser(ds, { email: emails.seller, role: 'seller' });
    sellerId = await createApprovedSeller(ds, {
      userId: sellerUserId,
      businessName: `${e2ePrefix(SUITE)}상회`,
      // unique 컬럼 — 스위트 고정 값이지만 cleanup 이 sellers 를 지우므로 재실행에 안전
      businessNumber: '999-98-76543',
    });
    await createUser(ds, { email: emails.buyer, role: 'buyer' });
    await createUser(ds, { email: emails.admin, role: 'admin' });

    // 로그인은 계정당 1회만(IP 레이트리밋 10회/5분) — 토큰을 스위트 전체에서 재사용
    seller = await login(emails.seller);
    buyer = await login(emails.buyer);
    admin = await login(emails.admin);
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanup();
      await ds.destroy();
    }
  });

  it('등록→승인=게시→노출→주문: 게시 경로가 처음부터 끝까지 이어진다', async () => {
    // ① 셀러 등록 — draft/pending 으로 생성된다
    const create = await axios.post(
      '/products',
      {
        name: productName('원두 1kg'),
        description: 'e2e: 게시 경로 검증용 상품',
        price: 19900,
        brand: 'e2e브랜드',
        stockQuantity: 10,
      },
      auth(seller.accessToken),
    );
    expect(create.status).toBe(201);
    const productId = create.data.id as number;
    expect(create.data.status).toBe('draft');
    expect(create.data.approvalStatus).toBe('pending');

    // ② 승인 전 — 공개 목록에 없고, 장바구니부터 막힌다
    expect(await visibleInShop(sellerId, productId)).toBe(false);
    const cartBefore = await axios.post(
      '/cart/items',
      { productId, quantity: 1 },
      auth(buyer.accessToken),
    );
    expect(cartBefore.status).toBe(400);

    // ③ 관리자 승인 = 게시 (draft → published 까지 한 번에)
    const approve = await axios.patch(
      `/admin/products/${productId}/approve`,
      {},
      auth(admin.accessToken),
    );
    expect(approve.status).toBe(200);
    expect(approve.data.approvalStatus).toBe('approved');
    expect(approve.data.status).toBe('published');

    // ④ 공개 목록 노출 + 상세 조회
    expect(await visibleInShop(sellerId, productId)).toBe(true);
    const detail = await axios.get(`/products/${productId}`);
    expect(detail.status).toBe(200);

    // ⑤ 실제 주문 생성 — 장바구니 → 주문 (status=published 검증을 통과해야 한다)
    const cart = await axios.post(
      '/cart/items',
      { productId, quantity: 2 },
      auth(buyer.accessToken),
    );
    expect(cart.status).toBe(201);
    const cartItem = cart.data.items.find((i: any) => i.productId === productId);
    expect(cartItem).toBeDefined();

    const order = await axios.post(
      '/orders',
      {
        cartItemIds: [cartItem.id],
        shippingAddress: '서울시 테스트구 e2e로 1',
        recipientName: 'e2e구매자',
        recipientPhone: '01000000000',
      },
      auth(buyer.accessToken),
    );
    expect(order.status).toBe(201);
    expect(order.data.orderNumber).toBeDefined();
    expect(order.data.items.some((i: any) => i.productId === productId)).toBe(true);
  }, 60_000);

  it('게시/숨김 토글: 재심사를 발동하지 않고 노출만 바뀐다', async () => {
    const create = await axios.post(
      '/products',
      {
        name: productName('토글 확인'),
        description: 'e2e: 게시/숨김 토글 검증',
        price: 9900,
        brand: 'e2e브랜드',
        stockQuantity: 5,
      },
      auth(seller.accessToken),
    );
    const productId = create.data.id as number;

    // 승인 전에는 게시할 수 없다
    const publishEarly = await axios.patch(
      `/products/${productId}/status`,
      { status: 'published' },
      auth(seller.accessToken),
    );
    expect(publishEarly.status).toBe(400);

    await axios.patch(`/admin/products/${productId}/approve`, {}, auth(admin.accessToken));

    // 숨김 → 목록에서 사라지고, approvalStatus 는 approved 그대로(재심사 미발동)
    const hide = await axios.patch(
      `/products/${productId}/status`,
      { status: 'hidden' },
      auth(seller.accessToken),
    );
    expect(hide.status).toBe(200);
    expect(hide.data.status).toBe('hidden');
    expect(hide.data.approvalStatus).toBe('approved');
    expect(await visibleInShop(sellerId, productId)).toBe(false);

    // 재게시 → 다시 노출, 여전히 재심사 없음
    const republish = await axios.patch(
      `/products/${productId}/status`,
      { status: 'published' },
      auth(seller.accessToken),
    );
    expect(republish.status).toBe(200);
    expect(republish.data.status).toBe('published');
    expect(republish.data.approvalStatus).toBe('approved');
    expect(await visibleInShop(sellerId, productId)).toBe(true);

    // 허용 외 상태(draft/sold_out)는 DTO 에서 걸린다
    const invalid = await axios.patch(
      `/products/${productId}/status`,
      { status: 'draft' },
      auth(seller.accessToken),
    );
    expect(invalid.status).toBe(400);

    // 구매자 토큰으로는 상태 변경 자체가 막힌다 (RolesGuard)
    const forbidden = await axios.patch(
      `/products/${productId}/status`,
      { status: 'hidden' },
      auth(buyer.accessToken),
    );
    expect(forbidden.status).toBe(403);
  }, 60_000);

  it('반려 → 수정 = 재제출(PENDING 복귀) → 재승인: 반려가 더는 영구 사망이 아니다', async () => {
    const create = await axios.post(
      '/products',
      {
        name: productName('반려 부활'),
        description: 'e2e: 반려 후 재제출 검증',
        price: 15000,
        brand: 'e2e브랜드',
        stockQuantity: 3,
      },
      auth(seller.accessToken),
    );
    const productId = create.data.id as number;

    const reason = '상품 설명이 부족합니다.';
    const reject = await axios.patch(
      `/admin/products/${productId}/reject`,
      { reason },
      auth(admin.accessToken),
    );
    expect(reject.status).toBe(200);
    expect(reject.data.approvalStatus).toBe('rejected');

    // 셀러 본인 조회(GET /products/my/:id)로 반려 사유를 읽을 수 있다
    const mine = await axios.get(`/products/my/${productId}`, auth(seller.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.data.rejectionReason).toBe(reason);

    // 수정 = 재제출 — approvalStatus 가 PENDING 으로 돌아가고 반려 사유가 지워진다
    const resubmit = await axios.patch(
      `/products/${productId}`,
      { description: 'e2e: 반려 사유를 반영해 설명을 보강했습니다.' },
      auth(seller.accessToken),
    );
    expect(resubmit.status).toBe(200);
    expect(resubmit.data.approvalStatus).toBe('pending');
    expect(resubmit.data.rejectionReason).toBeNull();

    // 재승인 — draft 였으므로 게시까지 한 번에
    const approve = await axios.patch(
      `/admin/products/${productId}/approve`,
      {},
      auth(admin.accessToken),
    );
    expect(approve.status).toBe(200);
    expect(approve.data.approvalStatus).toBe('approved');
    expect(approve.data.status).toBe('published');
  }, 60_000);

  it('배송 왕복: 출고(셀러) → 배송완료(관리자) → 구매확정(구매자) → 정산 PENDING 자동 생성', async () => {
    // ① 상품 준비(등록→승인=게시) 후 구매자가 주문
    const create = await axios.post(
      '/products',
      {
        name: productName('배송 왕복'),
        description: 'e2e: 배송/정산 체인 검증',
        price: 30000,
        brand: 'e2e브랜드',
        stockQuantity: 5,
      },
      auth(seller.accessToken),
    );
    const productId = create.data.id as number;
    await axios.patch(`/admin/products/${productId}/approve`, {}, auth(admin.accessToken));

    const cart = await axios.post('/cart/items', { productId, quantity: 2 }, auth(buyer.accessToken));
    const cartItem = cart.data.items.find((i: any) => i.productId === productId);
    const order = await axios.post(
      '/orders',
      {
        cartItemIds: [cartItem.id],
        shippingAddress: '서울시 테스트구 e2e로 1',
        recipientName: 'e2e구매자',
        recipientPhone: '01000000000',
      },
      auth(buyer.accessToken),
    );
    const orderNumber = order.data.orderNumber as string;

    // ② 결제 완료 시뮬레이션 (order.paid 리스너 결과물 재현 — preparing + shipment 생성)
    await simulatePaidOrder(ds, orderNumber);

    // ③ 셀러 주문 목록 — 내 items/shipments 만 실려 오고 출고 대기 상태다
    const sellerOrders = await axios.get('/seller/orders', {
      ...auth(seller.accessToken),
      params: { page: 1, take: 20, status: 'preparing' },
    });
    expect(sellerOrders.status).toBe(200);
    const mine = sellerOrders.data.data.find((o: any) => o.orderNumber === orderNumber);
    expect(mine).toBeDefined();
    expect(mine.shipments).toHaveLength(1);
    expect(mine.shipments[0].status).toBe('preparing');

    // 구매자 토큰으로는 셀러 주문 API 자체가 막힌다 (RolesGuard)
    const forbidden = await axios.get('/seller/orders', auth(buyer.accessToken));
    expect(forbidden.status).toBe(403);

    // ④ 출고 전 구매확정은 불가 (DELIVERED 만 확정 가능)
    const confirmEarly = await axios.patch(`/orders/${orderNumber}/confirm`, {}, auth(buyer.accessToken));
    expect(confirmEarly.status).toBe(400);

    // ⑤ 셀러 출고 — 단일 셀러 주문이라 주문 전체가 SHIPPED 로 동기화된다
    const ship = await axios.patch(
      `/seller/orders/${orderNumber}/ship`,
      { trackingNumber: '1234-5678-9012', carrier: 'e2e택배' },
      auth(seller.accessToken),
    );
    expect(ship.status).toBe(200);
    expect(ship.data.status).toBe('shipped');
    expect(ship.data.shipments[0].status).toBe('shipped');
    expect(ship.data.shipments[0].trackingNumber).toBe('1234-5678-9012');

    // 중복 출고는 400 (PREPARING 배송건만 출고 가능)
    const shipTwice = await axios.patch(
      `/seller/orders/${orderNumber}/ship`,
      { trackingNumber: '0000', carrier: 'e2e택배' },
      auth(seller.accessToken),
    );
    expect(shipTwice.status).toBe(400);

    // ⑥ 관리자 배송완료 — 전 배송건 DELIVERED → 주문도 DELIVERED
    const deliver = await axios.patch(`/admin/orders/${orderNumber}/deliver`, {}, auth(admin.accessToken));
    expect(deliver.status).toBe(200);
    expect(deliver.data.status).toBe('delivered');

    // 관리자 상세에서도 배송건 상태가 보인다
    const adminDetail = await axios.get(`/admin/orders/${orderNumber}`, auth(admin.accessToken));
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.data.shipments[0].status).toBe('delivered');

    // ⑦ 구매자 구매확정 → order.completed 이벤트 → 정산 PENDING 자동 생성
    const confirm = await axios.patch(`/orders/${orderNumber}/confirm`, {}, auth(buyer.accessToken));
    expect(confirm.status).toBe(200);
    expect(confirm.data.status).toBe('completed');

    // 리스너는 비동기(withRetry)라 정산 레코드를 폴링으로 확인
    let settlements: any[] = [];
    for (let i = 0; i < 20; i++) {
      settlements = await ds.query(
        `SELECT * FROM settlements WHERE order_number = $1`,
        [orderNumber],
      );
      if (settlements.length > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(settlements).toHaveLength(1);
    expect(settlements[0].seller_id).toBe(sellerId);
    expect(Number(settlements[0].amount)).toBe(60000); // 30,000 × 2
    expect(Number(settlements[0].commission_amount)).toBe(6000); // 10%
    expect(Number(settlements[0].settlement_amount)).toBe(54000);
    expect(settlements[0].status).toBe('pending');

    settledOrderNumber = orderNumber; // 다음 테스트(정산 API)가 이어받는다
  }, 60_000);

  it('정산 API: 셀러 조회/요약 + 관리자 확정→지급 전이 (02-A④·01-A④)', async () => {
    expect(settledOrderNumber).toBeDefined(); // 배송 왕복 테스트 선행 전제

    // 셀러 — 내 정산 목록 (BaseModel 재선언 덕에 id/createdAt 이 실려 와야 한다)
    const mine = await axios.get('/seller/settlements', {
      ...auth(seller.accessToken),
      params: { page: 1, take: 20 },
    });
    expect(mine.status).toBe(200);
    const settlement = mine.data.data.find((s: any) => s.orderNumber === settledOrderNumber);
    expect(settlement).toBeDefined();
    expect(settlement.id).toBeDefined();
    expect(settlement.status).toBe('pending');
    expect(Number(settlement.settlementAmount)).toBe(54000);

    // 셀러 — 요약 (이 스위트의 셀러는 정산이 이 1건뿐이라 값이 결정적이다)
    const summary = await axios.get('/seller/settlements/summary', auth(seller.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.data.totalAmount).toBe(60000);
    expect(summary.data.totalCommission).toBe(6000);
    expect(summary.data.totalSettlement).toBe(54000);
    expect(summary.data.pendingCount).toBe(1);

    // 구매자 토큰으로는 셀러 정산 조회가 막힌다 (RolesGuard)
    const forbidden = await axios.get('/seller/settlements', auth(buyer.accessToken));
    expect(forbidden.status).toBe(403);

    // 관리자 — 전체 목록(셀러 필터) + seller 요약 포함
    const adminList = await axios.get('/admin/settlements', {
      ...auth(admin.accessToken),
      params: { page: 1, take: 20, sellerId },
    });
    expect(adminList.status).toBe(200);
    const target = adminList.data.data.find((s: any) => s.orderNumber === settledOrderNumber);
    expect(target).toBeDefined();
    expect(target.seller?.businessName).toBeDefined();

    // 전이 규칙: PENDING 에서 pay 는 400 (confirm 을 건너뛸 수 없다)
    const payEarly = await axios.patch(
      `/admin/settlements/${target.id}/pay`, {}, auth(admin.accessToken),
    );
    expect(payEarly.status).toBe(400);

    // PENDING → CONFIRMED
    const confirm = await axios.patch(
      `/admin/settlements/${target.id}/confirm`, {}, auth(admin.accessToken),
    );
    expect(confirm.status).toBe(200);
    expect(confirm.data.status).toBe('confirmed');
    expect(confirm.data.confirmedAt).not.toBeNull();

    // 중복 확정은 400
    const confirmTwice = await axios.patch(
      `/admin/settlements/${target.id}/confirm`, {}, auth(admin.accessToken),
    );
    expect(confirmTwice.status).toBe(400);

    // CONFIRMED → PAID
    const pay = await axios.patch(
      `/admin/settlements/${target.id}/pay`, {}, auth(admin.accessToken),
    );
    expect(pay.status).toBe(200);
    expect(pay.data.status).toBe('paid');
    expect(pay.data.paidAt).not.toBeNull();

    // 셀러 요약에도 반영 — pending 0 / paid 1
    const summaryAfter = await axios.get('/seller/settlements/summary', auth(seller.accessToken));
    expect(summaryAfter.data.pendingCount).toBe(0);
    expect(summaryAfter.data.paidCount).toBe(1);
  }, 60_000);

  it('승인된 상품 수정 = 재심사: PENDING 으로 돌아가되 게시 상태는 유지된다', async () => {
    const create = await axios.post(
      '/products',
      {
        name: productName('수정 재심사'),
        description: 'e2e: 승인 후 수정 검증',
        price: 22000,
        brand: 'e2e브랜드',
        stockQuantity: 7,
      },
      auth(seller.accessToken),
    );
    const productId = create.data.id as number;
    await axios.patch(`/admin/products/${productId}/approve`, {}, auth(admin.accessToken));

    const edit = await axios.patch(
      `/products/${productId}`,
      { price: 23000 },
      auth(seller.accessToken),
    );
    expect(edit.status).toBe(200);
    expect(edit.data.approvalStatus).toBe('pending');
    // status 필드는 published 로 남지만, 공개 목록·주문은 approvalStatus=approved 가
    // 필요조건이라 재승인 전까지는 상점에서 내려간다.
    expect(edit.data.status).toBe('published');
    expect(await visibleInShop(sellerId, productId)).toBe(false);

    // 재승인 — status 가 draft 가 아니므로(published 유지) 그대로 다시 노출된다
    const reapprove = await axios.patch(
      `/admin/products/${productId}/approve`,
      {},
      auth(admin.accessToken),
    );
    expect(reapprove.status).toBe(200);
    expect(reapprove.data.status).toBe('published');
    expect(await visibleInShop(sellerId, productId)).toBe(true);
  }, 60_000);
});
