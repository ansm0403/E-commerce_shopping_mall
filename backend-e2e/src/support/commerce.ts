/* eslint-disable */
import axios from 'axios';
import { DataSource } from 'typeorm';
import { simulatePaidOrder } from './db';

/**
 * 경계 시나리오(src/security)가 공유하는 상거래 흐름 — 전부 실제 HTTP 로 만든다.
 * (seller-edge-cases 스펙의 헬퍼를 공용으로 뽑은 것. 검증 대상이 아닌 "준비"만 여기서 한다)
 */

export const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/** 화면(checkout)이 보내는 주문 폼 — CreateOrderRequest 의 필수 키 */
export const ORDER_FORM = {
  shippingAddress: '서울시 테스트구 경계로 1',
  recipientName: 'e2e구매자',
  recipientPhone: '01000000000',
};

/** 셀러가 상품 등록 → 관리자 승인(=게시). 돌려주는 값은 상품 id */
export async function createApprovedProduct(
  sellerToken: string,
  adminToken: string,
  body: { name: string; price: number; stockQuantity?: number },
): Promise<number> {
  const create = await axios.post(
    '/products',
    { name: body.name, description: 'e2e 경계 검증 상품', price: body.price, brand: 'e2e브랜드', stockQuantity: body.stockQuantity ?? 10 },
    auth(sellerToken),
  );
  if (create.status !== 201) throw new Error(`상품 등록 실패 ${create.status} ${JSON.stringify(create.data)}`);
  const approve = await axios.patch(`/admin/products/${create.data.id}/approve`, {}, auth(adminToken));
  if (approve.status !== 200) throw new Error(`상품 승인 실패 ${approve.status} ${JSON.stringify(approve.data)}`);
  return create.data.id as number;
}

/** 장바구니에 담고 cartItem id 를 돌려준다 */
export async function addToCart(buyerToken: string, productId: number, quantity = 1): Promise<number> {
  const res = await axios.post('/cart/items', { productId, quantity }, auth(buyerToken));
  if (res.status !== 201) throw new Error(`장바구니 담기 실패 ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.items.find((i: any) => i.productId === productId).id as number;
}

/** 주문 생성(결제 대기) → orderNumber */
export async function createOrder(buyerToken: string, cartItemIds: number[]): Promise<string> {
  const res = await axios.post('/orders', { cartItemIds, ...ORDER_FORM }, auth(buyerToken));
  if (res.status !== 201) throw new Error(`주문 생성 실패 ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.orderNumber as string;
}

/** 결제 완료(DB 시뮬레이션) → 셀러 출고 → 관리자 배송완료 → 구매자 구매확정. 리뷰를 쓸 수 있는 상태가 된다 */
export async function completeOrder(
  ds: DataSource,
  p: { orderNumber: string; sellerToken: string; adminToken: string; buyerToken: string },
): Promise<void> {
  await simulatePaidOrder(ds, p.orderNumber);
  const ship = await axios.patch(
    `/seller/orders/${p.orderNumber}/ship`,
    { trackingNumber: `E2E-${p.orderNumber.slice(-6)}`, carrier: 'e2e택배' },
    auth(p.sellerToken),
  );
  if (ship.status !== 200) throw new Error(`출고 실패 ${ship.status} ${JSON.stringify(ship.data)}`);
  const deliver = await axios.patch(`/admin/orders/${p.orderNumber}/deliver`, {}, auth(p.adminToken));
  if (deliver.status !== 200) throw new Error(`배송완료 실패 ${deliver.status} ${JSON.stringify(deliver.data)}`);
  const confirm = await axios.patch(`/orders/${p.orderNumber}/confirm`, {}, auth(p.buyerToken));
  if (confirm.status !== 200) throw new Error(`구매확정 실패 ${confirm.status} ${JSON.stringify(confirm.data)}`);
}

/** 단일 행 스냅샷(SELECT *). 시나리오 전후 비교용 — 없으면 null */
export async function rowOf(ds: DataSource, table: string, where: string, params: unknown[]): Promise<Record<string, unknown> | null> {
  const rows = await ds.query(`SELECT * FROM ${table} WHERE ${where}`, params);
  return rows[0] ?? null;
}

/** 거절(403/404) 뒤에 행이 그대로인지 — "거절했지만 일부는 저장됨" 을 잡는다 */
export function expectRejectedAndUnchanged(res: { status: number }, before: unknown, after: unknown) {
  expect([403, 404]).toContain(res.status);
  expect(after).toEqual(before);
}
