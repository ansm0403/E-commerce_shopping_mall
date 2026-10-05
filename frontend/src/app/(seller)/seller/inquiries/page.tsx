import { Suspense } from 'react';
import SellerInquiryFilters from './components/SellerInquiryFilters';
import SellerInquiryTable from './components/SellerInquiryTable';

/**
 * 셀러 문의 (05-buyer-flow-complete §6 ③ · 01-2 §3-3).
 * 데이터 출처는 GET /v1/seller/inquiries?status= — 내 상품에 달린 문의만.
 * 답변은 PATCH /v1/seller/inquiries/:id/answer (한 번만, 수정 없음).
 */
export default function SellerInquiriesPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>문의 관리</h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#475569' }}>
          내 상품에 달린 문의다. 답변은 등록 후 수정할 수 없다.
        </p>
      </header>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Suspense fallback={<div style={{ height: 52 }} />}>
          <SellerInquiryFilters />
        </Suspense>
        <Suspense fallback={<div style={{ height: 320 }} />}>
          <SellerInquiryTable />
        </Suspense>
      </section>
    </div>
  );
}
