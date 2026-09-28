/**
 * 결제 동시성 통합 테스트 — 진짜 PostgreSQL 위에서 `SELECT … FOR UPDATE` 가 실제로 직렬화하는지 본다.
 *
 * 왜 단위 테스트가 아니라 통합인가: 락은 DB 가 거는 것이라 repository mock 으로는 검증이 안 된다.
 * 왜 HTTP e2e 가 아닌가: verify 는 PortOne 에 실결제를 재조회하므로 e2e 로는 결제 건이 실제로 있어야 한다.
 *   → 서비스 계층에서 PortOne 호출 2개(조회·취소)만 mock 하고, 트랜잭션·락·이벤트 발행은 실물을 쓴다.
 *
 * 사전 조건: docker-compose.local.yaml 의 postgres(기본 localhost:15432, sangmoon/postgres) 와
 *            테스트 DB `shopping_mall_test`(없으면 `createdb`). 스키마는 매 실행마다 dropSchema + synchronize.
 * 실행(backend/ 에서 — 설정 파일 머리 주석 참조):
 *   node ../node_modules/jest/bin/jest.js -c jest.integration.config.js payment.concurrency
 *   PAYMENT_RACE_ROUNDS=30 … 로 라운드 수 조절(기본 10)
 * CI 의 `nx test backend` 는 *.integration.spec.ts 를 제외한다(jest.config.ts testPathIgnorePatterns).
 *
 * 첫 실측(2026-09-29, 로컬 Postgres 18): 3건 통과. 라운드 10 → 먼저 전이시킨 쪽 verify 9 · webhook 1,
 * 매 라운드 order.paid 1회 — 같은 프로세스 안에서도 승자가 갈린다 = 순서를 코드가 가정하면 안 된다는 증거.
 *
 * 고정하는 것 3가지:
 *   1. verify 와 웹훅이 동시에 와도 — 결제·주문은 한 번만 PAID 로 전이하고 `order.paid` 는 정확히 1회.
 *      (이벤트 2회 = 리스너의 재고 차감·Shipment 생성이 두 번 도는 유령 결제)
 *   2. 웹훅이 락을 기다리는 사이 주문이 만료(CANCELLED)되면 — PAID 로 덮어쓰지 않고 자동 환불 분기.
 *      (락 "후" 재검증이 없으면 락을 잡자마자 PAID 로 써 버린다)
 *   3. 같은 verify 가 두 번 오면 — 두 번째는 PortOne 재조회 없이 기존 결과, 이벤트 추가 발행 없음.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';

import { PaymentService } from './payment.service';
import { PaymentEntity, PaymentStatus } from './entity/payment.entity';
import { OrderEntity, OrderStatus } from '../order/entity/order.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import { ShipmentEntity } from '../order/entity/shipment.entity';
import { ProductEntity } from '../product/entity/product.entity';
import { ProductImageEntity } from '../product/entity/product-image.entity';
import { TagEntity } from '../product/entity/tag.entity';
import { ReviewEntity } from '../review/entity/review.entity';
import { CategoryEntity } from '../category/entity/category.entity';
import { SellerEntity } from '../seller/entity/seller.entity';
import { CartEntity } from '../cart/entity/cart.entity';
import { CartItemEntity } from '../cart/entity/cart-item.entity';
import { UserModel } from '../user/entity/user.entity';
import { RoleEntity } from '../user/entity/role.entity';

/**
 * 결제·주문 그래프가 문자열 관계('UserModel' → 'CartEntity' → 'ProductEntity' …)로 닿는 엔티티 전부.
 * 하나라도 빠지면 TypeORM 이 "Entity metadata for X#y was not found" 로 초기화에 실패한다.
 * (글롭 로딩은 jest 안에서 동적 import 가 불안정해 명시 목록으로 둔다)
 */
const ENTITIES = [
  PaymentEntity, OrderEntity, OrderItemEntity, ShipmentEntity,
  UserModel, RoleEntity, CartEntity, CartItemEntity,
  ProductEntity, ProductImageEntity, TagEntity, ReviewEntity, SellerEntity, CategoryEntity,
];

const AMOUNT = 11000;
const RACE_ROUNDS = Number(process.env.PAYMENT_RACE_ROUNDS ?? 10);

describe('PaymentService 동시성 (integration, real Postgres FOR UPDATE)', () => {
  let module: TestingModule;
  let service: PaymentService;
  let dataSource: DataSource;
  let paymentRepo: Repository<PaymentEntity>;
  let orderRepo: Repository<OrderEntity>;
  let user: UserModel;

  const emitter = { emit: jest.fn() };
  let portoneGet: jest.SpyInstance;
  let portoneCancel: jest.SpyInstance;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.POSTGRES_HOST || 'localhost',
          port: Number(process.env.POSTGRES_PORT) || 15432,
          username: process.env.POSTGRES_USER || 'sangmoon',
          password: process.env.POSTGRES_PASSWORD || 'postgres',
          database: process.env.TEST_POSTGRES_DB || 'shopping_mall_test',
          entities: ENTITIES,
          synchronize: true,
          dropSchema: true,
          logging: false,
        }),
        TypeOrmModule.forFeature([PaymentEntity, OrderEntity, OrderItemEntity, ProductEntity]),
      ],
      providers: [
        PaymentService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();

    service = module.get(PaymentService);
    dataSource = module.get(DataSource);
    paymentRepo = module.get(getRepositoryToken(PaymentEntity));
    orderRepo = module.get(getRepositoryToken(OrderEntity));

    user = await dataSource.getRepository(UserModel).save(
      dataSource.getRepository(UserModel).create({
        email: 'race@test.local',
        password: 'hashed',
        nickName: 'race',
        phoneNumber: '01000000000',
        address: 'test',
        isEmailVerified: true,
      }),
    );

    // PortOne V2 조회/취소만 mock — 나머지(트랜잭션·락·이벤트)는 실물
    portoneGet = jest
      .spyOn(service as any, 'getPaymentFromPortOne')
      .mockImplementation(async (paymentId: string) => ({
        paymentId,
        transactionId: `tx_portone_${paymentId}`,
        status: 'PAID',
        amount: { total: AMOUNT, currency: 'KRW' },
        method: { type: 'EASY_PAY' },
        channel: { pgProvider: 'TEST', name: 'test' },
        paidAt: new Date().toISOString(),
        receiptUrl: null,
      }));
    portoneCancel = jest
      .spyOn(service as any, 'cancelPaymentOnPortOne')
      .mockImplementation(async (_paymentId: string, reason: string) => ({
        status: 'SUCCEEDED',
        amount: AMOUNT,
        cancelledAt: new Date().toISOString(),
        reason,
      }));
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(() => {
    emitter.emit.mockClear();
    portoneGet.mockClear();
    portoneCancel.mockClear();
  });

  /** 미결제 주문 + READY 결제 한 쌍. paymentId = orderNumber (운영과 동일). */
  async function createPendingOrder(tag: string) {
    const orderNumber = `ORD-RACE-${Date.now()}-${tag}`;
    const order = await orderRepo.save(
      orderRepo.create({
        orderNumber,
        userId: user.id,
        status: OrderStatus.PENDING_PAYMENT,
        totalAmount: AMOUNT,
        shippingAddress: 'test',
        recipientName: 'test',
        recipientPhone: '01000000000',
      }),
    );
    const payment = await paymentRepo.save(
      paymentRepo.create({
        orderId: order.id,
        paymentId: orderNumber,
        amount: AMOUNT,
        status: PaymentStatus.READY,
      }),
    );
    return { order, payment, orderNumber };
  }

  const paidEventsFor = (orderId: number) =>
    emitter.emit.mock.calls.filter(([name, ev]) => name === 'order.paid' && ev.orderId === orderId);

  it(`1. verify ∥ webhook 동시 호출 ×${RACE_ROUNDS} — 매번 단일 PAID 전이 + order.paid 정확히 1회`, async () => {
    const winners = { verify: 0, webhook: 0 };

    for (let i = 0; i < RACE_ROUNDS; i++) {
      const { order, orderNumber } = await createPendingOrder(`r${i}`);

      // 두 경로가 서로 다른 transactionId 를 쓰게 해서, 최종 행의 값으로 "누가 전이시켰나"를 판별한다.
      const [verifyResult, webhookResult] = await Promise.all([
        service.verifyPayment(user.id, { paymentId: orderNumber, transactionId: `tx_verify_${i}` }),
        service.handleWebhook({
          type: 'Transaction.Paid',
          data: { paymentId: orderNumber, transactionId: `tx_webhook_${i}` },
        } as any),
      ]);

      const payment = await paymentRepo.findOneByOrFail({ paymentId: orderNumber });
      const refreshedOrder = await orderRepo.findOneByOrFail({ id: order.id });

      // 둘 다 예외 없이 끝나고, 결제·주문은 PAID 한 상태로만 정착한다
      expect(verifyResult?.status).toBe(PaymentStatus.PAID);
      expect(webhookResult).toEqual(expect.objectContaining({ message: expect.stringMatching(/ok|already paid/) }));
      expect(payment.status).toBe(PaymentStatus.PAID);
      expect(refreshedOrder.status).toBe(OrderStatus.PAID);

      // 핵심 단언: 상태 전이는 한 번 → 이벤트(재고 차감·Shipment 생성 트리거)도 한 번
      expect(paidEventsFor(order.id)).toHaveLength(1);

      if (payment.transactionId === `tx_verify_${i}`) winners.verify++;
      else if (payment.transactionId === `tx_webhook_${i}`) winners.webhook++;
      else throw new Error(`unexpected transactionId ${payment.transactionId}`);
    }

    // 승자 분포는 단정하지 않는다(스케줄링에 달림). 합이 라운드 수와 같으면 매 라운드 정확히 한 쪽만 썼다는 뜻.
    expect(winners.verify + winners.webhook).toBe(RACE_ROUNDS);
    expect(emitter.emit.mock.calls.filter(([n]) => n === 'order.paid')).toHaveLength(RACE_ROUNDS);
    // eslint-disable-next-line no-console
    console.log(`[race] rounds=${RACE_ROUNDS} winners: verify=${winners.verify} webhook=${winners.webhook}`);
  });

  it('2. 웹훅이 락을 기다리는 동안 주문이 만료되면 — PAID 로 덮어쓰지 않고 자동 환불 분기', async () => {
    const { order, payment, orderNumber } = await createPendingOrder('expire');

    // 다른 트랜잭션이 결제 행을 먼저 잠근다(크론 만료 처리가 진행 중인 상황을 흉내)
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('SELECT id FROM payments WHERE id = $1 FOR UPDATE', [payment.id]);

    // 웹훅 도착: 사전 검사(READY)와 PortOne 재조회는 통과하고, FOR UPDATE 에서 대기하게 된다
    const webhook = service.handleWebhook({
      type: 'Transaction.Paid',
      data: { paymentId: orderNumber, transactionId: 'tx_webhook_late' },
    } as any);

    // 웹훅이 락 대기에 들어갈 시간을 준 뒤, 잠근 쪽이 만료 처리 후 커밋
    await new Promise((r) => setTimeout(r, 300));
    expect(portoneGet).toHaveBeenCalledTimes(1); // 여기까지 왔다 = 락 앞까지 진행했다
    await runner.query(`UPDATE payments SET status = 'failed' WHERE id = $1`, [payment.id]);
    await runner.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [order.id]);
    await runner.commitTransaction();
    await runner.release();

    const result = await webhook;

    // 락을 잡은 뒤의 재검증이 만료를 보고 'expired' 분기로 빠진다
    expect(result).toEqual({ message: 'refunded - order expired' });
    expect(portoneCancel).toHaveBeenCalledTimes(1);
    expect(portoneCancel.mock.calls[0][0]).toBe(orderNumber);

    const after = await paymentRepo.findOneByOrFail({ id: payment.id });
    const afterOrder = await orderRepo.findOneByOrFail({ id: order.id });
    expect(after.status).toBe(PaymentStatus.FAILED); // PAID 로 덮이지 않았다
    expect(afterOrder.status).toBe(OrderStatus.CANCELLED);
    expect(paidEventsFor(order.id)).toHaveLength(0);
  });

  it('3. 같은 verify 가 두 번 오면 — 두 번째는 PortOne 재조회 없이 기존 결과, 이벤트 추가 없음', async () => {
    const { order, orderNumber } = await createPendingOrder('idem');

    const first = await service.verifyPayment(user.id, { paymentId: orderNumber, transactionId: 'tx_1' });
    const callsAfterFirst = portoneGet.mock.calls.length;
    const second = await service.verifyPayment(user.id, { paymentId: orderNumber, transactionId: 'tx_2' });

    expect(first?.status).toBe(PaymentStatus.PAID);
    expect(second?.status).toBe(PaymentStatus.PAID);
    expect(second?.transactionId).toBe('tx_1'); // 두 번째 요청의 값으로 덮이지 않는다
    expect(portoneGet.mock.calls.length).toBe(callsAfterFirst); // 조기 반환 — 외부 호출 없음
    expect(paidEventsFor(order.id)).toHaveLength(1);
  });
});
