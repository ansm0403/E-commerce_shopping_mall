import SellerKpiCards from './components/dashboard/SellerKpiCards';
import SellerOrderStatusChart from './components/dashboard/SellerOrderStatusChart';
import SellerLiveProducts from './components/dashboard/SellerLiveProducts';
import SellerRecentOrders from './components/dashboard/SellerRecentOrders';
import SellerSalesChart from './components/dashboard/SellerSalesChart';
import SellerTopProductsChart from './components/dashboard/SellerTopProductsChart';
import SellerSettlementSummary from './components/dashboard/SellerSettlementSummary';

/**
 * 셀러 대시보드 `/seller` — 셀러 센터의 첫 화면(01-2 §3-2).
 * 위에서부터 "지금 할 일"(KPI 4장) → 일별 매출 그래프 → 주문 상태 분포·상품별 매출 → 정산 → 판매 중 상품 → 최근 주문.
 * 전용 집계 API 없이 기존 목록 API 를 조합한다(hooks/seller-dashboard-query-options.ts).
 */
export default function SellerDashboardPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>대시보드</h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          내 상점의 판매 현황과 지금 처리할 일을 한눈에 본다. 카드를 누르면 해당 목록으로 이동한다.
        </p>
      </header>

      <SellerKpiCards />
      <SellerSalesChart />
      {/* 두 그래프는 넓으면 나란히, 좁으면 위아래로 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        <SellerOrderStatusChart />
        <SellerTopProductsChart />
      </div>
      <SellerSettlementSummary />
      <SellerLiveProducts />
      <SellerRecentOrders />
    </div>
  );
}
