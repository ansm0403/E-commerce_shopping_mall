'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  AUDIT_ACTIONS,
  actionLabel,
} from '../../../../../service/admin-audit';

/**
 * 포렌식 검색 필터(§5-B) — AuditLogQueryDto 필터를 그대로 노출.
 * 진실 원천 = URL(useSearchParams). 변경 시 router.push 로 URL 갱신 → 표가 자동 refetch.
 * 필터를 바꾸면 page 는 1로 리셋.
 */

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  gap: '12px',
  padding: '14px 16px',
  background: '#ffffff',
  borderRadius: '12px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  fontSize: '13px',
  padding: '6px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  color: '#0f172a',
  background: '#ffffff',
  minWidth: '120px',
};

const resetStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  padding: '7px 12px',
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#475569',
  borderRadius: '6px',
  cursor: 'pointer',
};

export default function AuditFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const get = (k: string) => sp.get(k) ?? '';

  /** 받은 키만 덮어쓰고 나머지 필터는 유지. page 는 항상 1로 리셋. */
  const update = (patch: Record<string, string>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === '') params.delete(k);
      else params.set(k, v);
    }
    params.delete('page'); // 필터 변경 → 1페이지부터
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}#forensic` : `${pathname}#forensic`);
  };

  const reset = () => router.push(`${pathname}#forensic`);

  return (
    <div style={containerStyle}>
      <div style={fieldStyle}>
        <span style={labelStyle}>action</span>
        <select
          style={inputStyle}
          value={get('action')}
          onChange={(e) => update({ action: e.target.value })}
        >
          <option value="">전체</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a)} ({a})
            </option>
          ))}
        </select>
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>결과</span>
        <select
          style={inputStyle}
          value={get('success')}
          onChange={(e) => update({ success: e.target.value })}
        >
          <option value="">전체</option>
          <option value="true">성공</option>
          <option value="false">실패</option>
        </select>
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>userId</span>
        <input
          type="number"
          style={{ ...inputStyle, minWidth: '90px' }}
          value={get('userId')}
          placeholder="예: 27"
          onChange={(e) => update({ userId: e.target.value })}
        />
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>IP 주소</span>
        <input
          type="text"
          style={inputStyle}
          value={get('ipAddress')}
          placeholder="예: 192.168.1.1"
          onChange={(e) => update({ ipAddress: e.target.value })}
        />
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>시작일</span>
        <input
          type="date"
          style={inputStyle}
          value={get('startDate')}
          max={get('endDate') || undefined}
          onChange={(e) => update({ startDate: e.target.value })}
        />
      </div>

      <div style={fieldStyle}>
        <span style={labelStyle}>종료일</span>
        <input
          type="date"
          style={inputStyle}
          value={get('endDate')}
          min={get('startDate') || undefined}
          onChange={(e) => update({ endDate: e.target.value })}
        />
      </div>

      <button style={resetStyle} onClick={reset}>
        필터 초기화
      </button>
    </div>
  );
}
