import type { Order, OrderQuery, PaginatedResponse } from '@shopping-mall/shared';
import { authClient } from '../lib/axios/axios-http-client';

/**
 * 관리자 주문 관리 (02-admin-core §2-A③).
 *   GET   /admin/orders                          (ADMIN) — 전체 주문 + 상태 필터
 *   GET   /admin/orders/:orderNumber             (ADMIN) — 상세(items·shipments·payment)
 *   PATCH /admin/orders/:orderNumber/deliver     (ADMIN + DemoAccountGuard)
 *
 * deliver 는 sellerId 를 주면 해당 셀러의 배송건만, 생략하면 SHIPPED 전부를 완료 처리한다.
 * 모든 shipment 가 DELIVERED 가 되면 주문도 DELIVERED 로 동기화된다(백엔드 트랜잭션).
 */

export type AdminOrdersResponse = PaginatedResponse<Order>;

export async function fetchAdminOrders(query: OrderQuery) {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    take: query.take ?? 20,
  };
  if (query.status) params.status = query.status;
  return authClient.get<AdminOrdersResponse>('/admin/orders', { params });
}

export async function fetchAdminOrder(orderNumber: string) {
  return authClient.get<Order>(`/admin/orders/${orderNumber}`);
}

export async function deliverOrder(orderNumber: string, sellerId?: number) {
  return authClient.patch<Order>(
    `/admin/orders/${orderNumber}/deliver`,
    sellerId != null ? { sellerId } : {},
  );
}
