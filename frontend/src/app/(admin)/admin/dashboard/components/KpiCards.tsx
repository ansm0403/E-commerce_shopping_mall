'use client';

import { useKpiQuery } from '../../../../../hooks/useDashboardQuery';

const cardStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '12px',
  padding: '20px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
  minWidth: 0,
};

/** 4장이 폭에 맞춰 4열 → 2열(폰 2×2) 로 접힌다. flex 였을 땐 폰에서 4장이 한 줄에 끼어 글자가 세로로 섰다. */
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: '16px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#64748b',
  fontWeight: 500,
};

const valueStyle: React.CSSProperties = {
  fontSize: '26px',
  fontWeight: 700,
  color: '#0f172a',
  marginTop: '8px',
  letterSpacing: '-0.5px',
};

const deltaStyle = (delta: number, invert = false): React.CSSProperties => {
  // invert=true: 실패율처럼 "감소가 좋음"인 지표 (지금 KPI엔 없지만 확장성 위해)
  const isGood = invert ? delta < 0 : delta > 0;
  return {
    fontSize: '13px',
    fontWeight: 600,
    color: delta === 0 ? '#94a3b8' : isGood ? '#16a34a' : '#dc2626',
    marginTop: '4px',
  };
};

function formatNumber(n: number): string {
  return n.toLocaleString('ko-KR');
}

function formatCurrency(n: number): string {
  return `₩${n.toLocaleString('ko-KR')}`;
}

function formatDelta(delta: number): string {
  if (delta === 0) return '— 0%';
  const arrow = delta > 0 ? '▲' : '▼';
  return `${arrow} ${Math.abs(delta).toFixed(1)}%`;
}

export default function KpiCards() {
  const { data, isLoading, isError } = useKpiQuery();

  if (isLoading) {
    return (
      <div style={gridStyle}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ ...cardStyle, height: '100px', background: '#e2e8f0' }} />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={{ ...cardStyle, color: '#dc2626' }}>
        KPI 데이터를 불러오지 못했습니다.
      </div>
    );
  }

  const { todayOrders, todayRevenue, pendingShipments, loginFailureRate } = data;
  const failureExceeded = loginFailureRate.value > loginFailureRate.threshold;

  return (
    <div style={gridStyle}>
      <div style={cardStyle}>
        <div style={labelStyle}>오늘 주문</div>
        <div style={valueStyle}>{formatNumber(todayOrders.value)}건</div>
        <div style={deltaStyle(todayOrders.deltaPercent)}>
          {formatDelta(todayOrders.deltaPercent)} <span style={{ color: '#94a3b8', fontWeight: 400 }}>전일 동시간 대비</span>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>오늘 매출</div>
        <div style={valueStyle}>{formatCurrency(todayRevenue.value)}</div>
        <div style={deltaStyle(todayRevenue.deltaPercent)}>
          {formatDelta(todayRevenue.deltaPercent)} <span style={{ color: '#94a3b8', fontWeight: 400 }}>전일 동시간 대비</span>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>미처리 배송</div>
        <div style={valueStyle}>{formatNumber(pendingShipments.value)}건</div>
        <div style={{ ...deltaStyle(0), color: '#94a3b8', fontWeight: 400 }}>
          결제완료 후 미발송
        </div>
      </div>

      <div style={cardStyle}>
        <div style={labelStyle}>로그인 실패율</div>
        <div style={{ ...valueStyle, color: failureExceeded ? '#dc2626' : '#0f172a' }}>
          {loginFailureRate.value.toFixed(1)}%
        </div>
        <div style={{ ...deltaStyle(0), color: failureExceeded ? '#dc2626' : '#94a3b8', fontWeight: failureExceeded ? 600 : 400 }}>
          {failureExceeded
            ? `⚠ 임계 ${loginFailureRate.threshold}% 초과`
            : `임계 ${loginFailureRate.threshold}% 이내`}
        </div>
      </div>
    </div>
  );
}
