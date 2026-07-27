import { Suspense } from 'react';
import SellerFilters from './components/SellerFilters';
import SellerTable from './components/SellerTable';

/**
 * 관리자 셀러 신청 승인/반려 (02-admin-core §2-A①).
 * 데이터 출처는 GET /v1/seller/applications (ADMIN 전용, status 필터 + 페이지 페이지네이션).
 * 승인은 seller.status 변경과 SELLER 역할 부여를 한 트랜잭션으로 처리한다.
 *
 * useSearchParams 를 쓰는 컴포넌트는 Next.js 15에서 Suspense 경계가 필요.
 */
export default function AdminSellersPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
          셀러 관리
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          셀러 신청을 검토하고 승인·반려한다. 승인 시 신청자에게 SELLER 역할이 부여된다.
        </p>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Suspense fallback={<div style={{ height: 52 }} />}>
          <SellerFilters />
        </Suspense>
        <Suspense fallback={<div style={{ height: 320 }} />}>
          <SellerTable />
        </Suspense>
      </section>
    </div>
  );
}
