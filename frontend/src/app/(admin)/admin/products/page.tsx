import { Suspense } from 'react';
import ProductFilters from './components/ProductFilters';
import ProductTable from './components/ProductTable';

/**
 * 관리자 상품 승인/반려 (02-admin-core §2-A②).
 * 데이터 출처는 GET /v1/admin/products (ADMIN 전용, approvalStatus 필터 + 페이지 페이지네이션).
 * 승인/반려는 트랜잭션 + Redis 상품 캐시 무효화 + 이벤트 발행까지 백엔드가 처리한다.
 *
 * useSearchParams 를 쓰는 컴포넌트는 Next.js 15에서 Suspense 경계가 필요.
 */
export default function AdminProductsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
          상품 관리
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          셀러가 등록한 상품을 검토하고 승인·반려한다. 승인해야 상점에 노출된다.
        </p>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Suspense fallback={<div style={{ height: 52 }} />}>
          <ProductFilters />
        </Suspense>
        <Suspense fallback={<div style={{ height: 320 }} />}>
          <ProductTable />
        </Suspense>
      </section>
    </div>
  );
}
