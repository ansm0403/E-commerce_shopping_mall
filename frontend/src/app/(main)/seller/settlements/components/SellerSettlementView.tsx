'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SettlementStatus } from '@shopping-mall/shared';
import {
  useMySettlementsQuery,
  useMySettlementSummaryQuery,
} from '../../../../../hooks/settlement-query-options';
import {
  settlementStatusLabel,
  toAdminPageMeta,
} from '../../../../../service/settlement';
import { formatAmount } from '../../../../../service/seller-order';
import {
  AdminPagination,
  BADGE_TONE,
  cardStyle,
  filterBarStyle,
  formatDateShort,
  tableStyle,
  tabStyle,
  tdStyle,
  thStyle,
} from '../../../../(admin)/admin/components/table-ui';

/**
 * 셀러 정산 화면 — 요약 카드 + 상태 탭 + 내역 표.
 * 정산은 구매 확정 시 자동 생성(PENDING)되고, 확정/지급 전이는 관리자만 한다 —
 * 그래서 이 화면엔 액션이 없고 "지금 어디까지 왔는가"만 보여준다.
 */

const TAKE = 20;
const DEFAULT_STATUS = 'all';

const TABS = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '정산 대기' },
  { value: 'confirmed', label: '정산 확정' },
  { value: 'paid', label: '지급 완료' },
] as const;

export default function SellerSettlementView() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const pageParam = Number(sp.get('page'));
  const statusParam = sp.get('status') ?? DEFAULT_STATUS;

  const { data: summary } = useMySettlementSummaryQuery();
  const { data, isLoading, isError } = useMySettlementsQuery({
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
    take: TAKE,
    status: statusParam === 'all' ? undefined : (statusParam as SettlementStatus),
  });

  const selectTab = (value: string) => {
    const params = new URLSearchParams(sp.toString());
    params.set('status', value);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  };

  const goPage = (page: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set('page', String(page));
    router.push(`${pathname}?${params.toString()}`);
  };

  const rows = data?.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 요약 카드 */}
      {summary && (
        <div style={summaryGridStyle}>
          <SummaryCard label="누적 매출" value={formatAmount(summary.totalAmount)} />
          <SummaryCard label="누적 수수료 (10%)" value={formatAmount(summary.totalCommission)} />
          <SummaryCard label="누적 정산액" value={formatAmount(summary.totalSettlement)} strong />
          <SummaryCard
            label={`지급 대기 (${summary.pendingCount + summary.confirmedCount}건)`}
            value={formatAmount(summary.pendingAmount)}
          />
        </div>
      )}

      <div style={filterBarStyle}>
        {TABS.map(({ value, label }) => (
          <button key={value} style={tabStyle(statusParam === value)} onClick={() => selectTab(value)}>
            {label}
          </button>
        ))}
      </div>

      <div style={cardStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>생성일 (KST)</th>
              <th style={thStyle}>주문번호</th>
              <th style={thStyle}>매출액</th>
              <th style={thStyle}>수수료</th>
              <th style={thStyle}>정산액</th>
              <th style={thStyle}>상태</th>
              <th style={thStyle}>확정 / 지급일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td style={tdStyle} colSpan={7}>불러오는 중…</td>
              </tr>
            )}
            {isError && (
              <tr>
                <td style={{ ...tdStyle, color: '#dc2626' }} colSpan={7}>
                  정산 내역을 불러오지 못했습니다.
                </td>
              </tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td style={{ ...tdStyle, color: '#64748b' }} colSpan={7}>
                  정산 내역이 없습니다. 구매자가 구매 확정하면 자동으로 생성됩니다.
                </td>
              </tr>
            )}
            {rows.map((s) => (
              <tr key={s.id}>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                  {formatDateShort(s.createdAt)}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                  {s.orderNumber}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatAmount(s.amount)}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#94a3b8' }}>
                  −{formatAmount(s.commissionAmount)}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>
                  {formatAmount(s.settlementAmount)}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <span style={settlementBadge(s.status)}>{settlementStatusLabel(s.status)}</span>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                  {s.confirmedAt ? formatDateShort(s.confirmedAt) : '—'}
                  {' / '}
                  {s.paidAt ? formatDateShort(s.paidAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <AdminPagination meta={toAdminPageMeta(data?.meta)} onPageChange={goPage} />
      </div>
    </div>
  );
}

function SummaryCard({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ ...cardStyle, padding: '14px 16px' }}>
      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>{label}</p>
      <p
        style={{
          margin: '6px 0 0',
          fontSize: '18px',
          fontWeight: 700,
          color: strong ? '#2563eb' : '#0f172a',
        }}
      >
        {value}
      </p>
    </div>
  );
}

export function settlementBadge(status: string): React.CSSProperties {
  if (status === SettlementStatus.PENDING) return BADGE_TONE.pending;
  if (status === SettlementStatus.CONFIRMED) return BADGE_TONE.neutral;
  return BADGE_TONE.approved;
}

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '12px',
};
