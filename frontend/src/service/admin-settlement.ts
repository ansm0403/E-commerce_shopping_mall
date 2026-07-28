import type { Settlement, SettlementQuery } from '@shopping-mall/shared';
import { authClient } from '../lib/axios/axios-http-client';
import type { SettlementsResponse } from './settlement';

/**
 * 관리자 정산 확인/지급 (02-admin-core §2-A④).
 *   GET   /admin/settlements             (ADMIN) — 전체 정산(상태·셀러·기간 필터, seller 요약 포함)
 *   PATCH /admin/settlements/:id/confirm (ADMIN + DemoAccountGuard) — PENDING → CONFIRMED
 *   PATCH /admin/settlements/:id/pay     (ADMIN + DemoAccountGuard) — CONFIRMED → PAID
 */

export async function fetchAdminSettlements(query: SettlementQuery) {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    take: query.take ?? 20,
  };
  if (query.status) params.status = query.status;
  if (query.sellerId != null) params.sellerId = query.sellerId;
  if (query.startDate) params.startDate = query.startDate;
  if (query.endDate) params.endDate = query.endDate;
  return authClient.get<SettlementsResponse>('/admin/settlements', { params });
}

export async function confirmSettlement(id: number) {
  return authClient.patch<Settlement>(`/admin/settlements/${id}/confirm`);
}

export async function paySettlement(id: number) {
  return authClient.patch<Settlement>(`/admin/settlements/${id}/pay`);
}
