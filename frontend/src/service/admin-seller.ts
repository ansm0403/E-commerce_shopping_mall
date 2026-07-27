import type {
  PaginatedResponse,
  SellerApplicationQuery,
  SellerApplicationWithUser,
  SellerStatus,
} from '@shopping-mall/shared';
import { authClient } from '../lib/axios/axios-http-client';

/**
 * 관리자 셀러 신청 관리 (02-admin-core §2-A①).
 * 백엔드 SellerController — 전역 prefix /v1 은 axios baseURL 에 포함된다.
 *   GET   /seller/applications            (ADMIN)
 *   PATCH /seller/applications/:id/approve (ADMIN + DemoAccountGuard)
 *   PATCH /seller/applications/:id/reject  (ADMIN + DemoAccountGuard, reason 필수)
 *
 * 은행정보 3필드는 SellerEntity 에서 @Exclude() 라 응답에 실리지 않는다 —
 * 관리자 화면에서도 계좌는 노출하지 않는 것이 원래 설계.
 */

export type SellerApplicationsResponse = PaginatedResponse<SellerApplicationWithUser>;

export async function fetchSellerApplications(query: SellerApplicationQuery) {
  const params: Record<string, string | number> = {
    // page 를 빼면 백엔드가 커서 페이지네이션으로 분기한다(CommonService.paginate).
    page: query.page ?? 1,
    take: query.take ?? 20,
  };
  if (query.status) params.status = query.status;
  return authClient.get<SellerApplicationsResponse>('/seller/applications', { params });
}

export async function approveSellerApplication(id: number) {
  return authClient.patch<{ message: string }>(`/seller/applications/${id}/approve`);
}

export async function rejectSellerApplication(id: number, reason: string) {
  return authClient.patch<{ message: string }>(`/seller/applications/${id}/reject`, { reason });
}

// ──────────────────────────────────────────────
// 표시용 메타
// ──────────────────────────────────────────────

export const SELLER_STATUS_LABELS: Record<string, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '반려',
};

export function sellerStatusLabel(status: SellerStatus | string): string {
  return SELLER_STATUS_LABELS[status] ?? status;
}

/** `1234567890` → `123-45-67890` (백엔드는 하이픈 포함 저장이지만 방어적으로 포맷) */
export function formatBusinessNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 10) return value;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}
