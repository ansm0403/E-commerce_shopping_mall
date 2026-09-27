import type { EChartsOption } from 'echarts';
import type { SecurityResponse } from '@/service/admin-dashboard';

const FAILURE_THRESHOLD = 10;         // % 임계값 — KPI loginFailureRate.threshold와 동일

const COLOR_BAR_NORMAL  = '#f97316';  // 주황 — 임계 이하 실패 막대
const COLOR_BAR_ALERT   = '#dc2626';  // 빨강 — 임계 초과 날 실패 막대
const COLOR_BAR_LOCKED  = '#7c3aed';  // 보라 — 계정 잠금 막대
const COLOR_LINE        = '#2563eb';  // 파랑 — 실패율 선
const COLOR_THRESHOLD   = '#dc2626';  // 빨강 점선 — 경고선

/**
 * GET /v1/admin/dashboard/security 응답을 ECharts 옵션으로 변환.
 *
 * 구조:
 * - 왼쪽 Y축 (yAxisIndex 0): 건수 (로그인 실패 + 계정 잠금 stacked bar)
 * - 오른쪽 Y축 (yAxisIndex 1): 실패율 % (line + markLine 10%)
 * - 임계 초과 날: 실패 막대 색을 빨강으로 변경 (itemStyle.color 함수)
 */
export function buildSecurityOption(data: SecurityResponse): EChartsOption {
  const dates       = data.daily.map((d) => d.date);
  const failed      = data.daily.map((d) => d.failed);
  const locked      = data.daily.map((d) => d.locked);
  const failureRate = data.daily.map((d) => d.failureRate);

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const i = (Array.isArray(params) ? params[0] : params).dataIndex;
        const p = data.daily[i];
        // notMerge=true 이지만 ECharts 옵션 교체 중 이전 dataIndex로 콜백이
        // 호출될 수 있어 방어 처리. (data.daily가 비어있을 때도 동일)
        if (!p) return '';
        const alertMark = p.failureRate > FAILURE_THRESHOLD ? ' ⚠️' : '';
        return [
          `<b>${p.date}</b>${alertMark}`,
          `로그인 실패: ${p.failed}건`,
          `계정 잠금: ${p.locked}건`,
          `로그인 시도: ${p.total}건`,
          `<b>실패율: ${p.failureRate}%</b>`,
        ].join('<br/>');
      },
    },
    legend: {
      data: ['로그인 실패', '계정 잠금', '실패율(%)'],
      top: 8,
    },
    grid: { left: 50, right: 65, top: 45, bottom: 30 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { rotate: dates.length > 14 ? 30 : 0 },
    },
    yAxis: [
      {
        type: 'value',
        name: '건수',
        position: 'left',
        minInterval: 1,
        axisLabel: { formatter: '{value}건' },
      },
      {
        type: 'value',
        name: '실패율(%)',
        position: 'right',
        min: 0,
        max: 100,
        axisLabel: { formatter: '{value}%' },
      },
    ],
    series: [
      {
        name: '로그인 실패',
        type: 'bar',
        yAxisIndex: 0,
        stack: 'security',
        data: failed,
        itemStyle: {
          // 임계 초과 날은 빨강, 그 외 주황.
          // ECharts 옵션 교체 중 이전 dataIndex로 콜백이 호출될 수 있어 방어 처리.
          color: (params: any) => {
            const p = data.daily[params.dataIndex];
            if (!p) return COLOR_BAR_NORMAL;
            return p.failureRate > FAILURE_THRESHOLD ? COLOR_BAR_ALERT : COLOR_BAR_NORMAL;
          },
        },
      },
      {
        name: '계정 잠금',
        type: 'bar',
        yAxisIndex: 0,
        stack: 'security',
        data: locked,
        itemStyle: { color: COLOR_BAR_LOCKED },
      },
      {
        name: '실패율(%)',
        type: 'line',
        yAxisIndex: 1,
        data: failureRate,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: COLOR_LINE, width: 2 },
        itemStyle: { color: COLOR_LINE },
        markLine: {
          symbol: 'none',
          silent: true,
          data: [{ yAxis: FAILURE_THRESHOLD, name: '경고선' }],
          lineStyle: { color: COLOR_THRESHOLD, type: 'dashed', width: 1.5 },
          label: {
            formatter: '경고 10%',
            position: 'end',
            color: COLOR_THRESHOLD,
            fontSize: 11,
          },
        },
      },
    ],
    /**
     * 폰(컨테이너 480px 미만) 전용 덧칠 — ECharts 가 컨테이너 폭을 보고 스스로 고른다(React 상태 없음).
     * 이중 Y축 이름("건수"/"실패율(%)")이 상단 범례와 겹치고, 좌우 여백 115px 가 350px 폭에서 그래프를 절반으로
     * 줄이던 것을 푼다. `media` 는 루트에 둬도 ECharts 가 나머지를 baseOption 으로 읽는다(OptionManager.parseRawOption).
     */
    media: [
      {
        query: { maxWidth: 480 },
        option: {
          legend: { top: 0, itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 } },
          grid: { left: 36, right: 40, top: 36, bottom: 28 },
          xAxis: { axisLabel: { rotate: 0, fontSize: 10, formatter: (v: string) => v.slice(5) } }, // 'MM-DD' (연도는 부제에)
          yAxis: [
            { name: '', axisLabel: { formatter: '{value}', fontSize: 10 } },
            { name: '', axisLabel: { formatter: '{value}%', fontSize: 10 } },
          ],
        },
      },
    ],
  };
}
