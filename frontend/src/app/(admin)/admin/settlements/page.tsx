import { Suspense } from 'react';
import SettlementFilters from './components/SettlementFilters';
import SettlementTable from './components/SettlementTable';

/**
 * 관리자 정산 확인/지급 (02-admin-core §2-A④).
 * GET /v1/admin/settlements — 정산은 구매 확정 시 자동 생성(PENDING, 수수료 10%).
 * PENDING →(확정)→ CONFIRMED →(지급)→ PAID. confirm/pay 는 DemoAccountGuard 적용.
 */
export default function AdminSettlementsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
          정산 관리
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          구매 확정으로 생성된 정산을 확정하고, 송금 후 지급 완료 처리한다.
        </p>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Suspense fallback={<div style={{ height: 52 }} />}>
          <SettlementFilters />
        </Suspense>
        <Suspense fallback={<div style={{ height: 320 }} />}>
          <SettlementTable />
        </Suspense>
      </section>
    </div>
  );
}
