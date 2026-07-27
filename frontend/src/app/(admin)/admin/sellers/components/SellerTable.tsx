'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SellerStatus, type SellerApplicationWithUser } from '@shopping-mall/shared';
import { useSellerApplicationsQuery } from '../../../../../hooks/admin-seller-query-options';
import { sellerStatusLabel } from '../../../../../service/admin-seller';
import SellerActionModal, { type SellerAction } from './SellerActionModal';
import { DEFAULT_SELLER_STATUS } from './SellerFilters';

/**
 * 셀러 신청 목록 — URL 의 status/page 를 읽어 GET /seller/applications 조회.
 * 컬럼: 신청일 · 상호명(사업자번호) · 대표자 · 신청자 · 상태 · 반려사유/승인일 · 액션.
 * 액션은 pending 인 신청에만 활성 — 백엔드도 400 으로 막지만 화면에서 먼저 차단한다.
 */

const TAKE = 20;

export default function SellerTable() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [target, setTarget] = useState<{ action: SellerAction; app: SellerApplicationWithUser } | null>(
    null,
  );

  const pageParam = Number(sp.get('page'));
  // status 미지정 = 대기(pending). 전체 조회는 status=all 로 명시한다(SellerFilters 와 같은 규칙).
  const statusParam = sp.get('status') ?? DEFAULT_SELLER_STATUS;

  const { data, isLoading, isError } = useSellerApplicationsQuery({
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
    take: TAKE,
    status: statusParam === 'all' ? undefined : (statusParam as SellerStatus),
  });

  const goPage = (page: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set('page', String(page));
    router.push(`${pathname}?${params.toString()}`);
  };

  const meta = data?.meta;
  const rows = data?.data ?? [];

  return (
    <div style={cardStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>신청일 (KST)</th>
            <th style={thStyle}>상호명 / 사업자번호</th>
            <th style={thStyle}>대표자</th>
            <th style={thStyle}>신청자</th>
            <th style={thStyle}>상태</th>
            <th style={thStyle}>처리 내역</th>
            <th style={thStyle}>액션</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td style={tdStyle} colSpan={7}>
                불러오는 중…
              </td>
            </tr>
          )}
          {isError && (
            <tr>
              <td style={{ ...tdStyle, color: '#dc2626' }} colSpan={7}>
                셀러 신청 목록을 불러오지 못했습니다.
              </td>
            </tr>
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <tr>
              <td style={{ ...tdStyle, color: '#64748b' }} colSpan={7}>
                조건에 맞는 셀러 신청이 없습니다.
              </td>
            </tr>
          )}
          {rows.map((app) => {
            const actionable = app.status === SellerStatus.PENDING;
            return (
              <tr key={app.id}>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                  {formatDateTime(app.createdAt)}
                </td>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{app.businessName}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>{app.businessNumber}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>{app.businessAddress}</div>
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <div>{app.representativeName}</div>
                  {app.contactPhone && (
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>{app.contactPhone}</div>
                  )}
                </td>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>
                    {app.user?.nickName ?? `user#${app.userId}`}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {app.contactEmail ?? app.user?.email ?? '-'}
                  </div>
                </td>
                <td style={tdStyle}>
                  <span style={statusBadge(app.status)}>{sellerStatusLabel(app.status)}</span>
                </td>
                <td style={{ ...tdStyle, maxWidth: '240px' }}>
                  {app.status === SellerStatus.REJECTED && app.rejectionReason ? (
                    <span style={{ color: '#dc2626' }}>{app.rejectionReason}</span>
                  ) : app.status === SellerStatus.APPROVED && app.approvedAt ? (
                    <span style={{ color: '#475569' }}>{formatDateTime(app.approvedAt)} 승인</span>
                  ) : (
                    <span style={{ color: '#cbd5e1' }}>—</span>
                  )}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  {actionable ? (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        style={actionButton('#2563eb')}
                        onClick={() => setTarget({ action: 'approve', app })}
                      >
                        승인
                      </button>
                      <button
                        style={actionButton('#dc2626')}
                        onClick={() => setTarget({ action: 'reject', app })}
                      >
                        반려
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>처리 완료</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {meta && meta.total > 0 && (
        <div style={footerStyle}>
          <span>
            총 {meta.total.toLocaleString('ko-KR')}건 · {meta.page} / {meta.lastPage} 페이지
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              style={pageBtn(meta.page <= 1)}
              disabled={meta.page <= 1}
              onClick={() => goPage(meta.page - 1)}
            >
              ← 이전
            </button>
            <button
              style={pageBtn(!meta.hasNextPage)}
              disabled={!meta.hasNextPage}
              onClick={() => goPage(meta.page + 1)}
            >
              다음 →
            </button>
          </div>
        </div>
      )}

      {target && (
        <SellerActionModal
          action={target.action}
          application={target.app}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}

/** 'YYYY-MM-DD HH:mm:ss' (KST). 백엔드는 UTC 인스턴트를 준다. */
function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
}

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '12px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
  overflow: 'hidden',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  background: '#f8fafc',
  color: '#475569',
  fontWeight: 600,
  borderBottom: '1px solid #e2e8f0',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #f1f5f9',
  color: '#0f172a',
  verticalAlign: 'top',
};

const badge = (bg: string, color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 600,
  background: bg,
  color,
});

function statusBadge(status: string): React.CSSProperties {
  if (status === SellerStatus.APPROVED) return badge('#dcfce7', '#16a34a');
  if (status === SellerStatus.REJECTED) return badge('#fee2e2', '#dc2626');
  return badge('#fef3c7', '#b45309');
}

const actionButton = (color: string): React.CSSProperties => ({
  fontSize: '12px',
  fontWeight: 600,
  padding: '5px 12px',
  border: `1px solid ${color}`,
  background: '#ffffff',
  color,
  borderRadius: '6px',
  cursor: 'pointer',
});

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  fontSize: '13px',
  color: '#475569',
};

const pageBtn = (disabled: boolean): React.CSSProperties => ({
  fontSize: '13px',
  fontWeight: 600,
  padding: '6px 12px',
  border: '1px solid #cbd5e1',
  background: disabled ? '#f1f5f9' : '#ffffff',
  color: disabled ? '#94a3b8' : '#0f172a',
  borderRadius: '6px',
  cursor: disabled ? 'default' : 'pointer',
});
