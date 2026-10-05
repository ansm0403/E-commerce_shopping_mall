'use client';

import dynamic from 'next/dynamic';
import { useSellerOrderStatusCountsQuery } from '../../../../../hooks/seller-dashboard-query-options';
import {
  buildOrderStatusOption,
  SELLER_ORDER_STATUS_SLICES,
  type OrderStatusCount,
} from '../../../../../lib/charts/seller-order-status';
import { panelStyle, SectionHeader } from './dashboard-ui';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const CHART_HEIGHT = 260;

/**
 * 주문 상태 분포(도넛) — 내 상품이 들어간 주문이 지금 어느 단계에 있는가.
 * 값은 상태별 `meta.total` 이라 전체 주문을 정확히 센다. 캔버스 대신 읽을 수 있게 `aria-label` 에 건수를 적는다.
 */
export default function SellerOrderStatusChart() {
  const { totals, isLoading, isError } = useSellerOrderStatusCountsQuery();

  const counts: OrderStatusCount[] = totals
    ? SELLER_ORDER_STATUS_SLICES.map(({ status, label }) => ({ status, label, total: totals[status] }))
    : [];
  const sum = counts.reduce((acc, c) => acc + c.total, 0);

  return (
    <section style={{ ...panelStyle, minWidth: 0 }} aria-label="주문 상태 분포">
      <SectionHeader title="주문 상태 분포" href="/seller/orders?status=all" linkLabel="주문 전체" />
      <div style={{ padding: '0 16px 16px' }}>
        {isLoading && <div style={{ height: CHART_HEIGHT, background: '#f1f5f9', borderRadius: 8 }} />}
        {isError && <p style={{ ...messageStyle, color: '#dc2626' }}>주문 상태를 불러오지 못했습니다.</p>}
        {totals && sum === 0 && <p style={messageStyle}>아직 들어온 주문이 없습니다.</p>}
        {totals && sum > 0 && (
          <div
            role="img"
            aria-label={`주문 상태 분포 그래프. 전체 ${sum}건. ${counts.map((c) => `${c.label} ${c.total}건`).join(', ')}.`}
          >
            <ReactECharts
              option={buildOrderStatusOption(counts)}
              notMerge
              style={{ height: CHART_HEIGHT }}
              opts={{ renderer: 'canvas' }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

const messageStyle: React.CSSProperties = {
  margin: 0,
  padding: '24px 0',
  fontSize: '13px',
  color: '#64748b',
};
