'use client';

import { useRouter, usePathname } from 'next/navigation';
import {
  addDays,
  todayKst,
  useDateRange,
} from '../../../../../hooks/useDateRange';

/**
 * 대시보드 기간 필터.
 * - 빠른 선택: 7일 / 30일 (오늘 포함, 끝일 = 오늘)
 * - 커스텀: <input type="date"> 두 개로 시작/끝 직접 선택
 * - 전기 대비: 토글 → URL ?compare=true|false
 *
 * 모든 변경은 router.push로 URL을 갱신 → useSearchParams를 쓰는 모든 차트가 자동 refetch.
 * 컴포넌트 내부에 useState 금지 (URL이 진실 원천).
 */

const QUICK_OPTIONS = [
  { label: '7일',  days: 7 },
  { label: '30일', days: 30 },
] as const;

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '12px',
  padding: '14px 16px',
  background: '#ffffff',
  borderRadius: '12px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
};

const groupStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap', // 폰에서 "시작 [date] ~ 종료 [date]" 가 한 줄에 안 들어가면 두 줄로
  alignItems: 'center',
  gap: '6px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#64748b',
  fontWeight: 500,
};

const dateInputStyle: React.CSSProperties = {
  fontSize: '13px',
  padding: '6px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  color: '#0f172a',
};

const quickButtonStyle = (active: boolean): React.CSSProperties => ({
  fontSize: '12px',
  fontWeight: 600,
  padding: '6px 12px',
  border: '1px solid',
  borderColor: active ? '#0f172a' : '#cbd5e1',
  background: active ? '#0f172a' : '#ffffff',
  color: active ? '#ffffff' : '#475569',
  borderRadius: '6px',
  cursor: 'pointer',
});

const toggleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '12px',
  color: '#475569',
  cursor: 'pointer',
  userSelect: 'none',
};

export default function DashboardFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const { startDate, endDate, compareWithPrevious } = useDateRange();

  /** URL 쿼리 부분 갱신 — 기존 파라미터는 유지하고 받은 키만 덮어씀 */
  const updateQuery = (next: Partial<{
    startDate: string;
    endDate:   string;
    compare:   boolean;
  }>) => {
    const params = new URLSearchParams();
    params.set('startDate', next.startDate ?? startDate);
    params.set('endDate',   next.endDate   ?? endDate);
    const compare = next.compare ?? compareWithPrevious;
    if (compare) params.set('compare', 'true'); // false면 키 자체를 빼서 URL을 깔끔히
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleQuick = (days: number) => {
    const end = todayKst();
    const start = addDays(end, -(days - 1)); // 7일 = 오늘 포함 7일
    updateQuery({ startDate: start, endDate: end });
  };

  /** 현재 선택이 빠른 옵션의 days와 일치하는지 (오늘 종료 기준) */
  const matchedQuickDays = (() => {
    if (endDate !== todayKst()) return null;
    for (const opt of QUICK_OPTIONS) {
      if (startDate === addDays(endDate, -(opt.days - 1))) return opt.days;
    }
    return null;
  })();

  return (
    <div style={containerStyle}>
      <div style={groupStyle}>
        {QUICK_OPTIONS.map(({ label, days }) => (
          <button
            key={days}
            type="button"
            style={quickButtonStyle(matchedQuickDays === days)}
            onClick={() => handleQuick(days)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={groupStyle}>
        <span style={labelStyle}>시작</span>
        <input
          type="date"
          style={dateInputStyle}
          value={startDate}
          max={endDate}
          onChange={(e) => updateQuery({ startDate: e.target.value })}
        />
        <span style={labelStyle}>~</span>
        <span style={labelStyle}>종료</span>
        <input
          type="date"
          style={dateInputStyle}
          value={endDate}
          min={startDate}
          max={todayKst()}
          onChange={(e) => updateQuery({ endDate: e.target.value })}
        />
      </div>

      <label style={{ ...toggleStyle, marginLeft: 'auto' }}>
        <input
          type="checkbox"
          checked={compareWithPrevious}
          onChange={(e) => updateQuery({ compare: e.target.checked })}
        />
        전기 대비 비교
      </label>
    </div>
  );
}
