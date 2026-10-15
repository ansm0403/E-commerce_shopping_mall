import axios from 'axios';
import { DataSource } from 'typeorm';
import { cleanupE2eEverything, createApprovedSeller, createDataSource, createUser, e2ePrefix, simulatePaidOrder } from '../support/db';
import { resetLoginRateLimits } from '../support/redis';
import { login } from '../support/login';
import { addToCart, auth, createApprovedProduct, createOrder, expectRejectedAndUnchanged, rowOf } from '../support/commerce';

/**
 * 객체 경계(§4 A) — 셀러가 **다른 셀러의** 상품·배송건·문의·정산을 건드린다.
 * (docs/roadmap/ex-security-api-boundary.md §4 시나리오 A, 셀러 편)
 *
 * 기존 스펙이 이미 다루는 것은 만들지 않는다(§4 규칙):
 *   · 다른 셀러 상품의 단건 조회·수정·상태 변경 403 → seller-edge-cases "소유권·게시 가드"
 *   · 다른 셀러 문의에 답변 403 → seller-inquiry
 * 여기서 새로 보는 것: 상품 삭제·이미지 업로드, 배송건 출고·배송완료, 목록 API 의 격리(주문·문의·정산).
 */

const SUITE = 'obj-seller';
const p = e2ePrefix(SUITE);
const emails = {
  sellerA: `${p}seller-a@test.local`, // 공격자
  sellerB: `${p}seller-b@test.local`, // 피해자
  admin: `${p}admin@test.local`,
  buyer: `${p}buyer@test.local`,
};

describe('객체 경계: 셀러가 다른 셀러의 상품·배송건·문의·정산에 접근 (HTTP e2e)', () => {
  let ds: DataSource;
  let sellerA: string;
  let sellerAId: number;
  let sellerBId: number;
  let productB: number;
  let orderB: string; // 셀러 B 상품의 결제 완료 주문(배송건 preparing)
  let inquiryB: number;

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();
    await cleanupE2eEverything(ds, SUITE);
    await resetLoginRateLimits();

    const userA = await createUser(ds, { email: emails.sellerA, role: 'seller' });
    sellerAId = await createApprovedSeller(ds, { userId: userA, businessName: `${p}A상회`, businessNumber: '999-33-00001' });
    const userB = await createUser(ds, { email: emails.sellerB, role: 'seller' });
    sellerBId = await createApprovedSeller(ds, { userId: userB, businessName: `${p}B상회`, businessNumber: '999-33-00002' });
    await createUser(ds, { email: emails.admin, role: 'admin' });
    await createUser(ds, { email: emails.buyer, role: 'buyer' });

    sellerA = (await login(emails.sellerA)).accessToken;
    const sellerB = (await login(emails.sellerB)).accessToken;
    const admin = (await login(emails.admin)).accessToken;
    const buyer = (await login(emails.buyer)).accessToken;

    productB = await createApprovedProduct(sellerB, admin, { name: `${p}B상품`, price: 9900 });
    orderB = await createOrder(buyer, [await addToCart(buyer, productB, 1)]);
    await simulatePaidOrder(ds, orderB); // 셀러 B 의 배송건(preparing) 생성
    const inquiry = await axios.post('/inquiries', { productId: productB, title: 'B 상품 문의', content: '재입고?' }, auth(buyer));
    if (inquiry.status !== 201) throw new Error(`문의 작성 실패 ${inquiry.status} ${JSON.stringify(inquiry.data)}`);
    inquiryB = inquiry.data.id;
  }, 120_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanupE2eEverything(ds, SUITE);
      await ds.destroy();
    }
  });

  const shipmentRow = () => rowOf(ds, 'shipments', 'order_id = (SELECT id FROM orders WHERE order_number = $1)', [orderB]);

  it('A-9 다른 셀러의 상품 삭제 → 거절, 상품 불변', async () => {
    const before = await rowOf(ds, 'products', 'id = $1', [productB]);
    const res = await axios.delete(`/products/${productB}`, auth(sellerA));
    expectRejectedAndUnchanged(res, before, await rowOf(ds, 'products', 'id = $1', [productB]));
  });

  it('A-10 다른 셀러의 상품에 이미지 업로드 → 거절, 이미지 행 없음', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'e2e.png');
    const res = await axios.post(`/products/${productB}/images`, form, auth(sellerA));
    expect([403, 404]).toContain(res.status);
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM product_images WHERE "productId" = $1`, [productB]);
    expect(n).toBe(0);
  });

  it('A-11 다른 셀러의 배송건 출고·배송완료 → 거절, 배송건 불변(preparing)', async () => {
    const before = await shipmentRow();
    expect(before).toMatchObject({ seller_id: sellerBId, status: 'preparing' });
    const ship = await axios.patch(`/seller/orders/${orderB}/ship`, { trackingNumber: 'HIJACK-1', carrier: 'e2e택배' }, auth(sellerA));
    expectRejectedAndUnchanged(ship, before, await shipmentRow());
    const deliver = await axios.patch(`/seller/orders/${orderB}/deliver`, {}, auth(sellerA));
    expectRejectedAndUnchanged(deliver, before, await shipmentRow());
  });

  it('A-12 목록 API 는 내 것만 — 주문·문의·정산에 다른 셀러의 데이터가 없다', async () => {
    const orders = await axios.get('/seller/orders', { ...auth(sellerA), params: { page: 1, take: 50 } });
    expect(orders.status).toBe(200);
    expect(JSON.stringify(orders.data)).not.toContain(orderB);

    const inquiries = await axios.get('/seller/inquiries', { ...auth(sellerA), params: { page: 1, take: 50 } });
    expect(inquiries.status).toBe(200);
    expect((inquiries.data.data ?? []).some((i: any) => i.id === inquiryB)).toBe(false);

    const settlements = await axios.get('/seller/settlements', { ...auth(sellerA), params: { page: 1, take: 50 } });
    expect(settlements.status).toBe(200);
    for (const s of settlements.data.data ?? []) expect(s.sellerId ?? sellerAId).toBe(sellerAId);
  });
});
