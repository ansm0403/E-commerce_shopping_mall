import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { PaymentEntity, PaymentStatus } from './entity/payment.entity';
import { OrderEntity, OrderStatus } from '../order/entity/order.entity';
import { ShipmentEntity } from '../order/entity/shipment.entity';
import { ProductEntity } from '../product/entity/product.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { CancelPaymentDto } from './dto/cancel-payment.dto';
import { WebhookPaymentDto } from './dto/webhook-payment.dto';
import { OrderPaidEvent, OrderCancelledEvent } from '../order/events/order.events';

// ─── 포트원 V2 응답 타입 ──────────────────────────────────────────────────────

interface PortOneV2Payment {
  paymentId: string;
  transactionId: string;
  status: 'PAID' | 'FAILED' | 'CANCELLED' | 'PAY_PENDING' | 'VIRTUAL_ACCOUNT_ISSUED';
  amount: { total: number; currency: string };
  method?: { type: string };
  channel?: { pgProvider: string; name: string };
  paidAt: string | null;
  receiptUrl: string | null;
}

interface PortOneV2Cancellation {
  status: 'SUCCEEDED' | 'FAILED';
  amount: number;
  cancelledAt: string | null;
  reason: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private static readonly PORTONE_API_URL = 'https://api.portone.io';

  constructor(
    @InjectRepository(PaymentEntity)
    private readonly paymentRepository: Repository<PaymentEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemRepository: Repository<OrderItemEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    private readonly dataSource: DataSource,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ──────────── 포트원 V2 API 통신 ────────────

  /**
   * V2: API Secret을 Authorization 헤더에 직접 사용.
   * V1의 imp_key + imp_secret → access_token 방식 완전 제거.
   */
  private getAuthHeader(): Record<string, string> {
    const secret = this.configService.get<string>('PORTONE_API_SECRET');
    if (!secret) {
      throw new InternalServerErrorException('포트원 API Secret이 설정되지 않았습니다.');
    }
    return { Authorization: `PortOne ${secret}` };
  }

  /** 포트원 V2에서 결제 정보 조회 */
  private async getPaymentFromPortOne(paymentId: string): Promise<PortOneV2Payment> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(
          `${PaymentService.PORTONE_API_URL}/payments/${encodeURIComponent(paymentId)}`,
          { headers: this.getAuthHeader() },
        ),
      );
      // V2는 응답 래퍼 없이 결제 객체를 바로 반환
      return data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const msg = error.response?.data?.message ?? error.message;
        this.logger.error(`포트원 V2 결제 조회 실패: ${msg}, paymentId: ${paymentId}`);
        throw new InternalServerErrorException('결제 정보 조회에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
      throw error;
    }
  }

  /** 포트원 V2에 결제 취소 요청 */
  private async cancelPaymentOnPortOne(
    paymentId: string,
    reason: string,
    amount?: number,
  ): Promise<PortOneV2Cancellation> {
    const body: { reason: string; amount?: number } = { reason };
    if (amount !== undefined) body.amount = amount;

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          `${PaymentService.PORTONE_API_URL}/payments/${encodeURIComponent(paymentId)}/cancel`,
          body,
          { headers: this.getAuthHeader() },
        ),
      );
      // V2 취소 응답: { cancellation: { status, amount, cancelledAt, ... } }
      return data.cancellation;
    } catch (error) {
      if (error instanceof AxiosError) {
        const msg = error.response?.data?.message ?? error.message;
        this.logger.error(`포트원 V2 결제 취소 실패: ${msg}, paymentId: ${paymentId}`);
        throw new InternalServerErrorException('결제 취소 요청에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
      throw error;
    }
  }

  // ──────────── 공개 메서드 ────────────

  /**
   * 결제 검증 (핵심)
   * 1. 포트원 V2에서 실제 결제 정보 조회
   * 2. DB 주문 금액과 비교 (위변조 방지)
   * 3. 멱등성: 이미 PAID면 기존 결과 반환
   * 4. 트랜잭션: Payment → PAID, Order → PAID
   */
  async verifyPayment(userId: number, dto: VerifyPaymentDto) {
    // Payment 조회 (paymentId = orderNumber = merchantUid 컬럼)
    const payment = await this.paymentRepository.findOne({
      where: { paymentId: dto.paymentId },
      relations: ['order'],
    });
    if (!payment) {
      throw new NotFoundException(`결제 정보를 찾을 수 없습니다: ${dto.paymentId}`);
    }

    // 본인 주문 확인
    if (payment.order.userId !== userId) {
      throw new ForbiddenException('본인의 주문만 결제할 수 있습니다.');
    }

    // 멱등성: 이미 결제 완료된 경우
    if (payment.status === PaymentStatus.PAID) {
      this.logger.log(`중복 결제 검증 요청 — paymentId: ${dto.paymentId}`);
      return payment;
    }

    // 이미 취소/실패된 주문
    if (payment.status === PaymentStatus.FAILED || payment.status === PaymentStatus.CANCELLED) {
      this.logger.warn(
        `만료/취소된 주문에 결제 검증 시도 — paymentId: ${dto.paymentId}, status: ${payment.status}`,
      );

      // V2에서 실제로 결제가 됐다면 자동 환불
      try {
        const portonePayment = await this.getPaymentFromPortOne(dto.paymentId);
        // V2 상태값은 대문자
        if (portonePayment.status === 'PAID') {
          this.logger.warn(`만료된 주문에 대한 포트원 결제 감지 — 자동 취소. paymentId: ${dto.paymentId}`);
          await this.cancelPaymentOnPortOne(dto.paymentId, '주문 만료 후 결제 건 자동 취소');
        }
      } catch (e) {
        this.logger.error(`만료 주문 자동 취소 처리 실패: ${e instanceof Error ? e.message : e}`);
      }

      throw new BadRequestException('이미 취소되었거나 만료된 주문입니다. 주문을 다시 생성해주세요.');
    }

    // 1. 포트원 V2 결제 정보 조회
    const portonePayment = await this.getPaymentFromPortOne(dto.paymentId);

    // 2. 결제 상태 확인 (V2는 대문자)
    if (portonePayment.status !== 'PAID') {
      throw new BadRequestException(`결제가 완료되지 않았습니다. 상태: ${portonePayment.status}`);
    }

    // 3. 금액 위변조 검증 (V2: amount.total)
    const expectedAmount = Number(payment.amount);
    const actualAmount = portonePayment.amount?.total;
    if (actualAmount !== expectedAmount) {
      this.logger.error(
        `금액 위변조 감지! expected: ${expectedAmount}, actual: ${actualAmount}, paymentId: ${dto.paymentId}`,
      );
      try {
        await this.cancelPaymentOnPortOne(dto.paymentId, '결제 금액 위변조 감지');
      } catch (e) {
        this.logger.error(`위변조 건 자동 취소 실패: ${e instanceof Error ? e.message : e}`);
      }
      throw new BadRequestException('결제 금액이 일치하지 않습니다. 결제가 취소되었습니다.');
    }

    // ────────────────────────────────────────────────────────────────────────
    // 4. 트랜잭션: SELECT FOR UPDATE → 상태 재검증 → 갱신
    //
    // [왜 이렇게 짰나 — 유령 결제 방지]
    // 사용자의 결제 검증 요청과 PG사 웹훅이 거의 동시에 도착할 수 있다.
    // 만약 락 없이 그냥 UPDATE만 하면, 두 요청이 동시에 PAID로 업데이트되어
    // "한 결제가 두 번 처리"되는 유령 결제가 발생한다.
    // → 같은 결제 행에 쓰기 잠금을 걸어 한 줄로 세우고, 락을 잡은 뒤
    //   상태를 한 번 더 확인해서 "이미 처리됐으면 그냥 종료" 한다.
    // ────────────────────────────────────────────────────────────────────────
    const updated = await this.dataSource.transaction(async (manager) => {
      // (1) 결제 행을 "쓰기 잠금"으로 조회.
      //     같은 결제를 동시에 처리하려는 다른 트랜잭션은 여기서 대기하게 됨.
      //     (PostgreSQL의 SELECT ... FOR UPDATE)
      const locked = await manager
        .createQueryBuilder(PaymentEntity, 'p')
        .setLock('pessimistic_write')
        .where('p.id = :id', { id: payment.id })
        .getOne();

      if (!locked) throw new NotFoundException('결제 정보가 삭제되었습니다.');

      // (2) 락이 풀리고 내가 들어왔을 때, 이미 다른 요청(예: 웹훅)이
      //     PAID로 바꿔놨다면 여기서 즉시 종료 → 중복 처리 방지.
      if (locked.status === PaymentStatus.PAID) return null;

      // (3) "진짜 처음 처리되는 경우"에만 PAID로 갱신.
      await manager.update(PaymentEntity, payment.id, {
        transactionId: dto.transactionId,
        status: PaymentStatus.PAID,
        // V2 필드 매핑: method.type, channel.pgProvider, paidAt(ISO문자열)
        paymentMethod: portonePayment.method?.type ?? null,
        pgProvider: portonePayment.channel?.pgProvider ?? null,
        receiptUrl: portonePayment.receiptUrl ?? null,
        paidAt: portonePayment.paidAt ? new Date(portonePayment.paidAt) : null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawResponse: portonePayment as any,
      });

      // (4) Order도 같은 트랜잭션에서 함께 갱신 → 둘 중 하나만 성공하는 일이 없도록.
      await manager.update(OrderEntity, payment.orderId, {
        status: OrderStatus.PAID,
        paidAt: portonePayment.paidAt ? new Date(portonePayment.paidAt) : null,
      });

      return locked;
    });

    if (updated) {
      this.eventEmitter.emit(
        'order.paid',
        new OrderPaidEvent(payment.orderId, userId, payment.paymentId, dto.transactionId),
      );
    }

    return this.paymentRepository.findOne({ where: { id: payment.id }, relations: ['order'] });
  }

  /**
   * 결제 취소 (결제 완료 후 취소 = 환불)
   */
  async cancelPayment(userId: number, orderNumber: string, dto: CancelPaymentDto) {
    const order = await this.orderRepository.findOne({
      where: { orderNumber },
      relations: ['items', 'payment'],
    });
    if (!order) throw new NotFoundException(`주문번호 ${orderNumber}를 찾을 수 없습니다.`);
    if (order.userId !== userId) throw new ForbiddenException('본인의 주문만 취소할 수 있습니다.');

    if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.PREPARING) {
      throw new BadRequestException('결제 완료 또는 상품 준비 중 상태의 주문만 취소할 수 있습니다.');
    }

    if (!order.payment) throw new BadRequestException('결제 정보를 찾을 수 없습니다.');

    // V2: paymentId(= orderNumber)로 취소 요청 (transactionId 불필요)
    const cancelResult = await this.cancelPaymentOnPortOne(order.payment.paymentId, dto.reason);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(PaymentEntity, order.payment.id, {
        status: PaymentStatus.CANCELLED,
        cancelledAt: cancelResult.cancelledAt ? new Date(cancelResult.cancelledAt) : new Date(),
        cancelAmount: cancelResult.amount,
        cancelReason: dto.reason,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawResponse: cancelResult as any,
      });

      await manager.update(OrderEntity, order.id, {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: dto.reason,
      });

      if (order.status === OrderStatus.PREPARING) {
        await manager.delete(ShipmentEntity, { orderId: order.id });
      }

      for (const item of order.items) {
        await manager
          .createQueryBuilder()
          .update(ProductEntity)
          .set({
            stockQuantity: () => `"stockQuantity" + :restoreQty`,
            salesCount: () => `GREATEST("salesCount" - :salesQty, 0)`,
          })
          .setParameter('restoreQty', item.quantity)
          .setParameter('salesQty', item.quantity)
          .where('id = :id', { id: item.productId })
          .execute();
      }
    });

    this.eventEmitter.emit(
      'order.cancelled',
      new OrderCancelledEvent(order.id, userId, orderNumber, dto.reason, true),
    );

    return this.paymentRepository.findOne({ where: { id: order.payment.id }, relations: ['order'] });
  }

  /** 관리자: 결제 취소 */
  async cancelPaymentByAdmin(orderNumber: string, dto: CancelPaymentDto) {
    const order = await this.orderRepository.findOne({
      where: { orderNumber },
      relations: ['items', 'payment'],
    });
    if (!order) throw new NotFoundException(`주문번호 ${orderNumber}를 찾을 수 없습니다.`);

    if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.PREPARING) {
      throw new BadRequestException('결제 완료 또는 상품 준비 중 상태의 주문만 취소할 수 있습니다.');
    }

    if (!order.payment) throw new BadRequestException('결제 정보를 찾을 수 없습니다.');

    const cancelResult = await this.cancelPaymentOnPortOne(order.payment.paymentId, dto.reason);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(PaymentEntity, order.payment.id, {
        status: PaymentStatus.CANCELLED,
        cancelledAt: cancelResult.cancelledAt ? new Date(cancelResult.cancelledAt) : new Date(),
        cancelAmount: cancelResult.amount,
        cancelReason: dto.reason,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawResponse: cancelResult as any,
      });

      await manager.update(OrderEntity, order.id, {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: dto.reason,
      });

      await manager.delete(ShipmentEntity, { orderId: order.id });

      for (const item of order.items) {
        await manager
          .createQueryBuilder()
          .update(ProductEntity)
          .set({
            stockQuantity: () => `"stockQuantity" + :restoreQty`,
            salesCount: () => `GREATEST("salesCount" - :salesQty, 0)`,
          })
          .setParameter('restoreQty', item.quantity)
          .setParameter('salesQty', item.quantity)
          .where('id = :id', { id: item.productId })
          .execute();
      }
    });

    this.eventEmitter.emit(
      'order.cancelled',
      new OrderCancelledEvent(order.id, order.userId, orderNumber, dto.reason, true),
    );

    return this.paymentRepository.findOne({ where: { id: order.payment.id }, relations: ['order'] });
  }

  // ──────────── V2 웹훅 ────────────

  /**
   * PortOne V2 웹훅 처리
   * V2는 type 필드로 이벤트 구분: Transaction.Paid / Transaction.Cancelled / ...
   * V2도 5xx 시 재시도하므로 내부 에러는 200으로 응답.
   */
  async handleWebhook(dto: WebhookPaymentDto) {
    const { type, data } = dto;
    this.logger.log(`PortOne V2 웹훅 수신 — type: ${type}, paymentId: ${data.paymentId}`);

    try {
      return await this.processWebhook(type, data.paymentId, data.transactionId);
    } catch (error) {
      this.logger.error(
        `V2 웹훅 처리 중 예외 — type: ${type}, paymentId: ${data.paymentId}, ` +
        `error: ${error instanceof Error ? error.message : error}`,
        error instanceof Error ? error.stack : undefined,
      );
      return { message: 'internal error', error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async processWebhook(type: string, paymentId: string, transactionId?: string) {
    // Transaction.Paid만 처리 (취소는 우리 서버에서 먼저 발행하므로 웹훅 불필요)
    if (type !== 'Transaction.Paid') {
      this.logger.log(`V2 웹훅 타입 ${type} — 처리 스킵`);
      return { message: 'ok' };
    }

    const payment = await this.paymentRepository.findOne({
      where: { paymentId },
      relations: ['order'],
    });

    if (!payment) {
      this.logger.warn(`V2 웹훅: 결제 정보를 찾을 수 없음 — paymentId: ${paymentId}`);
      return { message: 'payment not found' };
    }

    if (payment.status === PaymentStatus.PAID) {
      this.logger.log(`V2 웹훅: 이미 결제 완료 — paymentId: ${paymentId}`);
      return { message: 'already paid' };
    }

    if (payment.status === PaymentStatus.FAILED || payment.status === PaymentStatus.CANCELLED) {
      this.logger.warn(`V2 웹훅: 만료/취소된 주문에 결제 감지 — 자동 취소. paymentId: ${paymentId}`);
      try {
        await this.cancelPaymentOnPortOne(paymentId, '주문 만료/취소 후 결제 건 자동 환불 (웹훅)');
      } catch (e) {
        this.logger.error(`V2 웹훅: 자동 환불 실패 — ${e instanceof Error ? e.message : e}`);
      }
      return { message: 'refunded - order expired' };
    }

    const portonePayment = await this.getPaymentFromPortOne(paymentId);

    if (portonePayment.status !== 'PAID') {
      this.logger.warn(`V2 웹훅: 포트원 상태 불일치 — expected: PAID, actual: ${portonePayment.status}`);
      return { message: 'portone status mismatch' };
    }

    const expectedAmount = Number(payment.amount);
    const actualAmount = portonePayment.amount?.total;
    if (actualAmount !== expectedAmount) {
      this.logger.error(`V2 웹훅: 금액 위변조! expected: ${expectedAmount}, actual: ${actualAmount}`);
      try {
        await this.cancelPaymentOnPortOne(paymentId, '결제 금액 위변조 감지 (웹훅)');
      } catch (e) {
        this.logger.error(`V2 웹훅: 위변조 건 자동 취소 실패 — ${e instanceof Error ? e.message : e}`);
      }
      return { message: 'amount mismatch - refunded' };
    }

    const updated = await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .createQueryBuilder(PaymentEntity, 'p')
        .setLock('pessimistic_write')
        .where('p.id = :id', { id: payment.id })
        .getOne();

      if (!locked) return null;
      if (locked.status === PaymentStatus.PAID) return null;

      if (locked.status === PaymentStatus.FAILED || locked.status === PaymentStatus.CANCELLED) {
        return 'expired' as const;
      }

      await manager.update(PaymentEntity, payment.id, {
        transactionId: transactionId ?? portonePayment.transactionId ?? null,
        status: PaymentStatus.PAID,
        paymentMethod: portonePayment.method?.type ?? null,
        pgProvider: portonePayment.channel?.pgProvider ?? null,
        receiptUrl: portonePayment.receiptUrl ?? null,
        paidAt: portonePayment.paidAt ? new Date(portonePayment.paidAt) : null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawResponse: portonePayment as any,
      });

      await manager.update(OrderEntity, payment.orderId, {
        status: OrderStatus.PAID,
        paidAt: portonePayment.paidAt ? new Date(portonePayment.paidAt) : null,
      });

      return 'processed' as const;
    });

    if (updated === 'expired') {
      this.logger.warn(`V2 웹훅: 잠금 후 만료 감지 — 자동 환불. paymentId: ${paymentId}`);
      try {
        await this.cancelPaymentOnPortOne(paymentId, '주문 만료/취소 후 결제 건 자동 환불 (웹훅)');
      } catch (e) {
        this.logger.error(`V2 웹훅: 자동 환불 실패 — ${e instanceof Error ? e.message : e}`);
      }
      return { message: 'refunded - order expired' };
    }

    if (updated === 'processed') {
      this.eventEmitter.emit(
        'order.paid',
        new OrderPaidEvent(
          payment.orderId,
          payment.order.userId,
          payment.paymentId,
          transactionId ?? portonePayment.transactionId ?? '',
        ),
      );
      this.logger.log(`V2 웹훅: 결제 검증 완료 — paymentId: ${paymentId}`);
    } else {
      this.logger.log(`V2 웹훅: 이미 처리됨 (verifyPayment 선행) — paymentId: ${paymentId}`);
    }

    return { message: 'ok' };
  }
}
