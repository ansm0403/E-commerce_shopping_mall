'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useAuditLogsQuery } from '../../../../../hooks/useAuditQuery';
import { actionLabel, AuditLog, AuditLogQuery } from '../../../../../service/admin-audit';

/**
 * 포렌식 검색 표(§5-B) — URL 필터를 읽어 GET /admin/audit-logs 조회 후 표/페이지네이션.
 * 컬럼: 시각 · 행위자 · action · 결과 · IP · errorMessage · metadata(펼치기).
 */

const TAKE = 50;

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

function timeFull(iso: string): string {
  // 'YYYY-MM-DD HH:mm:ss' (KST). 백엔드는 UTC 인스턴트를 주므로 Asia/Seoul 로 변환.
  // sv-SE 로캘이 ISO 유사 포맷('2026-06-14 22:33:02')을 준다.
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function actor(log: AuditLog): string {
  if (log.userNickName) return log.userNickName;
  if (log.userEmail) return log.userEmail;
  if (log.userId != null) return `user#${log.userId}`;
  return '시스템';
}

/** URL searchParams → AuditLogQuery */
function buildQuery(sp: URLSearchParams): AuditLogQuery {
  const num = (k: string) => {
    const v = sp.get(k);
    return v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined;
  };
  const successRaw = sp.get('success');
  return {
    page: num('page') ?? 1,
    take: TAKE,
    userId: num('userId'),
    action: sp.get('action') || undefined,
    success: successRaw === 'true' ? true : successRaw === 'false' ? false : undefined,
    startDate: sp.get('startDate') || undefined,
    endDate: sp.get('endDate') || undefined,
    ipAddress: sp.get('ipAddress') || undefined,
  };
}

export default function AuditTable() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [expanded, setExpanded] = useState<number | null>(null);

  const query = buildQuery(sp);
  const { data, isLoading, isError } = useAuditLogsQuery(query);

  const goPage = (page: number) => {
    const params = new URLSearchParams(sp.toString());
    params.set('page', String(page));
    router.push(`${pathname}?${params.toString()}#forensic`);
  };

  const meta = data?.meta;
  const rows = data?.data ?? [];

  return (
    <div style={cardStyle} id="forensic">
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>시각 (KST)</th>
            <th style={thStyle}>행위자</th>
            <th style={thStyle}>action</th>
            <th style={thStyle}>결과</th>
            <th style={thStyle}>IP</th>
            <th style={thStyle}>메시지 / metadata</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td style={tdStyle} colSpan={6}>
                불러오는 중…
              </td>
            </tr>
          )}
          {isError && (
            <tr>
              <td style={{ ...tdStyle, color: '#dc2626' }} colSpan={6}>
                감사 로그를 불러오지 못했습니다.
              </td>
            </tr>
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <tr>
              <td style={{ ...tdStyle, color: '#64748b' }} colSpan={6}>
                조건에 맞는 로그가 없습니다.
              </td>
            </tr>
          )}
          {rows.map((log) => {
            const isOpen = expanded === log.id;
            const hasMeta = log.metadata && Object.keys(log.metadata).length > 0;
            return (
              <tr key={log.id}>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                  {timeFull(log.createdAt)}
                </td>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 600 }}>{actor(log)}</div>
                  {log.userEmail && log.userNickName && (
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>{log.userEmail}</div>
                  )}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                  <span style={{ fontWeight: 600 }}>{actionLabel(log.action)}</span>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>{log.action}</div>
                </td>
                <td style={tdStyle}>
                  {log.success ? (
                    <span style={badge('#dcfce7', '#16a34a')}>성공</span>
                  ) : (
                    <span style={badge('#fee2e2', '#dc2626')}>실패</span>
                  )}
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: '#475569' }}>
                  {log.ipAddress}
                </td>
                <td style={tdStyle}>
                  {log.errorMessage && (
                    <div style={{ color: '#dc2626', marginBottom: hasMeta ? '4px' : 0 }}>
                      {log.errorMessage}
                    </div>
                  )}
                  {hasMeta && (
                    <button
                      onClick={() => setExpanded(isOpen ? null : log.id)}
                      style={{
                        fontSize: '12px',
                        color: '#2563eb',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {isOpen ? '▾ metadata 접기' : '▸ metadata 보기'}
                    </button>
                  )}
                  {!log.errorMessage && !hasMeta && <span style={{ color: '#cbd5e1' }}>—</span>}
                  {isOpen && hasMeta && (
                    <pre
                      style={{
                        margin: '6px 0 0',
                        padding: '8px 10px',
                        background: '#f8fafc',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#334155',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
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
    </div>
  );
}
