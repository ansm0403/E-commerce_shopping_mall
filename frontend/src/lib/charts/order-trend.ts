import type { EChartsOption } from 'echarts';
import type { OrderTrendResponse } from '../../service/admin-dashboard';

/**
 * 일별 주문/결제 꺾은선 차트 옵션 빌더 (순수 함수).
 * - 컴포넌트는 <ReactECharts option={buildOrderTrendOption(data)} /> 한 줄
 * - 단위 테스트 가능
 *
 * 시리즈:
 *   [실선] 주문 / 결제완료 / 취소
 *   [점선] 주문(전기) / 결제완료(전기)  ← previous가 있을 때만
 *
 * 색상 팔레트는 KpiCards와 일치 (slate/green/red).
 */

const COLORS = {
  ordered:        '#3b82f6', // blue-500
  paid:           '#16a34a', // green-600
  cancelled:      '#dc2626', // red-600
  orderedPrev:    '#93c5fd', // blue-300 (점선)
  paidPrev:       '#86efac', // green-300 (점선)
} as const;

export function buildOrderTrendOption(data: OrderTrendResponse): EChartsOption {
  const dates = data.current.map((d) => d.date);

  /**
   * series 구성:
   * - line + smooth: 추세선이라 약한 곡선이 자연스러움
   * - showSymbol false: 점이 너무 많으면 시각 노이즈 → hover 시에만 강조
   * previous는 length 보장 (백엔드 fillEmptyDates) — current와 같은 인덱스로 정렬됨
   */
  const series: NonNullable<EChartsOption['series']> = [
    {
      name: '주문',
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: data.current.map((d) => d.ordered),
      itemStyle: { color: COLORS.ordered },
      lineStyle: { color: COLORS.ordered, width: 2 },
    },
    {
      name: '결제완료',
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: data.current.map((d) => d.paid),
      itemStyle: { color: COLORS.paid },
      lineStyle: { color: COLORS.paid, width: 2 },
    },
    {
      name: '취소',
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: data.current.map((d) => d.cancelled),
      itemStyle: { color: COLORS.cancelled },
      lineStyle: { color: COLORS.cancelled, width: 2 },
    },
  ];

  if (data.previous) {
    series.push(
      {
        name: '주문(전기)',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: data.previous.map((d) => d.ordered),
        itemStyle: { color: COLORS.orderedPrev },
        lineStyle: { color: COLORS.orderedPrev, type: 'dashed', width: 2 },
      },
      {
        name: '결제완료(전기)',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: data.previous.map((d) => d.paid),
        itemStyle: { color: COLORS.paidPrev },
        lineStyle: { color: COLORS.paidPrev, type: 'dashed', width: 2 },
      },
    );
  }

  return {
    tooltip: { trigger: 'axis' },
    legend: {
      data: (series as Array<{ name: string }>).map((s) => s.name),
      bottom: 0,
      textStyle: { fontSize: 12, color: '#475569' },
    },
    grid: { left: 50, right: 24, top: 24, bottom: 48 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: dates,
      axisLabel: {
        fontSize: 11,
        color: '#64748b',
        // x축 라벨이 빽빽하면 자동 회전. 7~30개 정도면 그대로 표시.
      },
      axisLine: { lineStyle: { color: '#e2e8f0' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 11, color: '#64748b' },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
      minInterval: 1, // 정수 단위 (주문 건수에 소수점은 무의미)
    },
    series,
    // 폰(컨테이너 480px 미만): 범례 최대 5개가 두 줄로 밀리며 x축과 겹쳐서 하단 여백을 넓히고, 좌측 여백을 줄인다.
    media: [
      {
        query: { maxWidth: 480 },
        option: {
          legend: { bottom: 0, itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 } },
          grid: { left: 36, right: 12, top: 16, bottom: 84 }, // x 라벨 1줄 + 범례 최대 2줄(전기 비교 켬)
          // 'YYYY-MM-DD' 를 그대로 기울이면 하단 범례와 겹친다 → 'MM-DD' 로 줄이고 눕히지 않는다(연도는 부제에 있다)
          xAxis: { axisLabel: { fontSize: 10, rotate: 0, formatter: (v: string) => v.slice(5) } },
          yAxis: { axisLabel: { fontSize: 10 } },
        },
      },
    ],
  };
}
