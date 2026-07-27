import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProductEntity } from '../../product/entity/product.entity';
import { OrderEntity, OrderStatus } from '../entity/order.entity';
import { OrderItemEntity } from '../entity/order-item.entity';
import { ShipmentEntity, ShipmentStatus } from '../entity/shipment.entity';
import {
  OrderCreatedEvent,
  OrderPaidEvent,
  OrderCancelledEvent,
} from '../events/order.events';
import { RedisService } from '../../intrastructure/redis/redis.service';
import { withRetry } from '../../common/utils/with-retry';

@Injectable()
export class OrderEventListener {
  private readonly logger = new Logger(OrderEventListener.name);

  constructor(
    @InjectRepository(OrderItemEntity)
    private readonly orderItemRepository: Repository<OrderItemEntity>,
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  @OnEvent('order.created')
  handleOrderCreated(event: OrderCreatedEvent) {
    this.logger.log(
      `주문 생성 — orderId: ${event.orderId}, orderNumber: ${event.orderNumber}, ` +
      `userId: ${event.userId}, totalAmount: ${event.totalAmount}`,
    );
  }

  @OnEvent('order.paid')
  async handleOrderPaid(event: OrderPaidEvent) {
    this.logger.log(
      `결제 완료 — orderId: ${event.orderId}, orderNumber: ${event.orderNumber}, transactionId: ${event.transactionId}`,
    );

    await withRetry(
      () => this.processOrderPaid(event),
      `order.paid(orderId=${event.orderId})`,
    );
  }

  private async processOrderPaid(event: OrderPaidEvent) {
    // 단일 트랜잭션으로 salesCount 증가 + Order 상태 변경 + Shipment 생성 처리
    // → 부분 실패 시 전체 롤백되므로 재시도해도 salesCount 중복 증가 없음
    await this.dataSource.transaction(async (manager) => {
      // 멱등성 가드: FOR UPDATE로 잠금 + 상태 재검증
      const order = await manager
        .createQueryBuilder(OrderEntity, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :id', { id: event.orderId })
        .getOne();

      if (!order || order.status !== OrderStatus.PAID) {
        this.logger.warn(
          `order.paid 이벤트 중복 감지 또는 상태 불일치 — orderId: ${event.orderId}, currentStatus: ${order?.status}`,
        );
        return;
      }

      const items = await this.orderItemRepository.find({
        where: { orderId: event.orderId },
      });

      // salesCount 증가 (트랜잭션 내부 — 실패 시 롤백됨)
      for (const item of items) {
        await manager.increment(ProductEntity, { id: item.productId }, 'salesCount', item.quantity);
      }

      // Order → PREPARING
      await manager.update(OrderEntity, event.orderId, {
        status: OrderStatus.PREPARING,
      });

      // Shipment 생성 (멱등: 이미 존재하면 스킵)
      // §7-5: sellerId=null(셀러 없는 시드 상품)은 배송 주체가 없어 Shipment 를 만들지 않는다
      //       — null 을 넣으면 shipments.seller_id NOT NULL+FK 위반으로 리스너가 재시도 루프에 빠진다.
      const sellerIds = [
        ...new Set(
          items.map((item) => item.sellerId).filter((id): id is number => id != null),
        ),
      ];
      for (const sellerId of sellerIds) {
        const existing = await manager.findOne(ShipmentEntity, {
          where: { orderId: event.orderId, sellerId },
        });
        if (!existing) {
          const shipment = manager.create(ShipmentEntity, {
            orderId: event.orderId,
            sellerId,
            status: ShipmentStatus.PREPARING,
          });
          await manager.save(shipment);
        }
      }

      this.logger.log(
        `Shipment 생성 완료 — orderNumber: ${event.orderNumber}, sellerIds: [${sellerIds.join(', ')}]`,
      );
    });

    // 캐시 무효화 (트랜잭션 성공 후)
    const items = await this.orderItemRepository.find({
      where: { orderId: event.orderId },
    });
    for (const item of items) {
      await this.redisService.delCache(`products:detail:${item.productId}`);
    }
    await this.redisService.delCacheByPattern('products:list:*');
  }

  @OnEvent('order.cancelled')
  async handleOrderCancelled(event: OrderCancelledEvent) {
    this.logger.log(
      `주문 취소 — orderId: ${event.orderId}, orderNumber: ${event.orderNumber}, ` +
      `reason: ${event.reason}, refundRequired: ${event.refundRequired}`,
    );

    // 상품 캐시 무효화 (재고 변경됨)
    await this.redisService.delCacheByPattern('products:list:*');
  }
}
