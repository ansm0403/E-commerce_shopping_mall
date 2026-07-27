'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SettlementStatus, type Settlement } from '@shopping-mall/shared';
import {
  adminSettlementErrorMessage,
  useAdminSettlementsQuery,
  useConfirmSettlementMutation,
  usePaySettlementMutation,
} from '../../../../../hooks/admin-settlement-query-options';
import { settlementStatusLabel, toAdminPageMeta } from '../../../../../service/settlement';
import { formatAmount } from '../../../../../service/seller-order';
import {
  actionButton,
  AdminPagination,
  BADGE_TONE,
  cardStyle,
  formatDateShort,
  tableStyle,
  tdStyle,
  thStyle,
} from '../../components/table-ui';
import { DEFAULT_SETTLEMENT_STATUS } from './SettlementFilters';

/**
 * 관리자 정산 목록 — 상태 전이는 2단계: PENDING →(확정)→ CONFIRMED →(지급)→ PAID.
 * 잘못된 전이는 백엔드가 400 으로 막고, 그 메시지를 배너에 그대로 보여준다.
 */

const TAKE = 20;

export default function SettlementTable() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pageParam = Number(sp.get('page'));
  const statusParam = sp.get('status') ?? DEFAULT_SETTLEMENT_STATUS;

  const { data, isLoading, isError } = useAdminSettlementsQuery({
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
    take: TAKE,
    status: statusParam === 'all' ? undefined : (statusParam as SettlementStatus),
  });

  const confirmMutation = useConfirmSettlementMutation();
  const payMutation = usePaySettlementMutation();

  const goPage = (page: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set('page', String(page));
    router.push(`${pathname}?${params.toString()}`);
  };

  const runAction = async (settlement: Settlement, action: 'confirm' | 'pay') => {
    setErrorMessage(null);
    const label = action === 'confirm' ? '정산 확정' : '지급 완료';
    if (!window.confirm(`${settlement.orderNumber} 건을 ${label} 처리할까요?`)) return;
    try {
      if (action === 'confirm') {
        await confirmMutation.mutateAsync(settlement.id);
      } else {
        await payMutation.mutateAsync(settlement.id);
      }
    } catch (error) {
      setErrorMessage(adminSettlementErrorMessage(error));
    }
  };

  const busy = confirmMutation.isPending || payMutation.isPending;
  const rows = data?.data ?? [];

  return (
    <div style={cardStyle}>
      {errorMessage && (
        <p
          style={{
            margin: 0,
            padding: '10px 12px',
            fontSize: '13px',
            color: '#dc2626',
            background: '#fef2f2',
            borderBottom: '1px solid #fee2e2',
            whiteSpace: 'pre-line',
          }}
        >
          {errorMessage}
        </p>
      )}
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>생성일 (KST)</th>
            <th style={thStyle}>셀러</th>
            <th style={thStyle}>주문번호</th>
            <th style={thStyle}>매출 / 수수료</th>
            <th style={thStyle}>정산액</th>
            <th style={thStyle}>상태</th>
            <th style={thStyle}>액션</th>
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
                정산 목록을 불러오지 못했습니다.
              </td>
            </tr>
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <tr>
              <td style={{ ...tdStyle, color: '#64748b' }} colSpan={7}>
                조건에 맞는 정산이 없습니다. (구매 확정 시 자동 생성된다)
              </td>
            </tr>
          )}
          {rows.map((s) => (
            <tr key={s.id}>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                {formatDateShort(s.createdAt)}
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                {s.seller?.businessName ?? `셀러 ${s.sellerId}`}
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                {s.orderNumber}
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                <div>{formatAmount(s.amount)}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  수수료 {formatAmount(s.commissionAmount)} ({Number(s.commissionRate)}%)
                </div>
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontWeight: 600 }}>
                {formatAmount(s.settlementAmount)}
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                <span style={settlementBadge(s.status)}>{settlementStatusLabel(s.status)}</span>
                <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
                  {s.confirmedAt && <>확정 {formatDateShort(s.confirmedAt)}</>}
                  {s.paidAt && <> · 지급 {formatDateShort(s.paidAt)}</>}
                </div>
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                {s.status === SettlementStatus.PENDING && (
                  <button
                    style={actionButton('#2563eb')}
                    disabled={busy}
                    onClick={() => runAction(s, 'confirm')}
                  >
                    정산 확정
                  </button>
                )}
                {s.status === SettlementStatus.CONFIRMED && (
                  <button
                    style={actionButton('#16a34a')}
                    disabled={busy}
                    onClick={() => runAction(s, 'pay')}
                  >
                    지급 완료
                  </button>
                )}
                {s.status === SettlementStatus.PAID && (
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>처리 완료</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <AdminPagination meta={toAdminPageMeta(data?.meta)} onPageChange={goPage} />
    </div>
  );
}

function settlementBadge(status: string): React.CSSProperties {
  if (status === SettlementStatus.PENDING) return BADGE_TONE.pending;
  if (status === SettlementStatus.CONFIRMED) return BADGE_TONE.neutral;
  return BADGE_TONE.approved;
}
