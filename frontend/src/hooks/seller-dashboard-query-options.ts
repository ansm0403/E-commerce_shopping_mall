'use client';

import { useQuery } from '@tanstack/react-query';
import { ApprovalStatus, InquiryStatus, OrderStatus, ProductStatus } from '@shopping-mall/shared';
import { inquiryQueryOptions } from '../lib/react-query/inquiry-query-options';
import { useMyProductsQuery } from './seller-product-query-options';
import { useSellerOrdersQuery } from './seller-order-query-options';
import { useMySettlementSummaryQuery } from './settlement-query-options';

/**
 * 셀러 대시보드(`/seller`) 쿼리 — 전용 집계 API 없이 기존 목록 API 를 조합한다(01-2 D4).
 *
 * - 건수는 목록 응답의 `meta.total` 에서 읽는다. `page` 를 빼면 백엔드가 커서 페이지네이션으로 분기해
 *   `meta.total` 이 사라지므로 **모든 호출에 `page: 1` 을 박아 둔다.**
 * - 쿼리 키는 각 목록 화면의 키를 그대로 쓴다 — 상품 게시 토글·배송 처리·문의 답변 뮤테이션의
 *   invalidate 가 대시보드 숫자에도 닿는다.
 * - 이 훅들은 `SellerGuard` 안쪽에서만 부른다(승인 직후의 낡은 토큰은 가드가 먼저 갱신한다).
 */

const FIRST_PAGE = 1;
/** 건수만 필요할 때 — 행은 1개만 받는다 */
const COUNT_ONLY = 1;
export const DASHBOARD_PRODUCT_TAKE = 10;
/** 최근 주문 표에 보여 줄 행 수 */
export const DASHBOARD_ORDER_TAKE = 5;
/** 일별 매출 그래프가 묶을 최근 주문 수 — 백엔드 take 상한(100) */
export const DASHBOARD_ORDER_SAMPLE = 100;

/** 판매 중(승인 + 게시) 상품 — 건수(KPI)와 표(최근 10개)가 같은 응답을 쓴다 */
export function useLiveProductsQuery() {
  return useMyProductsQuery({
    page: FIRST_PAGE,
    take: DASHBOARD_PRODUCT_TAKE,
    approvalStatus: ApprovalStatus.APPROVED,
    status: ProductStatus.PUBLISHED,
  });
}

export function usePendingProductCountQuery() {
  return useMyProductsQuery({
    page: FIRST_PAGE,
    take: COUNT_ONLY,
    approvalStatus: ApprovalStatus.PENDING,
  });
}

/** 출고 대기 = 결제가 끝나 운송장 입력을 기다리는 주문(주문/배송 화면의 기본 탭과 같은 조건) */
export function usePreparingOrderCountQuery() {
  return useSellerOrdersQuery({ page: FIRST_PAGE, take: COUNT_ONLY, status: OrderStatus.PREPARING });
}

export function useWaitingInquiryCountQuery() {
  return useQuery(inquiryQueryOptions.sellerInquiries(InquiryStatus.WAITING, { page: FIRST_PAGE, take: COUNT_ONLY }));
}

/** 최근 주문 100건 — 일별 매출 그래프(전부)와 최근 주문 표(앞의 5건)가 같은 응답을 쓴다 */
export function useRecentSellerOrdersQuery() {
  return useSellerOrdersQuery({ page: FIRST_PAGE, take: DASHBOARD_ORDER_SAMPLE });
}

export { useMySettlementSummaryQuery as useSellerSettlementSummaryQuery };

/**
 * 주문 상태 분포(도넛)용 — 상태별 건수. 훅 개수가 고정이라 상태마다 한 번씩 그대로 부른다.
 * "출고 대기"는 KPI 카드와 같은 쿼리(같은 키)라 호출이 겹치지 않는다. 늘어나는 호출은 5개.
 */
export function useSellerOrderStatusCountsQuery() {
  const count = (status: OrderStatus) => ({ page: FIRST_PAGE, take: COUNT_ONLY, status });
  const queries = {
    paid: useSellerOrdersQuery(count(OrderStatus.PAID)),
    preparing: useSellerOrdersQuery(count(OrderStatus.PREPARING)),
    shipped: useSellerOrdersQuery(count(OrderStatus.SHIPPED)),
    delivered: useSellerOrdersQuery(count(OrderStatus.DELIVERED)),
    completed: useSellerOrdersQuery(count(OrderStatus.COMPLETED)),
    cancelled: useSellerOrdersQuery(count(OrderStatus.CANCELLED)),
  };
  const all = Object.values(queries);
  const isLoading = all.some((q) => q.isLoading);
  const isError = all.some((q) => q.isError);
  const totals =
    isLoading || isError
      ? null
      : (Object.fromEntries(
          Object.entries(queries).map(([status, q]) => [status, q.data?.meta.total ?? 0]),
        ) as Record<keyof typeof queries, number>);
  return { totals, isLoading, isError };
}
