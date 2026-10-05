import type { Order } from '@shopping-mall/shared';
import { aggregateDailySales, aggregateTopProducts } from './seller-sales';

const order = (createdAt: string, status: string, subtotals: number[]): Order =>
  ({
    createdAt,
    status,
    items: subtotals.map((subtotal, id) => ({ id, subtotal })),
  }) as unknown as Order;

describe('aggregateDailySales — 주문 목록을 날짜별 매출로', () => {
  it('같은 날(KST)의 주문을 묶고 오래된 날부터 늘어놓는다', () => {
    const days = aggregateDailySales([
      order('2026-08-17T03:00:00.000Z', 'completed', [10000, 5000]),
      order('2026-08-17T01:00:00.000Z', 'shipped', [2000]),
      order('2026-08-15T01:00:00.000Z', 'paid', [7000]),
    ]);
    expect(days).toEqual([
      { date: '2026-08-15', revenue: 7000, orders: 1, cancelled: 0 },
      { date: '2026-08-17', revenue: 17000, orders: 2, cancelled: 0 },
    ]);
  });

  it('날짜는 UTC 가 아니라 한국 시간으로 가른다', () => {
    // UTC 16일 15:30 = KST 17일 00:30
    const [day] = aggregateDailySales([order('2026-08-16T15:30:00.000Z', 'paid', [1000])]);
    expect(day.date).toBe('2026-08-17');
  });

  it('취소·결제 대기 주문은 매출과 주문 수에서 빠진다(취소는 따로 센다)', () => {
    const [day] = aggregateDailySales([
      order('2026-08-17T01:00:00.000Z', 'completed', [3000]),
      order('2026-08-17T02:00:00.000Z', 'cancelled', [9000]),
      order('2026-08-17T03:00:00.000Z', 'pending_payment', [9000]),
    ]);
    expect(day).toEqual({ date: '2026-08-17', revenue: 3000, orders: 1, cancelled: 1 });
  });

  it('금액이 문자열(decimal)로 와도 숫자로 더한다', () => {
    const [day] = aggregateDailySales([
      order('2026-08-17T01:00:00.000Z', 'paid', ['1500.00', '500.00'] as unknown as number[]),
    ]);
    expect(day.revenue).toBe(2000);
  });

  it('목록이 잘렸으면 가장 오래된 날은 버린다(일부만 들어 있을 수 있다)', () => {
    const orders = [
      order('2026-08-17T01:00:00.000Z', 'paid', [1000]),
      order('2026-08-16T01:00:00.000Z', 'paid', [1000]),
      order('2026-08-15T01:00:00.000Z', 'paid', [1000]),
    ];
    expect(aggregateDailySales(orders, { truncated: true }).map((d) => d.date)).toEqual(['2026-08-16', '2026-08-17']);
    expect(aggregateDailySales(orders).map((d) => d.date)).toEqual(['2026-08-15', '2026-08-16', '2026-08-17']);
  });

  it('최근 maxDays 일만 남긴다', () => {
    const orders = ['11', '12', '13', '14'].map((d) => order(`2026-08-${d}T01:00:00.000Z`, 'paid', [1000]));
    expect(aggregateDailySales(orders, { maxDays: 2 }).map((d) => d.date)).toEqual(['2026-08-13', '2026-08-14']);
  });

  it('주문이 없으면 빈 배열', () => {
    expect(aggregateDailySales([])).toEqual([]);
  });
});

describe('aggregateTopProducts — 상품별 매출 상위', () => {
  const withItems = (status: string, items: Array<[number, string, number, number]>): Order =>
    ({
      createdAt: '2026-08-17T01:00:00.000Z',
      status,
      items: items.map(([productId, productName, subtotal, quantity], id) => ({ id, productId, productName, subtotal, quantity })),
    }) as unknown as Order;

  it('같은 상품을 주문 여러 건에서 합치고 매출 큰 순으로 늘어놓는다', () => {
    const top = aggregateTopProducts([
      withItems('completed', [[1, '사과', 3000, 1], [2, '배', 10000, 2]]),
      withItems('shipped', [[1, '사과', 6000, 2]]),
    ]);
    expect(top).toEqual([
      { productId: 2, name: '배', revenue: 10000, quantity: 2 },
      { productId: 1, name: '사과', revenue: 9000, quantity: 3 },
    ]);
  });

  it('취소·결제 대기 주문의 상품은 세지 않는다', () => {
    const top = aggregateTopProducts([
      withItems('cancelled', [[1, '사과', 99000, 9]]),
      withItems('pending_payment', [[1, '사과', 99000, 9]]),
      withItems('paid', [[2, '배', 1000, 1]]),
    ]);
    expect(top).toEqual([{ productId: 2, name: '배', revenue: 1000, quantity: 1 }]);
  });

  it('상위 limit 개만 남긴다', () => {
    const orders = [1, 2, 3].map((n) => withItems('paid', [[n, `상품${n}`, n * 1000, 1]]));
    expect(aggregateTopProducts(orders, 2).map((p) => p.productId)).toEqual([3, 2]);
  });
});
