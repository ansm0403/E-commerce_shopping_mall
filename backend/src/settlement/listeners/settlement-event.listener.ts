import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettlementEntity, SettlementStatus } from '../entity/settlement.entity';
import { OrderItemEntity } from '../../order/entity/order-item.entity';
import { OrderEntity } from '../../order/entity/order.entity';
import { OrderCompletedEvent } from '../../order/events/shipment.events';
import { withRetry } from '../../common/utils/with-retry';

const DEFAULT_COMMISSION_RATE = 10.0; // 10%

@Injectable()
export class SettlementEventListener {
  private readonly logger = new Logger(SettlementEventListener.name);

  constructor(
    @InjectRepository(SettlementEntity)
    private readonly settlementRepository: Repository<SettlementEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemRepository: Repository<OrderItemEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
  ) {}

  @OnEvent('order.completed')
  async handleOrderCompleted(event: OrderCompletedEvent) {
    this.logger.log(
      `구매 확정 → 정산 레코드 생성 시작 — orderId: ${event.orderId}, orderNumber: ${event.orderNumber}`,
    );

    await withRetry(
      () => this.processOrderCompleted(event),
      `order.completed(orderId=${event.orderId})`,
    );
  }

  private async processOrderCompleted(event: OrderCompletedEvent) {
    const order = await this.orderRepository.findOne({
      where: { id: event.orderId },
    });
    if (!order) {
      this.logger.error(`주문을 찾을 수 없음 — orderId: ${event.orderId}`);
      return;
    }

    const items = await this.orderItemRepository.find({
      where: { orderId: event.orderId },
    });

    // 셀러별 매출액 집계 — sellerId=null(셀러 없는 시드 상품)은 정산 대상이 아니다(§7-5)
    const sellerAmountMap = new Map<number, number>();
    for (const item of items) {
      if (item.sellerId == null) continue;
      const current = sellerAmountMap.get(item.sellerId) ?? 0;
      sellerAmountMap.set(item.sellerId, current + Number(item.subtotal));
    }

    for (const [sellerId, amount] of sellerAmountMap) {
      // 멱등성: 이미 존재하면 스킵
      const existing = await this.settlementRepository.findOne({
        where: { orderId: event.orderId, sellerId },
      });

      if (existing) {
        this.logger.warn(
          `정산 레코드 중복 — orderId: ${event.orderId}, sellerId: ${sellerId}, 스킵`,
        );
        continue;
      }

      const commissionAmount =
        Math.round(amount * DEFAULT_COMMISSION_RATE) / 100;
      const settlementAmount = amount - commissionAmount;

      const settlement = this.settlementRepository.create({
        orderId: event.orderId,
        sellerId,
        orderNumber: event.orderNumber,
        amount,
        commissionRate: DEFAULT_COMMISSION_RATE,
        commissionAmount,
        settlementAmount,
        status: SettlementStatus.PENDING,
      });

      await this.settlementRepository.save(settlement);

      this.logger.log(
        `정산 레코드 생성 — orderNumber: ${event.orderNumber}, sellerId: ${sellerId}, ` +
        `amount: ${amount}, settlement: ${settlementAmount}`,
      );
    }
  }
}
