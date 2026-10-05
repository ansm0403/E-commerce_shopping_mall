'use client';

import Link from 'next/link';
import {
  useLiveProductsQuery,
  usePendingProductCountQuery,
  usePreparingOrderCountQuery,
  useWaitingInquiryCountQuery,
} from '../../../../../hooks/seller-dashboard-query-options';
import { panelStyle } from './dashboard-ui';

/** 4장이 폭에 맞춰 4열 → 2열(폰 2×2)로 접힌다 — 관리자 KpiCards 와 같은 격자 */
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: '16px',
};

interface CountQuery {
  data?: { meta: { total: number } };
  isLoading: boolean;
  isError: boolean;
}

/**
 * 셀러 대시보드 KPI 4장 — 값은 각 목록 API 의 `meta.total`, 카드를 누르면 그 목록으로 간다.
 * 카드마다 따로 조회하므로 하나가 실패해도 나머지는 그려진다.
 * "출고 대기"·"미답변 문의"는 셀러가 **할 일**이라 1건 이상이면 색으로 띄운다.
 */
export default function SellerKpiCards() {
  const liveProducts = useLiveProductsQuery();
  const pendingProducts = usePendingProductCountQuery();
  const preparingOrders = usePreparingOrderCountQuery();
  const waitingInquiries = useWaitingInquiryCountQuery();

  return (
    <div style={gridStyle}>
      <KpiCard
        label="판매 중 상품"
        hint="상점에 보이는 상품"
        href="/seller/products?approvalStatus=approved"
        query={liveProducts}
      />
      <KpiCard
        label="승인 대기 상품"
        hint="관리자 심사 중"
        href="/seller/products?approvalStatus=pending"
        query={pendingProducts}
      />
      <KpiCard
        label="출고 대기 주문"
        hint="운송장을 입력할 주문"
        href="/seller/orders"
        query={preparingOrders}
        todo
      />
      <KpiCard
        label="미답변 문의"
        hint="답변을 기다리는 구매자"
        href="/seller/inquiries"
        query={waitingInquiries}
        todo
      />
    </div>
  );
}

function KpiCard({
  label,
  hint,
  href,
  query,
  todo = false,
}: {
  label: string;
  hint: string;
  href: string;
  query: CountQuery;
  /** 할 일 카드 — 1건 이상이면 강조한다 */
  todo?: boolean;
}) {
  const total = query.data?.meta.total;
  const needsAction = todo && typeof total === 'number' && total > 0;

  return (
    <Link
      href={href}
      className="block transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
      style={{
        ...panelStyle,
        padding: '20px',
        minWidth: 0,
        textDecoration: 'none',
        borderLeft: `4px solid ${needsAction ? '#f59e0b' : 'transparent'}`,
      }}
    >
      <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>{label}</div>
      <div
        style={{
          fontSize: '26px',
          fontWeight: 700,
          color: needsAction ? '#b45309' : '#0f172a',
          marginTop: '8px',
          letterSpacing: '-0.5px',
          minHeight: '39px',
        }}
      >
        {query.isLoading ? (
          <span
            aria-label="불러오는 중"
            style={{ display: 'inline-block', width: '56px', height: '26px', borderRadius: '6px', background: '#e2e8f0' }}
          />
        ) : query.isError || typeof total !== 'number' ? (
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#dc2626' }}>불러오지 못함</span>
        ) : (
          `${total.toLocaleString('ko-KR')}건`
        )}
      </div>
      <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>{hint} →</div>
    </Link>
  );
}
