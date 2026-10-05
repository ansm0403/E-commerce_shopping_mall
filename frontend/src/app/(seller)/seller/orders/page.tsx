import { Suspense } from 'react';
import SellerOrderFilters from './components/SellerOrderFilters';
import SellerOrderTable from './components/SellerOrderTable';

/**
 * 셀러 주문/배송 (01-seller-core §1-A③).
 * 데이터 출처는 GET /v1/seller/orders — 내 상품이 포함된 주문만, items/shipments 는 내 것만.
 * 배송 처리는 PATCH /v1/seller/orders/:orderNumber/ship (내 Shipment PREPARING → SHIPPED).
 */
export default function SellerOrdersPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
          주문 / 배송 관리
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          내 상품이 포함된 주문이다. 결제가 완료되면 출고 대기(배송 처리 가능) 상태가 된다.
        </p>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Suspense fallback={<div style={{ height: 52 }} />}>
          <SellerOrderFilters />
        </Suspense>
        <Suspense fallback={<div style={{ height: 320 }} />}>
          <SellerOrderTable />
        </Suspense>
      </section>
    </div>
  );
}
