'use client';

import dynamic from 'next/dynamic';
import {
  DASHBOARD_ORDER_SAMPLE,
  useRecentSellerOrdersQuery,
} from '../../../../../hooks/seller-dashboard-query-options';
import { aggregateDailySales, buildSellerSalesOption } from '../../../../../lib/charts/seller-sales';
import { formatAmount } from '../../../../../service/seller-order';
import { panelStyle } from './dashboard-ui';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const CHART_HEIGHT = 280;
const MAX_DAYS = 14;

/**
 * 일별 매출 그래프(막대 = 내 매출, 선 = 주문 수) — "최근 주문" 표와 같은 응답(최근 100건)을 날짜별로 묶는다.
 * X축은 주문이 있던 날이고, 목록이 잘렸으면 그 사실을 부제에 적는다(lib/charts/seller-sales.ts).
 * 캔버스는 스크린리더가 읽지 못하므로 기간·합계를 `aria-label` 로 요약한다.
 */
export default function SellerSalesChart() {
  const { data, isLoading, isError } = useRecentSellerOrdersQuery();

  const truncated = !!data && data.meta.total > data.data.length;
  const days = data ? aggregateDailySales(data.data, { truncated, maxDays: MAX_DAYS }) : [];
  const revenue = days.reduce((sum, day) => sum + day.revenue, 0);
  const orders = days.reduce((sum, day) => sum + day.orders, 0);
  const period = days.length > 0 ? `${days[0].date} ~ ${days[days.length - 1].date}` : '';

  return (
    <section style={{ ...panelStyle, padding: '16px' }} aria-label="일별 매출">
      <div style={{ marginBottom: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>일별 매출</h2>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>
          {days.length > 0
            ? `${period} · 주문이 있던 최근 ${days.length}일 · 합계 ${formatAmount(revenue)} / ${orders.toLocaleString('ko-KR')}건`
            : '주문이 있던 날의 내 매출과 주문 수'}
          {' · 취소·결제 대기 제외'}
          {truncated && ` · 최근 주문 ${DASHBOARD_ORDER_SAMPLE}건 기준`}
        </p>
      </div>

      {isLoading && <div style={{ height: CHART_HEIGHT, background: '#f1f5f9', borderRadius: 8 }} />}
      {isError && <p style={{ ...messageStyle, color: '#dc2626' }}>매출 그래프를 불러오지 못했습니다.</p>}
      {!isLoading && !isError && days.length === 0 && (
        <p style={messageStyle}>아직 매출이 잡힌 주문이 없습니다. 결제가 완료된 주문부터 여기에 그려집니다.</p>
      )}
      {days.length > 0 && (
        <div
          role="img"
          aria-label={`일별 매출 그래프. ${period}, 주문이 있던 ${days.length}일. 매출 합계 ${formatAmount(revenue)}, 주문 ${orders}건.`}
        >
          <ReactECharts
            option={buildSellerSalesOption(days)}
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
