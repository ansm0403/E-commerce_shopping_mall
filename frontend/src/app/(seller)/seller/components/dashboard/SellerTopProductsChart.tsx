'use client';

import dynamic from 'next/dynamic';
import {
  DASHBOARD_ORDER_SAMPLE,
  useRecentSellerOrdersQuery,
} from '../../../../../hooks/seller-dashboard-query-options';
import { aggregateTopProducts, buildTopProductsOption } from '../../../../../lib/charts/seller-sales';
import { formatAmount } from '../../../../../service/seller-order';
import { panelStyle } from './dashboard-ui';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const CHART_HEIGHT = 260;
const TOP_N = 5;

/**
 * 상품별 매출 TOP 5(가로 막대) — 일별 매출 그래프와 같은 응답(최근 주문 100건)을 상품별로 묶는다.
 * 주문이 100건을 넘으면 전체 기간의 순위가 아니므로 그 사실을 부제에 적는다.
 */
export default function SellerTopProductsChart() {
  const { data, isLoading, isError } = useRecentSellerOrdersQuery();

  const truncated = !!data && data.meta.total > data.data.length;
  const products = data ? aggregateTopProducts(data.data, TOP_N) : [];

  return (
    <section style={{ ...panelStyle, minWidth: 0, padding: '16px' }} aria-label="상품별 매출">
      <div style={{ marginBottom: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>상품별 매출 TOP {TOP_N}</h2>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
          {truncated ? `최근 주문 ${DASHBOARD_ORDER_SAMPLE}건 기준` : '전체 주문 기준'} · 취소·결제 대기 제외
        </p>
      </div>

      {isLoading && <div style={{ height: CHART_HEIGHT, background: '#f1f5f9', borderRadius: 8 }} />}
      {isError && <p style={{ ...messageStyle, color: '#dc2626' }}>상품별 매출을 불러오지 못했습니다.</p>}
      {!isLoading && !isError && products.length === 0 && (
        <p style={messageStyle}>아직 팔린 상품이 없습니다.</p>
      )}
      {products.length > 0 && (
        <div
          role="img"
          aria-label={`상품별 매출 그래프. ${products
            .map((p, i) => `${i + 1}위 ${p.name} ${formatAmount(p.revenue)}`)
            .join(', ')}.`}
        >
          <ReactECharts
            option={buildTopProductsOption(products)}
            notMerge
            style={{ height: CHART_HEIGHT }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      )}
    </section>
  );
}

const messageStyle: React.CSSProperties = {
  margin: 0,
  padding: '24px 0',
  fontSize: '13px',
  color: '#64748b',
};
