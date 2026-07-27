import type {
  AdminProduct,
  AdminProductQuery,
  ApprovalStatus,
  PaginatedResponse,
  ProductStatus,
} from '@shopping-mall/shared';
import { authClient } from '../lib/axios/axios-http-client';

/**
 * 관리자 상품 승인/반려 (02-admin-core §2-A②).
 *   GET   /admin/products            (ADMIN)
 *   PATCH /admin/products/:id/approve (ADMIN + DemoAccountGuard)
 *   PATCH /admin/products/:id/reject  (ADMIN + DemoAccountGuard, reason 필수)
 *
 * 승인/반려는 백엔드에서 트랜잭션으로 처리되고 Redis 상품 캐시까지 무효화된다
 * (product.service.ts approve/reject) — 승인 즉시 구매자 목록에 반영된다는 뜻.
 */

export type AdminProductsResponse = PaginatedResponse<AdminProduct>;

export async function fetchAdminProducts(query: AdminProductQuery) {
  const params: Record<string, string | number> = {
    // page 를 빼면 백엔드가 커서 페이지네이션으로 분기한다(CommonService.paginate).
    page: query.page ?? 1,
    take: query.take ?? 20,
  };
  if (query.approvalStatus) params.approvalStatus = query.approvalStatus;
  if (query.status) params.status = query.status;
  if (query.categoryId != null) params.categoryId = query.categoryId;
  if (query.sellerId != null) params.sellerId = query.sellerId;
  return authClient.get<AdminProductsResponse>('/admin/products', { params });
}

export async function approveProduct(id: number) {
  return authClient.patch<AdminProduct>(`/admin/products/${id}/approve`);
}

export async function rejectProduct(id: number, reason: string) {
  return authClient.patch<AdminProduct>(`/admin/products/${id}/reject`, { reason });
}

// ──────────────────────────────────────────────
// 표시용 메타
// ──────────────────────────────────────────────

export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  pending: '승인 대기',
  approved: '승인',
  rejected: '반려',
};

/** 판매 상태 — 승인 상태와 별개 축이다(승인됐어도 셀러가 숨김 처리할 수 있다) */
export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  draft: '작성 중',
  published: '판매 중',
  sold_out: '품절',
  hidden: '숨김',
  discontinued: '단종',
};

export function approvalStatusLabel(status: ApprovalStatus | string): string {
  return APPROVAL_STATUS_LABELS[status] ?? status;
}

export function productStatusLabel(status: ProductStatus | string): string {
  return PRODUCT_STATUS_LABELS[status] ?? status;
}

/** 백엔드가 decimal 을 문자열로 줄 수 있어 숫자 변환 후 포맷 */
export function formatPrice(price: number | string): string {
  const value = typeof price === 'string' ? Number(price) : price;
  return Number.isFinite(value) ? `${value.toLocaleString('ko-KR')}원` : '-';
}

/** 대표 이미지(없으면 첫 장) */
export function primaryImageUrl(product: AdminProduct): string | null {
  if (!product.images || product.images.length === 0) return null;
  return (product.images.find((img) => img.isPrimary) ?? product.images[0]).url;
}
