import { Suspense } from 'react';
import SellerSettlementView from './components/SellerSettlementView';

/**
 * 셀러 정산 조회 (01-seller-core §1-A④).
 * GET /v1/seller/settlements(+/summary). 정산 레코드는 구매 확정 시 자동 생성(PENDING, 수수료 10%),
 * 확정(confirm)·지급(pay) 전이는 관리자 화면(02-A④)에서 한다.
 */
export default function SellerSettlementsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>정산</h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          구매자가 구매 확정하면 수수료 10%를 제한 정산이 자동 생성된다. 지급은 관리자가 처리한다.
        </p>
      </header>

      <Suspense fallback={<div style={{ height: 400 }} />}>
        <SellerSettlementView />
      </Suspense>
    </div>
  );
}
