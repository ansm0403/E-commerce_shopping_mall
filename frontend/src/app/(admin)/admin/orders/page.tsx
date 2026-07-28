import { Suspense } from 'react';
import OrderFilters from './components/OrderFilters';
import OrderTable from './components/OrderTable';

/**
 * 관리자 전체 주문 관리 (02-admin-core §2-A③).
 * 데이터 출처는 GET /v1/admin/orders (ADMIN 전용, 상태 필터 + 페이지 페이지네이션).
 * 배송완료 처리는 상세(/admin/orders/[orderNumber])에서 배송건 단위로 한다.
 */
export default function AdminOrdersPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
          주문 관리
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          전체 주문을 조회한다. 셀러가 출고(배송 중)한 주문의 배송완료 처리는 상세에서 한다.
        </p>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Suspense fallback={<div style={{ height: 52 }} />}>
          <OrderFilters />
        </Suspense>
        <Suspense fallback={<div style={{ height: 320 }} />}>
          <OrderTable />
        </Suspense>
      </section>
    </div>
  );
}
