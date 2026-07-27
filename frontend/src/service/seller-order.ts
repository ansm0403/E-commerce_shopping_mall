import type {
  Order,
  OrderQuery,
  OrderStatus,
  PaginatedResponse,
  ShipOrderRequest,
  ShipmentStatus,
} from '@shopping-mall/shared';
import { authClient } from '../lib/axios/axios-http-client';

/**
 * 셀러 주문/배송 (01-seller-core §1-A③).
 *   GET   /seller/orders                       (SELLER) — 내 상품이 포함된 주문(items 는 내 것만)
 *   PATCH /seller/orders/:orderNumber/ship     (SELLER) — 운송장 입력(내 Shipment PREPARING → SHIPPED)
 *
 * 응답의 shipments 도 본인 것만 실려 온다(getSellerOrders 조인 필터) — 배송 처리 버튼은
 * "내 shipment 가 PREPARING 인가"로 판단한다. shipment 는 결제 완료 시점에 생성되므로
 * 결제 전(pending_payment) 주문은 빈 배열이 정상이다.
 */

export type SellerOrdersResponse = PaginatedResponse<Order>;

export async function fetchSellerOrders(query: OrderQuery) {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    take: query.take ?? 20,
  };
  if (query.status) params.status = query.status;
  return authClient.get<SellerOrdersResponse>('/seller/orders', { params });
}

export async function shipOrder(orderNumber: string, dto: ShipOrderRequest) {
  return authClient.patch<Order>(`/seller/orders/${orderNumber}/ship`, dto);
}

// ──────────────────────────────────────────────
// 표시용 메타 (관리자 주문 화면도 같은 라벨을 쓴다)
// ──────────────────────────────────────────────

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: '결제 대기',
  paid: '결제 완료',
  preparing: '준비 중',
  shipped: '배송 중',
  delivered: '배송 완료',
  completed: '구매 확정',
  cancelled: '취소됨',
};

export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  preparing: '출고 대기',
  shipped: '배송 중',
  delivered: '배송 완료',
};

export function orderStatusLabel(status: OrderStatus | string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

export function shipmentStatusLabel(status: ShipmentStatus | string): string {
  return SHIPMENT_STATUS_LABELS[status] ?? status;
}

/** decimal 문자열 방어(admin-product formatPrice 와 같은 이유) */
export function formatAmount(value: number | string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? `${num.toLocaleString('ko-KR')}원` : '-';
}
