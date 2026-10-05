import type { EChartsOption } from 'echarts';
import type { Order } from '@shopping-mall/shared';

/**
 * 셀러 대시보드의 일별 매출 그래프 — 집계(순수 함수)와 ECharts 옵션 빌더.
 *
 * 전용 집계 API 가 없어서 **주문 목록 응답을 화면에서 날짜별로 묶는다**(01-2 D4 — 백엔드 변경 0).
 * 그래서 지켜야 하는 것 두 가지:
 *   1. 목록이 잘렸으면(전체 건수 > 받은 건수) 가장 오래된 날은 일부만 들어 있을 수 있다 → 그 날은 버린다.
 *   2. X축은 달력이 아니라 **주문이 있던 날**이다. 주문 없는 날을 0 으로 채우지 않는다
 *      (시드 주문은 몇 달 전 날짜라, 달력 축이면 빈 구간이 그래프를 다 차지한다).
 */

export interface DailySales {
  /** 'YYYY-MM-DD' (KST) */
  date: string;
  /** 매출로 잡는 주문의 내 상품 금액 합 */
  revenue: number;
  /** 매출로 잡는 주문 수 */
  orders: number;
  /** 취소된 주문 수(매출·주문 수에서 빠진다) */
  cancelled: number;
}

/** 결제 전·취소 주문은 매출이 아니다 */
const NOT_SALES = new Set(['pending_payment', 'cancelled']);

function kstDate(value: string | Date): string {
  return new Date(value).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 10);
}

/**
 * 주문 목록 → 날짜별 매출(오래된 날 → 최근 날).
 * `items` 는 백엔드가 내 상품만 걸러 주므로 그 합이 "내 매출"이다(주문/배송 화면과 같은 계산).
 *
 * @param truncated 받은 목록이 전체의 일부인가 — 참이면 가장 오래된 날을 버린다
 * @param maxDays   최근 며칠(주문이 있던 날 기준)까지 보여 줄지
 */
export function aggregateDailySales(
  orders: readonly Order[],
  { truncated = false, maxDays = 14 }: { truncated?: boolean; maxDays?: number } = {},
): DailySales[] {
  const byDate = new Map<string, DailySales>();
  for (const order of orders) {
    const date = kstDate(order.createdAt);
    const day = byDate.get(date) ?? { date, revenue: 0, orders: 0, cancelled: 0 };
    if (order.status === 'cancelled') {
      day.cancelled += 1;
    } else if (!NOT_SALES.has(order.status)) {
      day.orders += 1;
      day.revenue += order.items.reduce((sum, item) => sum + Number(item.subtotal), 0);
    }
    byDate.set(date, day);
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const complete = truncated ? days.slice(1) : days;
  return complete.slice(-maxDays);
}

const COLOR_REVENUE = '#3b82f6'; // blue-500 — 막대(매출)
const COLOR_ORDERS = '#f59e0b'; // amber-500 — 선(주문 수)

const formatWon = (value: number) => `${value.toLocaleString('ko-KR')}원`;

/** 축 눈금용 — 12,000 → '1.2만', 900 → '900' */
function compactWon(value: number): string {
  if (value >= 10000) return `${(value / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만`;
  return value.toLocaleString('ko-KR');
}

export function buildSellerSalesOption(days: readonly DailySales[]): EChartsOption {
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const first = (Array.isArray(params) ? params[0] : params) as { dataIndex: number };
        const day = days[first.dataIndex];
        // 옵션 교체 중 이전 dataIndex 로 불릴 수 있어 방어(관리자 차트와 같은 처리)
        if (!day) return '';
        return [
          `<b>${day.date}</b>`,
          `내 매출: ${formatWon(day.revenue)}`,
          `주문: ${day.orders}건`,
          ...(day.cancelled > 0 ? [`취소: ${day.cancelled}건`] : []),
        ].join('<br/>');
      },
    },
    legend: { data: ['내 매출', '주문 수'], top: 0 },
    grid: { left: 56, right: 44, top: 40, bottom: 28 },
    xAxis: {
      type: 'category',
      data: days.map((d) => d.date.slice(5)), // 'MM-DD' — 연도는 부제에
      axisLabel: { rotate: days.length > 10 ? 30 : 0 },
    },
    yAxis: [
      { type: 'value', position: 'left', axisLabel: { formatter: (v: number) => compactWon(v) } },
      { type: 'value', position: 'right', minInterval: 1, splitLine: { show: false }, axisLabel: { formatter: '{value}건' } },
    ],
    series: [
      {
        name: '내 매출',
        type: 'bar',
        yAxisIndex: 0,
        data: days.map((d) => d.revenue),
        barMaxWidth: 32,
        itemStyle: { color: COLOR_REVENUE, borderRadius: [4, 4, 0, 0] },
      },
      {
        name: '주문 수',
        type: 'line',
        yAxisIndex: 1,
        data: days.map((d) => d.orders),
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: COLOR_ORDERS, width: 2 },
        itemStyle: { color: COLOR_ORDERS },
      },
    ],
    // 폰(컨테이너 480px 미만) — 좌우 여백과 글자를 줄인다(관리자 차트와 같은 방식)
    media: [
      {
        query: { maxWidth: 480 },
        option: {
          legend: { itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 } },
          grid: { left: 40, right: 30, top: 34, bottom: 28 },
          xAxis: { axisLabel: { fontSize: 10 } },
          yAxis: [{ axisLabel: { fontSize: 10 } }, { axisLabel: { fontSize: 10, formatter: '{value}' } }],
        },
      },
    ],
  };
}

// ──────────────────────────────────────────────
// 상품별 매출 TOP N
// ──────────────────────────────────────────────

export interface ProductSales {
  productId: number;
  name: string;
  revenue: number;
  quantity: number;
}

/**
 * 주문 목록 → 상품별 매출 상위 N개(매출 큰 순). 매출로 잡는 주문만 센다(취소·결제 대기 제외).
 * 이름은 주문 시점의 스냅샷(`productName`)이라 상품명이 바뀌어도 같은 상품은 `productId` 로 묶는다.
 */
export function aggregateTopProducts(orders: readonly Order[], limit = 5): ProductSales[] {
  const byProduct = new Map<number, ProductSales>();
  for (const order of orders) {
    if (NOT_SALES.has(order.status)) continue;
    for (const item of order.items) {
      const entry =
        byProduct.get(item.productId) ??
        { productId: item.productId, name: item.productName, revenue: 0, quantity: 0 };
      entry.revenue += Number(item.subtotal);
      entry.quantity += Number(item.quantity);
      byProduct.set(item.productId, entry);
    }
  }
  return [...byProduct.values()]
    .sort((a, b) => b.revenue - a.revenue || a.productId - b.productId)
    .slice(0, limit);
}

const COLOR_TOP = '#6366f1'; // indigo-500

/** 축 라벨이 그래프 폭을 먹지 않게 긴 상품명은 줄인다(전체 이름은 툴팁에) */
function shorten(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function buildTopProductsOption(products: readonly ProductSales[]): EChartsOption {
  // 가로 막대는 아래에서 위로 쌓이므로 1위가 맨 위에 오게 뒤집는다
  const rows = [...products].reverse();
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const first = (Array.isArray(params) ? params[0] : params) as { dataIndex: number };
        const row = rows[first.dataIndex];
        if (!row) return '';
        return [`<b>${row.name}</b>`, `매출: ${formatWon(row.revenue)}`, `판매: ${row.quantity}개`].join('<br/>');
      },
    },
    grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => compactWon(v) }, splitNumber: 3 },
    yAxis: {
      type: 'category',
      data: rows.map((row) => shorten(row.name, 14)),
      axisTick: { show: false },
      axisLabel: { fontSize: 12 },
    },
    series: [
      {
        type: 'bar',
        data: rows.map((row) => row.revenue),
        barMaxWidth: 22,
        itemStyle: { color: COLOR_TOP, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontSize: 11, color: '#475569', formatter: (p) => compactWon(Number(p.value)) },
      },
    ],
    media: [
      {
        query: { maxWidth: 420 },
        option: { yAxis: { data: rows.map((row) => shorten(row.name, 9)), axisLabel: { fontSize: 11 } } },
      },
    ],
  };
}
