import type { EChartsOption } from 'echarts';

/**
 * 셀러 대시보드의 주문 상태 분포(도넛) 옵션 빌더.
 * 값은 상태별 목록 API 의 `meta.total` — 전체 주문을 정확히 센 숫자다(일부만 묶는 매출 그래프와 다르다).
 */

export interface OrderStatusCount {
  status: string;
  label: string;
  total: number;
}

/** 진행 순서대로 — 색은 "기다림(노랑·주황) → 이동(파랑) → 끝(초록)", 취소는 회색 */
export const SELLER_ORDER_STATUS_SLICES = [
  { status: 'paid', label: '결제 완료', color: '#fbbf24' },
  { status: 'preparing', label: '출고 대기', color: '#f97316' },
  { status: 'shipped', label: '배송 중', color: '#3b82f6' },
  { status: 'delivered', label: '배송 완료', color: '#14b8a6' },
  { status: 'completed', label: '구매 확정', color: '#16a34a' },
  { status: 'cancelled', label: '취소', color: '#94a3b8' },
] as const;

export function buildOrderStatusOption(counts: readonly OrderStatusCount[]): EChartsOption {
  const total = counts.reduce((sum, c) => sum + c.total, 0);
  const colorOf = (status: string) =>
    SELLER_ORDER_STATUS_SLICES.find((slice) => slice.status === status)?.color ?? '#cbd5e1';

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { name: string; value: number; percent: number };
        return `<b>${p.name}</b><br/>${p.value.toLocaleString('ko-KR')}건 (${p.percent}%)`;
      },
    },
    legend: { bottom: 0, itemWidth: 12, itemHeight: 12, textStyle: { fontSize: 12 } },
    // 가운데 합계
    title: {
      text: `${total.toLocaleString('ko-KR')}건`,
      subtext: '전체 주문',
      left: 'center',
      top: '34%',
      textStyle: { fontSize: 20, fontWeight: 700, color: '#0f172a' },
      subtextStyle: { fontSize: 12, color: '#64748b' },
    },
    series: [
      {
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['50%', '43%'],
        avoidLabelOverlap: true,
        label: { show: false },
        // 0건 조각은 그리지 않는다(범례에도 나오지 않는다 — 건수는 그래프 아래 목록에 전부 있다)
        data: counts
          .filter((c) => c.total > 0)
          .map((c) => ({ name: c.label, value: c.total, itemStyle: { color: colorOf(c.status) } })),
      },
    ],
  };
}
