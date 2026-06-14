'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useTriageQuery } from '../../../../../hooks/useAuditQuery';
import { actionLabel, AuditLog } from '../../../../../service/admin-audit';

/**
 * 트리아지 뷰(§5-A) — "봐야 할 것" 3버킷 요약 카드.
 * 데이터는 useTriageQuery(기존 엔드포인트 N회 호출). 카드의 "상세" 클릭 → 같은 페이지
 * 하단 포렌식 검색 뷰의 URL 필터를 세팅(진실 원천 = URL).
 */

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '12px',
  padding: '20px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const titleRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const titleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: '#0f172a',
};

const linkStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#2563eb',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
};

const bigNumber = (color: string): React.CSSProperties => ({
  fontSize: '24px',
  fontWeight: 700,
  color,
  letterSpacing: '-0.5px',
});

const subStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  marginTop: '4px',
};

const itemStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#475569',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

function timeShort(iso: string): string {
  // 'MM-DD HH:mm' (KST). 백엔드 UTC 인스턴트를 Asia/Seoul 로 변환.
  return new Date(iso).toLocaleString('sv-SE', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function actorName(log: AuditLog): string {
  return log.userNickName ?? log.userEmail ?? (log.userId != null ? `user#${log.userId}` : '시스템');
}

export default function TriageCards() {
  const router = useRouter();
  const pathname = usePathname();
  const { security, system, admin, isLoading, isError } = useTriageQuery(30);

  /** 포렌식 뷰 URL 필터 세팅 후 표로 스크롤 */
  const goDetail = (params: Record<string, string>) => {
    const sp = new URLSearchParams(params);
    router.push(`${pathname}?${sp.toString()}#forensic`);
  };

  if (isError) {
    return (
      <div style={{ ...cardStyle, color: '#dc2626' }}>
        트리아지 데이터를 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
      {/* 🔴 보안·이상징후 */}
      <div style={cardStyle}>
        <div style={titleRow}>
          <span style={titleStyle}>🔴 보안·이상징후</span>
          <button style={linkStyle} onClick={() => goDetail({ action: 'FAILED_LOGIN' })}>
            상세 →
          </button>
        </div>
        <div style={{ display: 'flex', gap: '20px' }}>
          <div>
            <div style={bigNumber(security.failed > 0 ? '#dc2626' : '#0f172a')}>
              {isLoading ? '…' : security.failed}
            </div>
            <div style={subStyle}>로그인 실패</div>
          </div>
          <div>
            <div style={bigNumber(security.locked > 0 ? '#dc2626' : '#0f172a')}>
              {isLoading ? '…' : security.locked}
            </div>
            <div style={subStyle}>계정 잠금</div>
          </div>
        </div>
        <div style={subStyle}>최근 30일 기준</div>
      </div>

      {/* 🟠 시스템 오류 */}
      <div style={cardStyle}>
        <div style={titleRow}>
          <span style={titleStyle}>🟠 시스템 오류</span>
          <button style={linkStyle} onClick={() => goDetail({ success: 'false' })}>
            상세 →
          </button>
        </div>
        <div>
          <div style={bigNumber(system.count > 0 ? '#ea580c' : '#0f172a')}>
            {isLoading ? '…' : system.count}
          </div>
          <div style={subStyle}>실패(success=false) · 보안 제외</div>
        </div>
        <div style={listStyle}>
          {system.samples.length === 0 && !isLoading && (
            <div style={itemStyle}>표시할 오류 없음</div>
          )}
          {system.samples.map((s) => (
            <div key={s.id} style={itemStyle} title={s.errorMessage ?? ''}>
              <span style={{ color: '#ea580c' }}>{actionLabel(s.action)}</span>
              {' · '}
              {s.errorMessage ?? '—'}
            </div>
          ))}
        </div>
      </div>

      {/* 🟡 관리자 행위 */}
      <div style={cardStyle}>
        <div style={titleRow}>
          <span style={titleStyle}>🟡 관리자 행위</span>
          <button
            style={linkStyle}
            onClick={() => goDetail({ action: 'SELLER_APPROVED' })}
          >
            상세 →
          </button>
        </div>
        <div>
          <div style={bigNumber('#0f172a')}>{isLoading ? '…' : admin.count}</div>
          <div style={subStyle}>승인·정산 등 관리자 행위(30일)</div>
        </div>
        <div style={listStyle}>
          {admin.recent.length === 0 && !isLoading && (
            <div style={itemStyle}>표시할 행위 없음</div>
          )}
          {admin.recent.map((a) => (
            <div key={a.id} style={itemStyle}>
              <span style={{ color: '#64748b' }}>{timeShort(a.createdAt)}</span>
              {' · '}
              <span style={{ color: '#0f172a', fontWeight: 600 }}>{actorName(a)}</span>
              {' '}
              {actionLabel(a.action)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
