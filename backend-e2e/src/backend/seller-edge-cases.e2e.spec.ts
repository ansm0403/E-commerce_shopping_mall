import axios from 'axios';
import { DataSource } from 'typeorm';
import {
  cleanupE2eData,
  cleanupE2eOrders,
  cleanupE2eProducts,
  createApprovedSeller,
  createDataSource,
  createOwnerlessPublishedProduct,
  createUser,
  e2ePrefix,
  makeEmails,
  simulatePaidOrder,
} from '../support/db';
import { resetLoginRateLimits } from '../support/redis';

/** 이 스펙 전용 이름공간 */
const SUITE = 'seller-edge';
const emails = makeEmails(SUITE);
const productName = (label: string) => `${e2ePrefix(SUITE)}${label}`;

/**
 * Step 5·6·7 산출물의 엣지케이스 검증 (HTTP e2e).
 *
 * 라이프사이클 스펙(seller-product-lifecycle)이 행복 경로를 고정한다면, 여기는 구멍을 찌른다:
 *   · 소유권 — 타 셀러 상품의 status/단건/수정 접근 (403)
 *   · 게시 가드 — REJECTED 상품 게시 시도(400) / 승인 전 숨김은 허용(명세 고정)
 *   · 승인=게시의 경계 — 숨김(HIDDEN) 상품은 재심사 후 재승인해도 HIDDEN 유지(셀러 의사 존중)
 *   · 장바구니 race — 담아둔 뒤 셀러가 숨긴 상품은 주문 단계에서 막힌다
 *   · 업로드 fileFilter — /uploads 정적 서빙을 뚫었으므로 비이미지(.html)는 저장형 XSS 벡터 → 400
 *   · 멀티셀러 주문 — 배송건 분리, 부분 출고/부분 배송완료 시 주문 상태 동기화, 정산 셀러별 분리
 *   · 무셀러(seller_id NULL) 상품 — orderItem null 저장(§7-5), shipment/정산 미생성, 무셀러 전용
 *     주문은 deliver 할 배송건이 없다(404 — 현재 한계를 명세로 고정)
 *   · 정산 confirm 은 데모 관리자 403 (DemoAccountGuard)
 */

// 로그인은 공용 헬퍼 사용 — 스펙 병렬 실행 시 IP 레이트리밋(10회/5분)을 429 재시도로 흡수한다
import { login } from '../support/login';

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe('셀러 파이프라인 엣지케이스 (HTTP e2e)', () => {
  let ds: DataSource;
  let sellerAId: number;
  let sellerBId: number;
  let sellerA: { accessToken: string };
  let sellerB: { accessToken: string };
  let buyer: { accessToken: string };
  let admin: { accessToken: string };
  let demoAdmin: { accessToken: string };

  const cleanup = async () => {
    await cleanupE2eOrders(ds, SUITE);
    await cleanupE2eProducts(ds, SUITE);
    await cleanupE2eData(ds, SUITE);
  };

  /** 셀러 상품 생성 + 관리자 승인(=게시)까지 한 번에 */
  const createApprovedProduct = async (
    token: string,
    label: string,
    price: number,
    stock = 10,
  ): Promise<number> => {
    const create = await axios.post(
      '/products',
      { name: productName(label), description: 'e2e 엣지 검증', price, brand: 'e2e브랜드', stockQuantity: stock },
      auth(token),
    );
    expect(create.status).toBe(201);
    await axios.patch(`/admin/products/${create.data.id}/approve`, {}, auth(admin.accessToken));
    return create.data.id as number;
  };

  /** 장바구니에 담고 그 cartItem id 를 돌려준다 */
  const addToCart = async (productId: number, quantity: number): Promise<number> => {
    const res = await axios.post('/cart/items', { productId, quantity }, auth(buyer.accessToken));
    expect(res.status).toBe(201);
    return res.data.items.find((i: any) => i.productId === productId).id as number;
  };

  const createOrder = async (cartItemIds: number[]): Promise<string> => {
    const res = await axios.post(
      '/orders',
      {
        cartItemIds,
        shippingAddress: '서울시 테스트구 엣지로 1',
        recipientName: 'e2e구매자',
        recipientPhone: '01000000000',
      },
      auth(buyer.accessToken),
    );
    expect(res.status).toBe(201);
    return res.data.orderNumber as string;
  };

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();

    await cleanup();
    await resetLoginRateLimits();

    const userA = await createUser(ds, { email: emails.seller, role: 'seller' });
    sellerAId = await createApprovedSeller(ds, {
      userId: userA,
      businessName: `${e2ePrefix(SUITE)}A상회`,
      businessNumber: '999-97-11111',
    });
    const userB = await createUser(ds, { email: emails.sellerB, role: 'seller' });
    sellerBId = await createApprovedSeller(ds, {
      userId: userB,
      businessName: `${e2ePrefix(SUITE)}B상회`,
      businessNumber: '999-97-22222',
    });
    await createUser(ds, { email: emails.buyer, role: 'buyer' });
    await createUser(ds, { email: emails.admin, role: 'admin' });
    await createUser(ds, { email: emails.demoAdmin, role: 'admin', isDemo: true });

    sellerA = await login(emails.seller);
    sellerB = await login(emails.sellerB);
    buyer = await login(emails.buyer);
    admin = await login(emails.admin);
    demoAdmin = await login(emails.demoAdmin);
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanup();
      await ds.destroy();
    }
  });

  it('소유권·게시 가드: 남의 상품은 만질 수 없고, 반려 상품은 게시할 수 없다', async () => {
    const create = await axios.post(
      '/products',
      { name: productName('소유권'), description: 'e2e', price: 1000, brand: 'e2e브랜드' },
      auth(sellerA.accessToken),
    );
    const productId = create.data.id as number;

    // 타 셀러(B)의 접근 — 전부 403 (존재는 확인되지만 소유권에서 막힌다)
    const bStatus = await axios.patch(
      `/products/${productId}/status`, { status: 'hidden' }, auth(sellerB.accessToken),
    );
    expect(bStatus.status).toBe(403);
    const bDetail = await axios.get(`/products/my/${productId}`, auth(sellerB.accessToken));
    expect(bDetail.status).toBe(403);
    const bUpdate = await axios.patch(
      `/products/${productId}`, { name: productName('탈취') }, auth(sellerB.accessToken),
    );
    expect(bUpdate.status).toBe(403);

    // 구매자는 라우트 자체가 막힌다 (RolesGuard)
    const buyerDetail = await axios.get(`/products/my/${productId}`, auth(buyer.accessToken));
    expect(buyerDetail.status).toBe(403);

    // 없는 상품 — 404
    const notFound = await axios.get('/products/my/99999999', auth(sellerA.accessToken));
    expect(notFound.status).toBe(404);

    // 승인 전(PENDING·DRAFT)에도 숨김 지정은 허용된다 — 게시(published)만 승인이 전제
    const hideEarly = await axios.patch(
      `/products/${productId}/status`, { status: 'hidden' }, auth(sellerA.accessToken),
    );
    expect(hideEarly.status).toBe(200);
    expect(hideEarly.data.approvalStatus).toBe('pending');

    // 반려된 상품은 게시할 수 없다 (400) — 수정=재제출만이 부활 경로
    await axios.patch(
      `/admin/products/${productId}/reject`, { reason: 'e2e 반려' }, auth(admin.accessToken),
    );
    const publishRejected = await axios.patch(
      `/products/${productId}/status`, { status: 'published' }, auth(sellerA.accessToken),
    );
    expect(publishRejected.status).toBe(400);
  }, 60_000);

  it('승인=게시의 경계: 숨긴 상품은 재심사→재승인을 거쳐도 HIDDEN 그대로다', async () => {
    const productId = await createApprovedProduct(sellerA.accessToken, '숨김유지', 2000);

    // 게시 상태에서 buyer 가 장바구니에 담아둔다
    const cartItemId = await addToCart(productId, 1);

    // 셀러가 숨김 → 담아둔 장바구니로 주문 시도해도 주문 생성 단계에서 막힌다 (race 방어)
    await axios.patch(`/products/${productId}/status`, { status: 'hidden' }, auth(sellerA.accessToken));
    const orderHidden = await axios.post(
      '/orders',
      {
        cartItemIds: [cartItemId],
        shippingAddress: '서울시', recipientName: 'e2e', recipientPhone: '01000000000',
      },
      auth(buyer.accessToken),
    );
    expect(orderHidden.status).toBe(400);

    // 숨김 상태에서 내용 수정 → 재심사(PENDING), status 는 hidden 유지
    const edit = await axios.patch(
      `/products/${productId}`, { price: 2100 }, auth(sellerA.accessToken),
    );
    expect(edit.data.approvalStatus).toBe('pending');
    expect(edit.data.status).toBe('hidden');

    // 재승인 — DRAFT 가 아니므로 승격하지 않는다: 셀러가 숨겨둔 선택을 관리자가 덮어쓰지 않는다
    const reapprove = await axios.patch(
      `/admin/products/${productId}/approve`, {}, auth(admin.accessToken),
    );
    expect(reapprove.status).toBe(200);
    expect(reapprove.data.approvalStatus).toBe('approved');
    expect(reapprove.data.status).toBe('hidden');

    // 단종 전환 후에는 공개 상세도 404 (EC7)
    await axios.patch(`/products/${productId}/status`, { status: 'discontinued' }, auth(sellerA.accessToken));
    const detail = await axios.get(`/products/${productId}`);
    expect(detail.status).toBe(404);

    // 단종 상품은 장바구니에 담을 수도 없다
    const cartAgain = await axios.post(
      '/cart/items', { productId, quantity: 1 }, auth(buyer.accessToken),
    );
    expect(cartAgain.status).toBe(400);
  }, 60_000);

  it('업로드 fileFilter: 비이미지는 400 — /uploads 정적 서빙의 저장형 XSS 벡터 차단', async () => {
    const create = await axios.post(
      '/products',
      { name: productName('업로드'), description: 'e2e', price: 1000, brand: 'e2e브랜드' },
      auth(sellerA.accessToken),
    );
    const productId = create.data.id as number;

    const upload = async (name: string, type: string, content: string) => {
      const form = new FormData();
      form.append('file', new Blob([content], { type }), name);
      return axios.post(`/products/${productId}/images`, form, auth(sellerA.accessToken));
    };

    // .html — 서빙되면 same-origin 스크립트 실행이 가능해진다
    const html = await upload('evil.html', 'text/html', '<script>alert(1)</script>');
    expect(html.status).toBe(400);

    // 확장자 위장(.html + image/png mimetype) — 확장자·mimetype 둘 다 봐야 한다
    const spoofExt = await upload('evil.html', 'image/png', 'fake');
    expect(spoofExt.status).toBe(400);

    // mimetype 위장(.png + text/html)
    const spoofMime = await upload('evil.png', 'text/html', 'fake');
    expect(spoofMime.status).toBe(400);

    // svg 는 스크립트를 품을 수 있어 의도적으로 제외
    const svg = await upload('img.svg', 'image/svg+xml', '<svg onload=alert(1)></svg>');
    expect(svg.status).toBe(400);

    // 정상 png 는 통과하고 /uploads URL 을 받는다
    const png = await upload('ok.png', 'image/png', 'png-bytes');
    expect(png.status).toBe(201);
    expect(png.data.url).toMatch(/^\/uploads\//);
    expect(png.data.isPrimary).toBe(true);
  }, 60_000);

  it('멀티셀러 주문: 배송건이 분리되고, 전원 출고 전까지 주문이 넘어가지 않으며, 정산도 셀러별이다', async () => {
    // A: 3,333원 × 3 = 9,999(반올림 경계) / B: 10,000원 × 1
    const productA = await createApprovedProduct(sellerA.accessToken, '멀티A', 3333);
    const productB = await createApprovedProduct(sellerB.accessToken, '멀티B', 10000);

    const cartA = await addToCart(productA, 3);
    const cartB = await addToCart(productB, 1);
    const orderNumber = await createOrder([cartA, cartB]);
    await simulatePaidOrder(ds, orderNumber);

    // 셀러A 목록에는 자기 items·shipments 만 실린다
    const aOrders = await axios.get('/seller/orders', {
      ...auth(sellerA.accessToken), params: { page: 1, take: 20, status: 'preparing' },
    });
    const aMine = aOrders.data.data.find((o: any) => o.orderNumber === orderNumber);
    expect(aMine.items).toHaveLength(1);
    expect(aMine.items[0].productId).toBe(productA);
    expect(aMine.shipments).toHaveLength(1);
    expect(aMine.shipments[0].sellerId).toBe(sellerAId);

    // A 출고 — B 가 남았으므로 주문은 PREPARING 유지
    const shipA = await axios.patch(
      `/seller/orders/${orderNumber}/ship`,
      { trackingNumber: 'A-0001', carrier: 'e2e택배' },
      auth(sellerA.accessToken),
    );
    expect(shipA.status).toBe(200);
    expect(shipA.data.status).toBe('preparing');

    // A 배송건만 부분 배송완료 — 주문은 여전히 PREPARING
    const deliverA = await axios.patch(
      `/admin/orders/${orderNumber}/deliver`, { sellerId: sellerAId }, auth(admin.accessToken),
    );
    expect(deliverA.status).toBe(200);
    expect(deliverA.data.status).toBe('preparing');
    const shipmentA = deliverA.data.shipments.find((s: any) => s.sellerId === sellerAId);
    const shipmentB = deliverA.data.shipments.find((s: any) => s.sellerId === sellerBId);
    expect(shipmentA.status).toBe('delivered');
    expect(shipmentB.status).toBe('preparing');

    // 전원 배송완료 전 구매확정은 400
    const confirmEarly = await axios.patch(
      `/orders/${orderNumber}/confirm`, {}, auth(buyer.accessToken),
    );
    expect(confirmEarly.status).toBe(400);

    // B 출고 → 모든 배송건이 SHIPPED 이상 → 주문 SHIPPED
    const shipB = await axios.patch(
      `/seller/orders/${orderNumber}/ship`,
      { trackingNumber: 'B-0001', carrier: 'e2e택배' },
      auth(sellerB.accessToken),
    );
    expect(shipB.data.status).toBe('shipped');

    // 나머지 전체 배송완료 → 주문 DELIVERED
    const deliverAll = await axios.patch(
      `/admin/orders/${orderNumber}/deliver`, {}, auth(admin.accessToken),
    );
    expect(deliverAll.data.status).toBe('delivered');

    // 구매확정 → 정산이 셀러별로 나뉘어 생성된다 (홀수 금액 반올림 포함)
    const confirm = await axios.patch(`/orders/${orderNumber}/confirm`, {}, auth(buyer.accessToken));
    expect(confirm.status).toBe(200);

    let settlements: any[] = [];
    for (let i = 0; i < 20; i++) {
      settlements = await ds.query(
        `SELECT * FROM settlements WHERE order_number = $1 ORDER BY seller_id`, [orderNumber],
      );
      if (settlements.length >= 2) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(settlements).toHaveLength(2);
    const settleA = settlements.find((s) => s.seller_id === sellerAId);
    const settleB = settlements.find((s) => s.seller_id === sellerBId);
    expect(Number(settleA.amount)).toBe(9999);
    expect(Number(settleA.commission_amount)).toBeCloseTo(999.9, 2);
    expect(Number(settleA.settlement_amount)).toBeCloseTo(8999.1, 2);
    expect(Number(settleB.amount)).toBe(10000);
    expect(Number(settleB.settlement_amount)).toBeCloseTo(9000, 2);

    // 데모 관리자는 정산 확정을 못 한다 (DemoAccountGuard) — 조회는 가능
    const demoList = await axios.get('/admin/settlements', {
      ...auth(demoAdmin.accessToken), params: { page: 1, take: 5 },
    });
    expect(demoList.status).toBe(200);
    const demoConfirm = await axios.patch(
      `/admin/settlements/${settleA.id}/confirm`, {}, auth(demoAdmin.accessToken),
    );
    expect(demoConfirm.status).toBe(403);
  }, 60_000);

  it('무셀러(seller_id NULL) 상품: 주문은 되지만 배송건·정산이 생기지 않는다 (§7-5)', async () => {
    const ownerless = await createOwnerlessPublishedProduct(ds, {
      name: productName('무셀러'), price: 5000,
    });
    const productA = await createApprovedProduct(sellerA.accessToken, '혼합A', 7000);

    // ① 혼합 주문(무셀러 + 셀러A)
    const cart0 = await addToCart(ownerless, 1);
    const cartA = await addToCart(productA, 1);
    const mixedOrder = await createOrder([cart0, cartA]);

    // orderItem 스냅샷: 무셀러 상품은 0 이 아니라 NULL 로 저장된다 (§7-5 핵심)
    const items = await ds.query(
      `SELECT oi.product_id, oi.seller_id FROM order_items oi
       JOIN orders o ON o.id = oi.order_id WHERE o.order_number = $1`,
      [mixedOrder],
    );
    expect(items.find((i: any) => i.product_id === ownerless).seller_id).toBeNull();
    expect(items.find((i: any) => i.product_id === productA).seller_id).toBe(sellerAId);

    await simulatePaidOrder(ds, mixedOrder);

    // 배송건은 셀러A 것 하나뿐 — A 출고만으로 주문이 SHIPPED 로 넘어간다
    const detail = await axios.get(`/admin/orders/${mixedOrder}`, auth(admin.accessToken));
    expect(detail.data.shipments).toHaveLength(1);
    const ship = await axios.patch(
      `/seller/orders/${mixedOrder}/ship`,
      { trackingNumber: 'M-0001', carrier: 'e2e택배' },
      auth(sellerA.accessToken),
    );
    expect(ship.data.status).toBe('shipped');
    await axios.patch(`/admin/orders/${mixedOrder}/deliver`, {}, auth(admin.accessToken));
    const confirm = await axios.patch(`/orders/${mixedOrder}/confirm`, {}, auth(buyer.accessToken));
    expect(confirm.status).toBe(200);

    // 정산은 셀러A 몫 1건만 — 무셀러 몫은 만들지 않는다
    let settlements: any[] = [];
    for (let i = 0; i < 20; i++) {
      settlements = await ds.query(
        `SELECT * FROM settlements WHERE order_number = $1`, [mixedOrder],
      );
      if (settlements.length > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(settlements).toHaveLength(1);
    expect(settlements[0].seller_id).toBe(sellerAId);
    expect(Number(settlements[0].amount)).toBe(7000);

    // ② 무셀러 전용 주문 — 배송건이 아예 없어 deliver 할 대상이 없다(404).
    //    주문이 PREPARING 에 갇히는 현재 설계의 한계를 명세로 고정해 둔다
    //    (실서비스라면 플랫폼 직배송 주체가 필요하다 — 로드맵 §7-5 메모 참고).
    const cartOnly0 = await addToCart(ownerless, 1);
    const ownerlessOrder = await createOrder([cartOnly0]);
    await simulatePaidOrder(ds, ownerlessOrder);
    const deliverNone = await axios.patch(
      `/admin/orders/${ownerlessOrder}/deliver`, {}, auth(admin.accessToken),
    );
    expect(deliverNone.status).toBe(404);
  }, 60_000);
});
