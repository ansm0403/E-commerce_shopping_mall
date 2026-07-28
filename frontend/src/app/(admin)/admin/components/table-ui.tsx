'use client';

/**
 * 관리자 표 공용 UI.
 *
 * 감사 로그 → 셀러 승인 → 상품 승인으로 같은 표 스타일이 세 번 복제되던 참이라
 * 스타일과 페이지네이션만 여기로 뺐다. 컬럼 구성은 화면마다 크게 달라서
 * 표 컴포넌트 자체를 일반화하지는 않는다 — 추상화가 이득보다 커진다.
 *
 * (audit-logs 는 metadata 펼치기 등 자기만의 사정이 있어 아직 자체 스타일을 쓴다)
 */

export const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '12px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
  overflow: 'hidden',
};

export const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};

export const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  background: '#f8fafc',
  color: '#475569',
  fontWeight: 600,
  borderBottom: '1px solid #e2e8f0',
  whiteSpace: 'nowrap',
};

export const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #f1f5f9',
  color: '#0f172a',
  verticalAlign: 'top',
};

export const badge = (bg: string, color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 600,
  background: bg,
  color,
});

/** 대기(노랑) / 승인(초록) / 반려(빨강) — 셀러·상품이 같은 색 규칙을 쓴다 */
export const BADGE_TONE = {
  pending: badge('#fef3c7', '#b45309'),
  approved: badge('#dcfce7', '#16a34a'),
  rejected: badge('#fee2e2', '#dc2626'),
  neutral: badge('#f1f5f9', '#475569'),
} as const;

export const actionButton = (color: string): React.CSSProperties => ({
  fontSize: '12px',
  fontWeight: 600,
  padding: '5px 12px',
  border: `1px solid ${color}`,
  background: '#ffffff',
  color,
  borderRadius: '6px',
  cursor: 'pointer',
});

/** 상태 탭(대기/승인/반려/전체)에 쓰는 알약 버튼 */
export const tabStyle = (active: boolean): React.CSSProperties => ({
  fontSize: '13px',
  fontWeight: 600,
  padding: '7px 16px',
  border: `1px solid ${active ? '#2563eb' : '#cbd5e1'}`,
  background: active ? '#eff6ff' : '#ffffff',
  color: active ? '#2563eb' : '#475569',
  borderRadius: '999px',
  cursor: 'pointer',
});

export const filterBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  padding: '10px 12px',
  background: '#ffffff',
  borderRadius: '12px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
};

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

/** 백엔드 CommonService.pagePaginate 의 meta 와 1:1 */
export interface AdminPageMeta {
  total: number;
  page: number;
  lastPage: number;
  hasNextPage: boolean;
}

export function AdminPagination({
  meta,
  onPageChange,
}: {
  meta: AdminPageMeta | undefined;
  onPageChange: (page: number) => void;
}) {
  if (!meta || meta.total === 0) return null;

  return (
    <div style={footerStyle}>
      <span>
        총 {meta.total.toLocaleString('ko-KR')}건 · {meta.page} / {meta.lastPage} 페이지
      </span>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          style={pageBtn(meta.page <= 1)}
          disabled={meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
        >
          ← 이전
        </button>
        <button
          style={pageBtn(!meta.hasNextPage)}
          disabled={!meta.hasNextPage}
          onClick={() => onPageChange(meta.page + 1)}
        >
          다음 →
        </button>
      </div>
    </div>
  );
}

/** 'YYYY-MM-DD HH:mm:ss' (KST) — 백엔드는 UTC 인스턴트를 준다 */
export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/** 'YYYY-MM-DD HH:mm' (KST) */
export function formatDateShort(value: string | Date): string {
  return formatDateTime(value).slice(0, 16);
}
