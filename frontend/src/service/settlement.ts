import type {
  Settlement,
  SettlementPageMeta,
  SettlementQuery,
  SettlementStatus,
  SettlementSummary,
} from '@shopping-mall/shared';
import { authClient } from '../lib/axios/axios-http-client';
import type { AdminPageMeta } from '../app/(admin)/admin/components/table-ui';

/**
 * 셀러 정산 조회 (01-seller-core §1-A④).
 *   GET /seller/settlements          (SELLER) — 내 정산 내역(상태·기간 필터)
 *   GET /seller/settlements/summary  (SELLER) — 누적/대기/확정/지급 요약
 *
 * 정산 레코드는 구매 확정(order.completed) 시 자동 생성된다(PENDING, 수수료 10%)
 * — settlement-event.listener.ts. 이후 전이는 관리자만: confirm → pay.
 */

export interface SettlementsResponse {
  data: Settlement[];
  meta: SettlementPageMeta;
}

export async function fetchMySettlements(query: SettlementQuery) {
  const params: Record<string, string | number> = {
    page: query.page ?? 1,
    take: query.take ?? 20,
  };
  if (query.status) params.status = query.status;
  if (query.startDate) params.startDate = query.startDate;
  if (query.endDate) params.endDate = query.endDate;
  return authClient.get<SettlementsResponse>('/seller/settlements', { params });
}

export async function fetchMySettlementSummary() {
  return authClient.get<SettlementSummary>('/seller/settlements/summary');
}

// ──────────────────────────────────────────────
// 표시용 메타 (관리자 화면과 공유)
// ──────────────────────────────────────────────

export const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  pending: '정산 대기',
  confirmed: '정산 확정',
  paid: '지급 완료',
};

export function settlementStatusLabel(status: SettlementStatus | string): string {
  return SETTLEMENT_STATUS_LABELS[status] ?? status;
}

/** 정산 meta(totalPages)를 공용 AdminPagination meta(lastPage/hasNextPage)로 변환 */
export function toAdminPageMeta(meta: SettlementPageMeta | undefined): AdminPageMeta | undefined {
  if (!meta) return undefined;
  return {
    total: meta.total,
    page: meta.page,
    lastPage: meta.totalPages,
    hasNextPage: meta.page < meta.totalPages,
  };
}
