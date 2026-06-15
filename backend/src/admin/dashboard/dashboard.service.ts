import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderEntity, OrderStatus } from '../../order/entity/order.entity';
import { AuditAction } from '../../audit/entity/audit-log.entity';
import {
  calcDeltaPercent,
  fillEmptyDates,
  getPreviousPeriod,
  getTodayAndYesterdaySoFar,
  toKstRange,
  validateDateRange,
} from './helpers/time-range.helper';
import { DateRangeQueryDto, OrderTrendQueryDto } from './dto/date-range-query.dto';

/** KPI raw 쿼리 결과 형태 (Postgres → 문자열로 떨어지는 numeric을 Number로 캐스팅 필요) */
interface KpiRawRow {
  today_orders: string;
  yday_orders:  string;
  today_revenue: string | null;
  yday_revenue:  string | null;
  pending_shipments: string;
  today_failed_login: string;
  today_total_login_attempts: string;
}

/** order-trend raw 쿼리 결과 형태 */
interface OrderTrendRawRow {
  date:      string;  // 'YYYY-MM-DD'
  ordered:   string;  // SUM(...)::text
  paid:      string;
  cancelled: string;
}

/** security raw 쿼리 결과 형태 */
interface SecurityRawRow {
  date:    string;
  success: string;
  failed:  string;
  locked:  string;
}

/**
 * funnel raw 쿼리 결과 형태.
 * 모든 집계가 ::text 캐스팅되어 string으로 도착 → 서비스에서 Number().
 * (PostgreSQL의 COUNT/SUM은 numeric을 반환하고, pg driver가 numeric을 string으로 매핑하기 때문.)
 */
interface FunnelRawRow {
  created:   string;  // COUNT(*) — 코호트 전체
  paid:      string;  // COUNT(paid_at)      — paid_at NOT NULL
  shipped:   string;  // COUNT(shipped_at)
  delivered: string;  // COUNT(delivered_at)
  completed: string;  // COUNT(completed_at)
  cancelled: string;  // SUM(... status='cancelled' ...)
}

/** security 서비스 내부 처리용 (Number 캐스팅 후, failureRate 계산 전) */
interface SecurityNumericRow {
  date:    string;
  success: number;
  failed:  number;
  locked:  number;
}

/** order-trend 응답에서 한 점이 가지는 형태 (외부 노출 X — DTO와 동일 모양) */
interface OrderTrendPoint {
  date:      string;
  ordered:   number;
  paid:      number;
  cancelled: number;
}

@Injectable()
export class DashboardService {
  private readonly LOGIN_FAILURE_THRESHOLD = 10; // KPI loginFailureRate 임계 %

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
  ) {}

  /**
   * (AI 어시스턴트 도구 `get_sales_summary` 용)
   * 임의 기간의 결제 완료 매출 합계 + 주문 건수.
   * getKpi의 매출 SQL 패턴(paid_at NOT NULL, SUM(total_amount))을 임의 기간으로 재사용한다.
   * 기간은 KST [start, endNext) 반열림 (toKstRange). 최대 90일(validateDateRange).
   */
  async getSalesSummary(
    startDate: string,
    endDate: string,
  ): Promise<{
    startDate: string;
    endDate: string;
    totalRevenue: number;
    orderCount: number;
  }> {
    const error = validateDateRange(startDate, endDate);
    if (error) throw new BadRequestException(error);

    const [start, endNext] = toKstRange(startDate, endDate);
    const [row]: { revenue: string | null; orders: string }[] =
      await this.orderRepo.query(
        `
        SELECT
          COALESCE(SUM(total_amount), 0)::text AS revenue,
          COUNT(*)::text                       AS orders
        FROM orders
        WHERE paid_at IS NOT NULL AND paid_at >= $1 AND paid_at < $2
        `,
        [start, endNext],
      );

    return {
      startDate,
      endDate,
      totalRevenue: Number(row.revenue ?? 0),
      orderCount: Number(row.orders ?? 0),
    };
  }

  async getKpi() {
    const { todayStart, todayNow, ydayStart, ydayUntilNow } = getTodayAndYesterdaySoFar();

    /**
     * 단일 SQL로 6개 지표를 동시에 집계.
     * - 분리해서 6번 쿼리 = 라운드트립 6회
     * - 단일 쿼리 = 라운드트립 1회 + Postgres가 인덱스 스캔을 한 번에 계획
     * 신입 수준에선 디버깅 어려움이 단점이지만, KPI는 화면에 가장 먼저 뜨는 지표라 응답 속도 우선.
     */
    const [row]: KpiRawRow[] = await this.orderRepo.query(
      `
      SELECT
        -- 1. 오늘 주문 수 (createdAt 기준 — BaseModel 기본 명명: camelCase)
        (SELECT COUNT(*)::text FROM orders
          WHERE "createdAt" >= $1 AND "createdAt" < $2)
          AS today_orders,
        -- 2. 어제 동시간까지 주문 수 (delta% 계산용)
        (SELECT COUNT(*)::text FROM orders
          WHERE "createdAt" >= $3 AND "createdAt" < $4)
          AS yday_orders,
        -- 3. 오늘 매출 (paid_at 기준 — OrderEntity에서 name: 'paid_at' 명시: snake_case)
        (SELECT COALESCE(SUM(total_amount), 0)::text FROM orders
          WHERE paid_at IS NOT NULL AND paid_at >= $1 AND paid_at < $2)
          AS today_revenue,
        -- 4. 어제 동시간까지 매출
        (SELECT COALESCE(SUM(total_amount), 0)::text FROM orders
          WHERE paid_at IS NOT NULL AND paid_at >= $3 AND paid_at < $4)
          AS yday_revenue,
        -- 5. 미처리 배송 (현재 시점 status='paid')
        (SELECT COUNT(*)::text FROM orders WHERE status = $5)
          AS pending_shipments,
        -- 6-1. 오늘 로그인 실패 건수 (audit_logs는 모든 컬럼이 camelCase)
        (SELECT COUNT(*)::text FROM audit_logs
          WHERE action = $6 AND "createdAt" >= $1 AND "createdAt" < $2)
          AS today_failed_login,
        -- 6-2. 오늘 LOGIN(성공) + FAILED_LOGIN 합 (실패율 분모)
        (SELECT COUNT(*)::text FROM audit_logs
          WHERE action IN ($7, $6) AND "createdAt" >= $1 AND "createdAt" < $2)
          AS today_total_login_attempts
      `,
      [
        todayStart, todayNow,
        ydayStart, ydayUntilNow,
        OrderStatus.PAID,
        AuditAction.FAILED_LOGIN,
        AuditAction.LOGIN,
      ],
    );

    const todayOrders   = Number(row.today_orders);
    const ydayOrders    = Number(row.yday_orders);
    const todayRevenue  = Number(row.today_revenue ?? 0);
    const ydayRevenue   = Number(row.yday_revenue ?? 0);
    const pending       = Number(row.pending_shipments);
    const failedLogin   = Number(row.today_failed_login);
    const totalAttempts = Number(row.today_total_login_attempts);

    const failureRate = totalAttempts === 0
      ? 0
      : Math.round((failedLogin / totalAttempts) * 1000) / 10;

    return {
      todayOrders: {
        value:        todayOrders,
        deltaPercent: calcDeltaPercent(todayOrders, ydayOrders),
      },
      todayRevenue: {
        value:        todayRevenue,
        deltaPercent: calcDeltaPercent(todayRevenue, ydayRevenue),
      },
      pendingShipments: { value: pending },
      loginFailureRate: { value: failureRate, threshold: this.LOGIN_FAILURE_THRESHOLD },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * GET /v1/admin/dashboard/security
   *
   * audit_logs에서 LOGIN / FAILED_LOGIN / ACCOUNT_LOCKED 세 액션을
   * KST 일별 GROUP BY하여 보안 차트 데이터로 반환.
   *
   * failureRate = failed / (success + failed) × 100
   * - locked는 시도가 아닌 결과이므로 분모에서 제외
   * - SQL이 아닌 서비스에서 계산: fillEmptyDates + 분모 0 처리를 단일 지점에서 수행
   */
  async getSecurity(query: DateRangeQueryDto) {
    const error = validateDateRange(query.startDate, query.endDate);
    if (error) throw new BadRequestException(error);

    const [start, endNext] = toKstRange(query.startDate, query.endDate);

    const rows: SecurityRawRow[] = await this.orderRepo.query(
      `
      SELECT
        TO_CHAR(
          ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date,
          'YYYY-MM-DD'
        ) AS date,
        SUM(CASE WHEN action = $3 AND success THEN 1 ELSE 0 END)::text AS success,
        SUM(CASE WHEN action = $4                THEN 1 ELSE 0 END)::text AS failed,
        SUM(CASE WHEN action = $5                THEN 1 ELSE 0 END)::text AS locked
      FROM audit_logs
      WHERE "createdAt" >= $1 AND "createdAt" < $2
        AND action IN ($3, $4, $5)
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      [
        start,
        endNext,
        AuditAction.LOGIN,
        AuditAction.FAILED_LOGIN,
        AuditAction.ACCOUNT_LOCKED,
      ],
    );

    const numericRows: SecurityNumericRow[] = rows.map((r) => ({
      date:    r.date,
      success: Number(r.success),
      failed:  Number(r.failed),
      locked:  Number(r.locked),
    }));

    // success도 포함한 채로 fillEmptyDates — total 계산에 필요
    const filled = fillEmptyDates(numericRows, query.startDate, query.endDate, {
      success: 0,
      failed:  0,
      locked:  0,
    });

    const daily = filled.map((r) => {
      const total = r.success + r.failed;
      const failureRate = total > 0
        ? Math.round((r.failed / total) * 1000) / 10
        : 0;
      return { date: r.date, failed: r.failed, locked: r.locked, total, failureRate };
    });

    return { daily, generatedAt: new Date().toISOString() };
  }

  /**
   * GET /v1/admin/dashboard/funnel
   *
   * orders 테이블 단일 쿼리로 5단계 코호트 도달률을 집계.
   *
   * 코호트 정의:
   *   "createdAt이 [start, endNext) 구간 안에 든 주문"을 분모(=created)로 본다.
   *   각 단계 timestamp가 NULL이 아닌 row 수가 그 단계 도달 수.
   *
   * 핵심 트릭:
   *   PostgreSQL `COUNT(column)`은 NULL 제외 카운트.
   *   → `COUNT(paid_at)`만으로 결제까지 간 주문 수가 나옴.
   *
   * 컬럼명 주의 (인수인계 문서에 오류가 있어 직접 검증):
   *   - createdAt: BaseModel @CreateDateColumn 기본 → DB 컬럼은 "createdAt" (camelCase, 쌍따옴표 필수)
   *   - paid_at, shipped_at, delivered_at, completed_at, cancelled_at: OrderEntity에서 name 옵션 명시 → snake_case
   *   - status: enum, snake_case (cancelled, paid, shipped, ...)
   *
   * 단계 정의:
   *   1. 주문 생성  (created)         — COUNT(*)
   *   2. 결제 완료  (paid)            — COUNT(paid_at)
   *   3. 배송 중    (shipped)         — COUNT(shipped_at)
   *   4. 배송 완료  (delivered)       — COUNT(delivered_at)
   *   5. 구매 확정  (completed)       — COUNT(completed_at)
   *
   * rate / dropRate는 SQL이 아닌 서비스에서 계산 (분모 0 처리·소수점 round 단일 지점).
   */
  async getFunnel(query: DateRangeQueryDto) {
    const error = validateDateRange(query.startDate, query.endDate);
    if (error) throw new BadRequestException(error);

    const [start, endNext] = toKstRange(query.startDate, query.endDate);

    const [row]: FunnelRawRow[] = await this.orderRepo.query(
      `
      SELECT
        COUNT(*)::text                                                    AS created,
        COUNT(paid_at)::text                                              AS paid,
        COUNT(shipped_at)::text                                           AS shipped,
        COUNT(delivered_at)::text                                         AS delivered,
        COUNT(completed_at)::text                                         AS completed,
        SUM(CASE WHEN status = $3 THEN 1 ELSE 0 END)::text                AS cancelled
      FROM orders
      WHERE "createdAt" >= $1 AND "createdAt" < $2
      `,
      [start, endNext, OrderStatus.CANCELLED],
    );

    // SQL 결과 전부 string → Number로 캐스팅. row 자체가 없는 경우는
    // PostgreSQL이 빈 결과에도 한 row(모든 값 0/NULL)를 돌려주므로 걱정 없음.
    // 단, COUNT(*)가 0일 때 NULL이 아닌 0으로 떨어지므로 ?? 0 가드는 안전망용.
    const created   = Number(row?.created   ?? 0);
    const paid      = Number(row?.paid      ?? 0);
    const shipped   = Number(row?.shipped   ?? 0);
    const delivered = Number(row?.delivered ?? 0);
    const completed = Number(row?.completed ?? 0);
    const cancelled = Number(row?.cancelled ?? 0);

    // created=0이면 모든 rate/dropRate=0. 분모 0 처리는 단일 헬퍼로.
    const rate = (n: number) =>
      created > 0 ? Math.round((n / created) * 1000) / 10 : 0;
    // 직전 단계 대비 이탈률. prev=0이면 0.
    const drop = (prev: number, curr: number) =>
      prev > 0 ? Math.round(((prev - curr) / prev) * 1000) / 10 : 0;

    const stages = [
      { name: '주문 생성', count: created,   rate: rate(created),   dropRate: 0                       },
      { name: '결제 완료', count: paid,      rate: rate(paid),      dropRate: drop(created,   paid)   },
      { name: '배송 중',   count: shipped,   rate: rate(shipped),   dropRate: drop(paid,      shipped)},
      { name: '배송 완료', count: delivered, rate: rate(delivered), dropRate: drop(shipped,   delivered)},
      { name: '구매 확정', count: completed, rate: rate(completed), dropRate: drop(delivered, completed)},
    ];

    return {
      period: { start: query.startDate, end: query.endDate },
      stages,
      cancelledCount: cancelled,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * GET /v1/admin/dashboard/order-trend
   *
   * audit_logs에서 ORDER_CREATED / PAYMENT_VERIFIED / ORDER_CANCELLED 세 액션을
   * KST 일별 GROUP BY 하여 꺾은선 차트 데이터로 반환한다.
   *
   * compareWithPrevious=true 면 동일 길이의 직전 기간을 한 번 더 쿼리.
   */
  async getOrderTrend(query: OrderTrendQueryDto) {
    const { startDate, endDate, compareWithPrevious } = query;

    // 1) 기간 검증 (90일 초과 / start > end)
    const error = validateDateRange(startDate, endDate);
    if (error) throw new BadRequestException(error);

    // 2) 현재 기간 집계
    const current = await this.queryOrderTrend(startDate, endDate);

    // 3) 직전 기간 (옵션)
    let previous: OrderTrendPoint[] | undefined;
    if (compareWithPrevious) {
      const prev = getPreviousPeriod(startDate, endDate);
      previous = await this.queryOrderTrend(prev.startDate, prev.endDate);
    }

    return {
      current,
      previous,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 일별 주문/결제/취소 카운트 집계 단일 쿼리.
   * - createdAt은 camelCase 컬럼이라 쌍따옴표 필수
   * - AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul' 두 번:
   *     ① "이 timestamp는 UTC다" 라고 알려줘서 timestamptz로 캐스팅
   *     ② Asia/Seoul 로컬로 다시 변환
   *   한 번만 쓰면 9시간 어긋남.
   * - GROUP BY 1 (= 첫 번째 SELECT 표현식) — TO_CHAR 결과로 그루핑
   */
  private async queryOrderTrend(
    startDate: string,
    endDate: string,
  ): Promise<OrderTrendPoint[]> {
    const [start, endNext] = toKstRange(startDate, endDate);

    const rows: OrderTrendRawRow[] = await this.orderRepo.query(
      `
      SELECT
        TO_CHAR(
          ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date,
          'YYYY-MM-DD'
        ) AS date,
        SUM(CASE WHEN action = $3 AND success THEN 1 ELSE 0 END)::text AS ordered,
        SUM(CASE WHEN action = $4 AND success THEN 1 ELSE 0 END)::text AS paid,
        SUM(CASE WHEN action = $5 AND success THEN 1 ELSE 0 END)::text AS cancelled
      FROM audit_logs
      WHERE "createdAt" >= $1 AND "createdAt" < $2
        AND action IN ($3, $4, $5)
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      [
        start,
        endNext,
        AuditAction.ORDER_CREATED,
        AuditAction.PAYMENT_VERIFIED,
        AuditAction.ORDER_CANCELLED,
      ],
    );

    const parsed: OrderTrendPoint[] = rows.map((r) => ({
      date:      r.date,
      ordered:   Number(r.ordered),
      paid:      Number(r.paid),
      cancelled: Number(r.cancelled),
    }));

    // SQL은 데이터 있는 날짜만 반환 → 빈 날짜를 0으로 채워 차트 x축이 끊기지 않게 함
    return fillEmptyDates(parsed, startDate, endDate, {
      ordered:   0,
      paid:      0,
      cancelled: 0,
    });
  }
}
