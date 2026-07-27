import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { customAlphabet } from 'nanoid';
import { OrderEntity, OrderStatus } from './entity/order.entity';
import { OrderItemEntity } from './entity/order-item.entity';
import { ShipmentEntity, ShipmentStatus } from './entity/shipment.entity';
import { CartItemEntity } from '../cart/entity/cart-item.entity';
import { CartEntity } from '../cart/entity/cart.entity';
import { ProductEntity, ProductStatus, ApprovalStatus } from '../product/entity/product.entity';
import { PaymentEntity, PaymentStatus } from '../payment/entity/payment.entity';
import { SellerEntity, SellerStatus } from '../seller/entity/seller.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { ShipOrderDto } from './dto/ship-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import {
  OrderCreatedEvent,
  OrderCancelledEvent,
} from './events/order.events';
import {
  ShipmentShippedEvent,
  OrderShippedEvent,
  OrderDeliveredEvent,
  OrderCompletedEvent,
} from './events/shipment.events';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entity/audit-log.entity';

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8);

function generateOrderNumber(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `ORD-${date}-${nanoid()}`;
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(ShipmentEntity)
    private readonly shipmentRepository: Repository<ShipmentEntity>,
    @InjectRepository(CartEntity)
    private readonly cartRepository: Repository<CartEntity>,
    @InjectRepository(SellerEntity)
    private readonly sellerRepository: Repository<SellerEntity>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 주문 생성 — 핵심 트랜잭션
   * 1. CartItem 조회 + 본인 카트 검증
   * 2. 각 상품 FOR UPDATE 락으로 조회
   * 3. 상태/재고 검증
   * 4. Order + OrderItems + Payment(READY) 생성
   * 5. 재고 차감 (선점)
   * 6. 트랜잭션 커밋 후 CartItem 삭제 + 이벤트
   * 
   TODO(주문 입력 리팩터링): 바로 구매가 장바구니를 거치지 않도록 입력을 분리한다.
    - CreateOrderDto: cartItemIds → items[{ productId, quantity }] 로 변경,
      장바구니 주문은 fromCartItemIds?(주문 성공 시 삭제용)를 추가로 받음
    - 바로 구매 경로는 cart_items INSERT/DELETE 없이 items만으로 주문 생성
    - 트랜잭션/비관적 락/재고 차감 로직(L87~L194)은 그대로 재사용, 검증 기준만   
      items로 변경
    - 프론트 '바로 구매'·'장바구니 주문' 호출부도 함께 수정
   */
  async createOrder(userId: number, dto: CreateOrderDto) {
    // 0. 빈 주문 방어
    if (!dto.cartItemIds || dto.cartItemIds.length === 0) {
      throw new BadRequestException('주문할 장바구니 아이템을 선택해주세요.');
    }

    // 1. 본인 카트 확인
    const cart = await this.cartRepository.findOne({ where: { userId } });
    if (!cart) {
      throw new BadRequestException('장바구니가 비어있습니다.');
    }

    const orderNumber = generateOrderNumber();

    // 2~5. 트랜잭션 (CartItem 조회도 내부에서 → 동시 주문 방지)
    const { order } = await this.dataSource.transaction(async (manager) => {
      // 2-a. CartItem을 트랜잭션 내에서 FOR UPDATE 락으로 조회
      //      → 동일 CartItem으로 동시 주문 생성 시 두 번째 요청이 대기하게 됨
      //      JOIN 없이 cart_items 테이블만 잠금 (product 정보는 아래 products 쿼리에서 별도 조회)
      const cartItems = await manager
        .createQueryBuilder(CartItemEntity, 'ci')
        .setLock('pessimistic_write')
        .where('ci.id IN (:...ids)', { ids: dto.cartItemIds })
        .andWhere('ci.cartId = :cartId', { cartId: cart.id })
        .getMany();

      if (cartItems.length !== dto.cartItemIds.length) {
        throw new BadRequestException('유효하지 않은 장바구니 아이템이 포함되어 있습니다.');
      }

      // 2-b. 각 상품도 FOR UPDATE 락 (재고 정합성)
      //      setLock 세 번째 인자로 잠글 테이블(alias)을 지정 → FOR UPDATE OF "p" 생성
      //      LEFT JOIN 대상인 images 테이블은 잠그지 않으므로 PostgreSQL 제약 회피
      const productIds = cartItems.map((ci) => ci.productId);
      const products = await manager
        .createQueryBuilder(ProductEntity, 'p')
        .setLock('pessimistic_write', undefined, ['p'])
        .whereInIds(productIds)
        .leftJoinAndSelect('p.images', 'images')
        .getMany();

      const productMap = new Map(products.map((p) => [p.id, p]));

      // 3. 검증 + OrderItem 준비
      let totalAmount = 0;
      const orderItemsData: Partial<OrderItemEntity>[] = [];

      for (const cartItem of cartItems) {
        const product = productMap.get(cartItem.productId);
        if (!product) {
          throw new NotFoundException(`상품 ID ${cartItem.productId}를 찾을 수 없습니다.`);
        }
        if (product.approvalStatus !== ApprovalStatus.APPROVED) {
          throw new BadRequestException(`상품 "${product.name}"은 현재 구매할 수 없습니다.`);
        }
        if (product.status !== ProductStatus.PUBLISHED) {
          throw new BadRequestException(`상품 "${product.name}"은 현재 판매 중이 아닙니다.`);
        }
        if (product.stockQuantity < cartItem.quantity) {
          throw new BadRequestException(
            `상품 "${product.name}"의 재고가 부족합니다. (재고: ${product.stockQuantity}개, 요청: ${cartItem.quantity}개)`,
          );
        }

        const primaryImage = product.images?.find((img) => img.isPrimary);
        const subtotal = Number(product.price) * cartItem.quantity;
        totalAmount += subtotal;

        orderItemsData.push({
          productId: product.id,
          // §7-5: 셀러 없는 상품은 0(가짜 id)이 아니라 null — shipments FK·정산 집계 고아 방지
          sellerId: product.sellerId ?? null,
          productName: product.name,
          productPrice: Number(product.price),
          productImageUrl: primaryImage?.url ?? null,
          quantity: cartItem.quantity,
          subtotal,
        });
      }

      // 4. Order 생성
      const orderEntity = manager.create(OrderEntity, {
        orderNumber,
        userId,
        status: OrderStatus.PENDING_PAYMENT,
        totalAmount,
        shippingAddress: dto.shippingAddress,
        recipientName: dto.recipientName,
        recipientPhone: dto.recipientPhone,
        memo: dto.memo ?? null,
      });
      const savedOrder = await manager.save(orderEntity);

      // OrderItems 생성
      const items = orderItemsData.map((data) =>
        manager.create(OrderItemEntity, { ...data, orderId: savedOrder.id }),
      );
      await manager.save(items);

      // Payment(READY) 생성
      const paymentEntity = manager.create(PaymentEntity, {
        orderId: savedOrder.id,
        paymentId: orderNumber,
        amount: totalAmount,
        status: PaymentStatus.READY,
      });
      await manager.save(paymentEntity);

      // 5. 재고 차감 (파라미터화된 쿼리로 안전하게 처리)
      for (const cartItem of cartItems) {
        await manager
          .createQueryBuilder()
          .update(ProductEntity)
          .set({ stockQuantity: () => `"stockQuantity" - :qty` })
          .setParameter('qty', cartItem.quantity)
          .where('id = :id', { id: cartItem.productId })
          .execute();
      }

      // 6. CartItem 삭제도 트랜잭션 내에서 처리 (원자성 보장)
      await manager.delete(CartItemEntity, { id: In(dto.cartItemIds) });

      return { order: savedOrder, cartItemIds: dto.cartItemIds };
    });

    this.eventEmitter.emit(
      'order.created',
      new OrderCreatedEvent(order.id, userId, orderNumber, Number(order.totalAmount)),
    );

    // 응답용으로 relations 포함하여 재조회
    return this.findOrderByNumber(orderNumber);
  }

  /** 내 주문 목록 */
  async getMyOrders(userId: number, query: OrderQueryDto) {
    const { page = 1, take = 20, status } = query;

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('order.payment', 'payment')
      .where('order.userId = :userId', { userId })
      .orderBy('order.createdAt', 'DESC')
      .take(take)
      .skip((page - 1) * take);

    if (status) {
      qb.andWhere('order.status = :status', { status });
    }

    const [data, total] = await qb.getManyAndCount();
    const lastPage = Math.ceil(total / take);

    return {
      data,
      meta: { total, page, lastPage, take, hasNextPage: page < lastPage, hasPreviousPage: page > 1 },
    };
  }

  /** 주문 상세 (본인만) */
  async getOrderDetail(userId: number, orderNumber: string) {
    const order = await this.findOrderByNumber(orderNumber);
    if (order.userId !== userId) {
      throw new ForbiddenException('본인의 주문만 조회할 수 있습니다.');
    }
    return order;
  }

  /** 주문 취소 (PENDING_PAYMENT 상태만, 결제 전) */
  async cancelOrder(userId: number, orderNumber: string, reason?: string) {
    const order = await this.findOrderByNumber(orderNumber);
    if (order.userId !== userId) {
      throw new ForbiddenException('본인의 주문만 취소할 수 있습니다.');
    }
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException('결제 대기 상태의 주문만 취소할 수 있습니다.');
    }

    await this.dataSource.transaction(async (manager) => {
      // Order → CANCELLED
      await manager.update(OrderEntity, order.id, {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: reason ?? '구매자 취소',
      });

      // Payment → FAILED
      if (order.payment) {
        await manager.update(PaymentEntity, order.payment.id, {
          status: PaymentStatus.FAILED,
        });
      }

      // 재고 복원
      for (const item of order.items) {
        await manager
          .createQueryBuilder()
          .update(ProductEntity)
          .set({ stockQuantity: () => `"stockQuantity" + :restoreQty` })
          .setParameter('restoreQty', item.quantity)
          .where('id = :id', { id: item.productId })
          .execute();
      }
    });

    this.eventEmitter.emit(
      'order.cancelled',
      new OrderCancelledEvent(order.id, userId, orderNumber, reason ?? '구매자 취소', false),
    );

    return this.findOrderByNumber(orderNumber);
  }

  // ──────────── 셀러 메서드 ────────────

  /** 셀러: 내 상품이 포함된 주문 조회 */
  async getSellerOrders(userId: number, query: OrderQueryDto) {
    const seller = await this.sellerRepository.findOne({
      where: { userId, status: SellerStatus.APPROVED },
    });
    if (!seller) {
      throw new ForbiddenException('승인된 셀러만 조회할 수 있습니다.');
    }

    const { page = 1, take = 20, status } = query;

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .innerJoinAndSelect('order.items', 'items', 'items.sellerId = :sellerId', { sellerId: seller.id })
      // 본인 배송건만 함께 싣는다 — 프론트가 "배송 처리 가능(PREPARING)" 여부를 행에서 판단할 수 있게.
      // (shipment 는 결제 완료 시점에 생성되므로 결제 전 주문은 빈 배열이 맞다)
      .leftJoinAndSelect('order.shipments', 'shipments', 'shipments.sellerId = :sellerId', { sellerId: seller.id })
      .leftJoinAndSelect('order.payment', 'payment')
      .orderBy('order.createdAt', 'DESC')
      .take(take)
      .skip((page - 1) * take);

    if (status) {
      qb.andWhere('order.status = :status', { status });
    }

    const [data, total] = await qb.getManyAndCount();
    const lastPage = Math.ceil(total / take);

    return {
      data,
      meta: { total, page, lastPage, take, hasNextPage: page < lastPage, hasPreviousPage: page > 1 },
    };
  }

  /** 셀러: 운송장 입력 (PREPARING → SHIPPED) */
  async markShipped(userId: number, orderNumber: string, dto: ShipOrderDto) {
    const seller = await this.sellerRepository.findOne({
      where: { userId, status: SellerStatus.APPROVED },
    });
    if (!seller) {
      throw new ForbiddenException('승인된 셀러만 접근할 수 있습니다.');
    }

    const order = await this.findOrderByNumber(orderNumber);

    // 해당 셀러의 Shipment 조회
    const shipment = order.shipments?.find((s) => s.sellerId === seller.id);
    if (!shipment) {
      throw new ForbiddenException('본인의 상품이 포함된 주문만 처리할 수 있습니다.');
    }
    if (shipment.status !== ShipmentStatus.PREPARING) {
      throw new BadRequestException('준비 중 상태의 배송건만 출하 처리할 수 있습니다.');
    }

    // 트랜잭션: Shipment → SHIPPED + Order 상태 동기화 (원자적)
    await this.dataSource.transaction(async (manager) => {
      await manager.update(ShipmentEntity, shipment.id, {
        status: ShipmentStatus.SHIPPED,
        trackingNumber: dto.trackingNumber,
        carrier: dto.carrier,
        shippedAt: new Date(),
      });

      // 모든 Shipment이 SHIPPED 이상인지 확인
      const allShipments = await manager.find(ShipmentEntity, {
        where: { orderId: order.id },
      });
      const allShippedOrBeyond = allShipments.every(
        (s) =>
          s.id === shipment.id || // 방금 업데이트한 건은 이미 SHIPPED
          s.status === ShipmentStatus.SHIPPED ||
          s.status === ShipmentStatus.DELIVERED,
      );

      if (allShippedOrBeyond) {
        await manager.update(OrderEntity, order.id, {
          status: OrderStatus.SHIPPED,
          shippedAt: new Date(),
        });
      }
    });

    this.eventEmitter.emit(
      'shipment.shipped',
      new ShipmentShippedEvent(order.id, seller.id, orderNumber, dto.trackingNumber, dto.carrier),
    );

    // 동기화 결과에 따라 Order 이벤트도 발행
    const updated = await this.findOrderByNumber(orderNumber);
    if (updated.status === OrderStatus.SHIPPED) {
      this.eventEmitter.emit(
        'order.shipped',
        new OrderShippedEvent(order.id, order.orderNumber),
      );
    }

    return updated;
  }

  // ──────────── 관리자 메서드 ────────────

  /** 관리자: 배송 완료 처리 (SHIPPED → DELIVERED) */
  async markDelivered(orderNumber: string, sellerId?: number) {
    const order = await this.findOrderByNumber(orderNumber);

    // Order 상태 검증: SHIPPED 또는 PREPARING(일부 셀러만 출하한 경우) 이어야 함
    if (
      order.status !== OrderStatus.SHIPPED &&
      order.status !== OrderStatus.PREPARING
    ) {
      throw new BadRequestException(
        `배송 완료 처리할 수 없는 주문 상태입니다. (현재: ${order.status})`,
      );
    }

    const targetShipments = sellerId
      ? order.shipments?.filter((s) => s.sellerId === sellerId)
      : order.shipments;

    if (!targetShipments || targetShipments.length === 0) {
      throw new NotFoundException('해당 배송건을 찾을 수 없습니다.');
    }

    // SHIPPED 상태인 것만 필터
    const shippedShipments = targetShipments.filter(
      (s) => s.status === ShipmentStatus.SHIPPED,
    );
    if (shippedShipments.length === 0) {
      throw new BadRequestException(
        '출하 완료(SHIPPED) 상태의 배송건이 없습니다. 먼저 셀러가 운송장을 입력해야 합니다.',
      );
    }

    // 트랜잭션: Shipment → DELIVERED + Order 상태 동기화 (원자적)
    await this.dataSource.transaction(async (manager) => {
      for (const shipment of shippedShipments) {
        await manager.update(ShipmentEntity, shipment.id, {
          status: ShipmentStatus.DELIVERED,
          deliveredAt: new Date(),
        });
      }

      // 모든 Shipment이 DELIVERED인지 확인
      const allShipments = await manager.find(ShipmentEntity, {
        where: { orderId: order.id },
      });
      const allDelivered = allShipments.every(
        (s) =>
          shippedShipments.some((ss) => ss.id === s.id) || // 방금 업데이트한 건
          s.status === ShipmentStatus.DELIVERED,
      );

      if (allDelivered) {
        await manager.update(OrderEntity, order.id, {
          status: OrderStatus.DELIVERED,
          deliveredAt: new Date(),
        });
      }
    });

    const updated = await this.findOrderByNumber(orderNumber);
    if (updated.status === OrderStatus.DELIVERED) {
      this.eventEmitter.emit(
        'order.delivered',
        new OrderDeliveredEvent(order.id, order.orderNumber),
      );
    }

    return updated;
  }

  /** 관리자: 전체 주문 조회 */
  async getAllOrders(query: OrderQueryDto) {
    const { page = 1, take = 20, status } = query;

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('order.payment', 'payment')
      .orderBy('order.createdAt', 'DESC')
      .take(take)
      .skip((page - 1) * take);

    if (status) {
      qb.andWhere('order.status = :status', { status });
    }

    const [data, total] = await qb.getManyAndCount();
    const lastPage = Math.ceil(total / take);

    return {
      data,
      meta: { total, page, lastPage, take, hasNextPage: page < lastPage, hasPreviousPage: page > 1 },
    };
  }

  /** 관리자: 주문 상세 */
  async getOrderDetailAdmin(orderNumber: string) {
    return this.findOrderByNumber(orderNumber);
  }

  // ──────────── 구매자: 구매 확정 ────────────

  /** 구매자: 구매 확정 (DELIVERED → COMPLETED) */
  async confirmOrder(userId: number, orderNumber: string) {
    const order = await this.findOrderByNumber(orderNumber);
    if (order.userId !== userId) {
      throw new ForbiddenException('본인의 주문만 확정할 수 있습니다.');
    }

    // 트랜잭션 + 낙관적 상태 검증으로 중복 확정 방지
    const result = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(OrderEntity, {
        where: { id: order.id },
      });
      if (!locked || locked.status !== OrderStatus.DELIVERED) {
        throw new BadRequestException('배송 완료 상태의 주문만 구매 확정할 수 있습니다.');
      }

      await manager.update(OrderEntity, order.id, {
        status: OrderStatus.COMPLETED,
        completedAt: new Date(),
      });

      return locked;
    });

    this.eventEmitter.emit(
      'order.completed',
      new OrderCompletedEvent(result.id, userId, orderNumber),
    );

    return this.findOrderByNumber(orderNumber);
  }

  // ──────────── Cron: 주문 타임아웃 ────────────

  @Cron(CronExpression.EVERY_10_MINUTES)
  async expirePendingOrders() {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const pendingOrders = await this.orderRepository.find({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        createdAt: LessThan(thirtyMinutesAgo),
      },
      relations: ['items', 'payment'],
    });

    if (pendingOrders.length === 0) return;

    this.logger.log(`만료 대상 주문 ${pendingOrders.length}건 처리 시작`);

    const processedOrderNumbers: string[] = [];

    for (const order of pendingOrders) {
      try {
        await this.dataSource.transaction(async (manager) => {
          await manager.update(OrderEntity, order.id, {
            status: OrderStatus.CANCELLED,
            cancelledAt: new Date(),
            cancellationReason: '결제 시간 초과 (30분)',
          });

          if (order.payment) {
            await manager.update(PaymentEntity, order.payment.id, {
              status: PaymentStatus.FAILED,
            });
          }

          for (const item of order.items) {
            await manager
              .createQueryBuilder()
              .update(ProductEntity)
              .set({ stockQuantity: () => `"stockQuantity" + :restoreQty` })
              .setParameter('restoreQty', item.quantity)
              .where('id = :id', { id: item.productId })
              .execute();
          }
        });

        processedOrderNumbers.push(order.orderNumber);
        this.logger.log(`주문 ${order.orderNumber} 만료 처리 완료`);

        this.eventEmitter.emit(
          'order.cancelled',
          new OrderCancelledEvent(
            order.id, order.userId, order.orderNumber,
            '결제 시간 초과', false,
          ),
        );
      } catch (error) {
        this.logger.error(`주문 ${order.orderNumber} 만료 처리 실패: ${error instanceof Error ? error.message : error}`);
      }
    }

    if (processedOrderNumbers.length > 0) {
      this.auditService.log({
        action: AuditAction.CRON_ORDER_EXPIRED,
        ipAddress: 'system',
        metadata: { count: processedOrderNumbers.length, orderNumbers: processedOrderNumbers },
      });
    }
  }

  // ──────────── Cron: 배송 자동 완료 ────────────

  @Cron(CronExpression.EVERY_HOUR)
  async autoDeliverShipments() {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    const shippedShipments = await this.shipmentRepository.find({
      where: {
        status: ShipmentStatus.SHIPPED,
        shippedAt: LessThan(threeDaysAgo),
      },
      relations: ['order'],
    });

    if (shippedShipments.length === 0) return;

    this.logger.log(`자동 배송완료 대상 Shipment ${shippedShipments.length}건 처리 시작`);

    const processedShipmentIds: number[] = [];

    for (const shipment of shippedShipments) {
      try {
        await this.dataSource.transaction(async (manager) => {
          await manager.update(ShipmentEntity, shipment.id, {
            status: ShipmentStatus.DELIVERED,
            deliveredAt: new Date(),
          });

          // 같은 주문의 모든 Shipment이 DELIVERED인지 확인
          const allShipments = await manager.find(ShipmentEntity, {
            where: { orderId: shipment.orderId },
          });
          const allDelivered = allShipments.every(
            (s) => s.id === shipment.id || s.status === ShipmentStatus.DELIVERED,
          );

          if (allDelivered) {
            await manager.update(OrderEntity, shipment.orderId, {
              status: OrderStatus.DELIVERED,
              deliveredAt: new Date(),
            });

            this.eventEmitter.emit(
              'order.delivered',
              new OrderDeliveredEvent(shipment.orderId, shipment.order.orderNumber),
            );
          }
        });

        processedShipmentIds.push(shipment.id);
        this.logger.log(`Shipment ${shipment.id} 자동 배송완료 처리`);
      } catch (error) {
        this.logger.error(`Shipment ${shipment.id} 자동 배송완료 실패: ${error instanceof Error ? error.message : error}`);
      }
    }

    if (processedShipmentIds.length > 0) {
      this.auditService.log({
        action: AuditAction.CRON_SHIPMENT_AUTO_DELIVERED,
        ipAddress: 'system',
        metadata: { count: processedShipmentIds.length, shipmentIds: processedShipmentIds },
      });
    }
  }

  // ──────────── Cron: 자동 구매 확정 ────────────

  @Cron(CronExpression.EVERY_HOUR)
  async autoCompleteOrders() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const deliveredOrders = await this.orderRepository.find({
      where: {
        status: OrderStatus.DELIVERED,
        deliveredAt: LessThan(sevenDaysAgo),
      },
    });

    if (deliveredOrders.length === 0) return;

    this.logger.log(`자동 구매확정 대상 주문 ${deliveredOrders.length}건 처리 시작`);

    const processedOrderNumbers: string[] = [];

    for (const order of deliveredOrders) {
      try {
        await this.orderRepository.update(order.id, {
          status: OrderStatus.COMPLETED,
          completedAt: new Date(),
        });

        this.eventEmitter.emit(
          'order.completed',
          new OrderCompletedEvent(order.id, order.userId, order.orderNumber),
        );

        processedOrderNumbers.push(order.orderNumber);
        this.logger.log(`주문 ${order.orderNumber} 자동 구매확정 처리`);
      } catch (error) {
        this.logger.error(`주문 ${order.orderNumber} 자동 구매확정 실패: ${error instanceof Error ? error.message : error}`);
      }
    }

    if (processedOrderNumbers.length > 0) {
      this.auditService.log({
        action: AuditAction.CRON_ORDER_AUTO_COMPLETED,
        ipAddress: 'system',
        metadata: { count: processedOrderNumbers.length, orderNumbers: processedOrderNumbers },
      });
    }
  }

  // ──────────── 내부 헬퍼 ────────────

  private async findOrderByNumber(orderNumber: string): Promise<OrderEntity> {
    const order = await this.orderRepository.findOne({
      where: { orderNumber },
      relations: ['items', 'payment', 'shipments'],
    });
    if (!order) {
      throw new NotFoundException(`주문번호 ${orderNumber}를 찾을 수 없습니다.`);
    }
    return order;
  }

}
