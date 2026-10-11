import { Suspense } from 'react';
import ProductCreateLink from './components/ProductCreateLink';
import SellerProductFilters from './components/SellerProductFilters';
import SellerProductTable from './components/SellerProductTable';

/**
 * 셀러 상품 관리 (01-seller-core §1-A②).
 * 데이터 출처는 GET /v1/products/my (SELLER 전용, 모든 상태 노출).
 * 게시/숨김 토글은 PATCH /v1/products/:id/status — 재심사를 발동하지 않는다.
 *
 * useSearchParams 를 쓰는 컴포넌트는 Next.js 15에서 Suspense 경계가 필요.
 */
export default function SellerProductsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
            상품 관리
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            등록한 상품은 관리자 승인 후 상점에 게시된다. 내용을 수정하면 다시 심사를 받는다.
          </p>
        </div>
        <ProductCreateLink />
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Suspense fallback={<div style={{ height: 52 }} />}>
          <SellerProductFilters />
        </Suspense>
        <Suspense fallback={<div style={{ height: 320 }} />}>
          <SellerProductTable />
        </Suspense>
      </section>
    </div>
  );
}
