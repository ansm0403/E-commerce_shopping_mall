'use client';

import { useSellerSettlementSummaryQuery } from '../../../../../hooks/seller-dashboard-query-options';
import { formatAmount } from '../../../../../service/seller-order';
import { panelStyle, SectionHeader } from './dashboard-ui';

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: '12px',
  padding: '0 16px 16px',
};

/**
 * 정산 요약 — GET /seller/settlements/summary.
 * 정산은 구매 확정 때 자동으로 생기고(대기) 관리자가 확정 → 지급한다. 셀러는 "어디까지 왔는가"만 본다.
 */
export default function SellerSettlementSummary() {
  const { data, isLoading, isError } = useSellerSettlementSummaryQuery();

  return (
    <section style={panelStyle} aria-label="정산 요약">
      <SectionHeader title="정산" href="/seller/settlements" linkLabel="정산 내역" />
      {isLoading && <p style={messageStyle}>불러오는 중…</p>}
      {isError && <p style={{ ...messageStyle, color: '#dc2626' }}>정산 요약을 불러오지 못했습니다.</p>}
      {data && (
        <div style={gridStyle}>
          <Figure label="누적 정산액" value={formatAmount(data.totalSettlement)} strong />
          <Figure label={`정산 대기 (${data.pendingCount.toLocaleString('ko-KR')}건)`} value={formatAmount(data.pendingAmount)} />
          <Figure label="정산 확정" value={`${data.confirmedCount.toLocaleString('ko-KR')}건`} />
          <Figure label="지급 완료" value={`${data.paidCount.toLocaleString('ko-KR')}건`} />
        </div>
      )}
    </section>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ minWidth: 0, padding: '12px 14px', borderRadius: '8px', background: '#f8fafc' }}>
      <div style={{ fontSize: '12px', color: '#64748b' }}>{label}</div>
      <div
        style={{
          marginTop: '4px',
          fontSize: strong ? '20px' : '16px',
          fontWeight: 700,
          color: strong ? '#2563eb' : '#0f172a',
        }}
      >
        {value}
      </div>
    </div>
  );
}

const messageStyle: React.CSSProperties = {
  margin: 0,
  padding: '0 16px 16px',
  fontSize: '13px',
  color: '#64748b',
};
