import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { isUUID } from 'class-validator';
import { DataSource, EntityManager, In, LessThan } from 'typeorm';
import { UserModel } from '../user/entity/user.entity';
import {
  ApprovalStatus,
  ProductEntity,
  ProductStatus,
} from '../product/entity/product.entity';
import { SellerStatus } from '../seller/entity/seller.entity';
import { mockProductCatalog } from '../common/seeds/mock-product-catalog';
import {
  DemoCheckoutOrderEntity,
  DemoCheckoutVisitEntity,
} from './entity/demo-checkout.entity';
import { DemoPortOnePayment, DemoPortOneService } from './demo-portone.service';

export interface DemoCheckoutActor {
  sub: number;
  demoSessionId?: string;
}
export const DEMO_PAYMENT_PREFIX = 'DEMO-PG-';
export const DEMO_SHIPPING = {
  recipientName: '체험 구매자',
  recipientPhone: '010-0000-0000',
  shippingAddress: '체험용 배송지 (실제 배송 없음)',
};
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PAYMENT_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class DemoCheckoutService {
  constructor(
    private readonly ds: DataSource,
    private readonly portone: DemoPortOneService
  ) {}

  async options(actor: DemoCheckoutActor) {
    await this.assertBuyer(actor);
    return {
      ...this.portone.options(),
      shipping: DEMO_SHIPPING,
      maxQuantity: 5,
      maxItems: 10,
    };
  }
  private async assertBuyer(actor: DemoCheckoutActor) {
    const user = await this.ds.manager.findOne(UserModel, {
      where: { id: actor.sub },
      relations: ['roles'],
    });
    if (
      !user?.isDemo ||
      user.email !== process.env.DEMO_BUYER_EMAIL ||
      !user.roles.some((role) => role.name === 'buyer') ||
      user.roles.some((role) => role.name !== 'buyer')
    )
      throw new ForbiddenException(
        '테스트 결제는 구매자 체험 계정에서 이용할 수 있습니다.'
      );
    if (!actor.demoSessionId || !isUUID(actor.demoSessionId, '4'))
      throw new ForbiddenException(
        '새 장바구니 체험을 위해 구매자 체험으로 다시 로그인해주세요.'
      );
    return actor.demoSessionId;
  }
  private async visit(
    manager: EntityManager,
    actor: DemoCheckoutActor,
    id: string
  ) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(DemoCheckoutVisitEntity)
      .values({
        id,
        userId: actor.sub,
        items: [],
        version: 0,
        expiresAt: new Date(Date.now() + RETENTION_MS),
      })
      .orIgnore()
      .execute();
    const visit = await manager.findOneOrFail(DemoCheckoutVisitEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (visit.userId !== actor.sub) throw new ForbiddenException();
    visit.expiresAt = new Date(Date.now() + RETENTION_MS);
    return visit;
  }
  private async products(
    manager: EntityManager,
    ids: number[],
    strict = false
  ) {
    if (!ids.length) return [];
    const products = await manager.find(ProductEntity, {
      where: { id: In(ids) },
      relations: ['images', 'seller', 'seller.user'],
    });
    if (
      strict &&
      (products.length !== ids.length ||
        products.some(
          (product) =>
            product.status !== ProductStatus.PUBLISHED ||
            product.approvalStatus !== ApprovalStatus.APPROVED ||
            !product.seedKey ||
            !mockProductCatalog.some(
              (sample) => sample.seedKey === product.seedKey
            ) ||
            product.seller?.status !== SellerStatus.APPROVED ||
            product.seller.user?.isDemo !== false ||
            product.seller.user.email !== (process.env.TEST_SELLER_EMAIL || 'seller1@seed.com')
        ))
    )
      throw new BadRequestException(
        '승인된 체험 셀러의 샘플 상품만 주문할 수 있습니다.'
      );
    return products;
  }
  private async cartResponse(
    visit: DemoCheckoutVisitEntity,
    manager = this.ds.manager
  ) {
    const products = await this.products(
      manager,
      visit.items.map((item) => item.productId)
    );
    return {
      id: 0,
      userId: visit.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: visit.items.flatMap((item) => {
        const product = products.find(
          (product) => product.id === item.productId
        );
        return product
          ? [
              {
                ...item,
                id: item.productId,
                createdAt: new Date(),
                updatedAt: new Date(),
                product,
              },
            ]
          : [];
      }),
    };
  }
  async cart(actor: DemoCheckoutActor) {
    const id = await this.assertBuyer(actor);
    const visit = await this.ds.transaction(async (manager) => {
      const visit = await this.visit(manager, actor, id);
      return manager.save(visit);
    });
    return this.cartResponse(visit);
  }
  async changeCart(
    actor: DemoCheckoutActor,
    action: 'add' | 'update' | 'remove' | 'clear',
    productId?: number,
    quantity?: number
  ) {
    const id = await this.assertBuyer(actor);
    const visit = await this.ds.transaction(async (manager) => {
      const visit = await this.visit(manager, actor, id);
      if (action === 'clear') visit.items = [];
      else if (action === 'remove')
        visit.items = visit.items.filter(
          (item) => item.productId !== productId
        );
      else {
        if (
          typeof productId !== 'number' ||
          !Number.isSafeInteger(productId) ||
          Number(productId) <= 0 ||
          typeof quantity !== 'number' ||
          !Number.isSafeInteger(quantity) ||
          Number(quantity) < 1
        )
          throw new BadRequestException('올바른 상품과 수량을 선택해주세요.');
        await this.products(manager, [productId], true);
        const existing = visit.items.find(
          (item) => item.productId === productId
        );
        const nextQuantity =
          action === 'add' ? (existing?.quantity ?? 0) + quantity : quantity;
        if (nextQuantity > 5 || (!existing && visit.items.length >= 10))
          throw new BadRequestException(
            '체험 장바구니는 상품 10종, 상품별 5개까지 담을 수 있습니다.'
          );
        if (action === 'update' && !existing)
          throw new NotFoundException('장바구니 상품을 찾을 수 없습니다.');
        if (existing) existing.quantity = nextQuantity;
        else visit.items.push({ productId: productId, quantity: nextQuantity });
      }
      visit.version++;
      return manager.save(visit);
    });
    return this.cartResponse(visit);
  }
  async create(actor: DemoCheckoutActor, requestId: string) {
    const id = await this.assertBuyer(actor);
    const settings = this.portone.settings();
    if (!isUUID(requestId, '4'))
      throw new BadRequestException('올바른 주문 요청 ID가 필요합니다.');
    const order = await this.ds.transaction(async (manager) => {
      const visit = await this.visit(manager, actor, id);
      await manager.save(visit);
      await manager.update(
        DemoCheckoutOrderEntity,
        {
          visitId: id,
          status: 'pending_payment',
          expiresAt: LessThan(new Date()),
        },
        { status: 'cancelled', cancelledAt: new Date() }
      );
      const previous = await manager.findOne(DemoCheckoutOrderEntity, {
        where: { visitId: id, requestId },
      });
      if (previous) return previous;
      const total = await manager.count(DemoCheckoutOrderEntity, {
        where: { visitId: id },
      });
      const pending = await manager.count(DemoCheckoutOrderEntity, {
        where: { visitId: id, status: 'pending_payment' },
      });
      if (total >= 20 || pending >= 3)
        throw new HttpException(
          '체험 주문 한도에 도달했습니다. 결제 대기 주문을 취소하거나 새 구매자 체험으로 시작해주세요.',
          HttpStatus.TOO_MANY_REQUESTS
        );
      if (!visit.items.length)
        throw new BadRequestException('체험 장바구니가 비었습니다.');
      const products = await this.products(
        manager,
        visit.items.map((item) => item.productId),
        true
      );
      const items = visit.items.map((item) => {
        if (
          !Number.isSafeInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 5
        )
          throw new BadRequestException('체험 상품 수량이 올바르지 않습니다.');
        const product = products.find(
          (product) => product.id === item.productId
        );
        if (!product || product.sellerId === null)
          throw new BadRequestException('체험 상품을 찾을 수 없습니다.');
        const price = Number(product.price);
        if (!Number.isSafeInteger(price) || price < 1)
          throw new BadRequestException('체험 상품 가격이 올바르지 않습니다.');
        return {
          ...item,
          id: product.id,
          sellerId: product.sellerId,
          productName: product.name,
          productPrice: price,
          subtotal: price * item.quantity,
          productImageUrl:
            product.images.find((image) => image.isPrimary)?.url ??
            product.images[0]?.url ??
            null,
        };
      });
      const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
      const totalAmount = subtotal + (subtotal >= 50000 ? 0 : 3000);
      if (totalAmount > 1000000)
        throw new BadRequestException(
          '테스트 주문은 100만원 이하로 진행해주세요.'
        );
      return manager.save(
        manager.create(DemoCheckoutOrderEntity, {
          ...settings,
          visitId: id,
          userId: actor.sub,
          requestId,
          orderNumber: `${DEMO_PAYMENT_PREFIX}${randomUUID()}`,
          status: 'pending_payment',
          items,
          totalAmount,
          cartVersion: visit.version,
          expiresAt: new Date(Date.now() + PAYMENT_TTL_MS),
        })
      );
    });
    return this.response(order);
  }
  private async owned(actor: DemoCheckoutActor, orderNumber: string) {
    const visitId = await this.assertBuyer(actor);
    const order = await this.ds.manager.findOne(DemoCheckoutOrderEntity, {
      where: { orderNumber, visitId, userId: actor.sub },
    });
    if (!order)
      throw new NotFoundException(
        '이 로그인에서 생성한 체험 주문을 찾을 수 없습니다.'
      );
    return order;
  }
  async detail(actor: DemoCheckoutActor, orderNumber: string) {
    return this.response(await this.owned(actor, orderNumber));
  }
  async list(actor: DemoCheckoutActor) {
    const visitId = await this.assertBuyer(actor);
    const orders = await this.ds.manager.find(DemoCheckoutOrderEntity, {
      where: { visitId, userId: actor.sub },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    return orders.map((order) => this.response(order));
  }
  async verify(
    actor: DemoCheckoutActor,
    orderNumber: string,
    transactionId: string
  ) {
    const order = await this.owned(actor, orderNumber);
    if (order.status === 'paid') return this.response(order);
    const payment = await this.portone.payment(orderNumber, order.storeId);
    this.portone.assertTest(payment, order);
    if (payment.transactionId !== transactionId)
      throw new BadRequestException(
        '테스트 결제의 거래 ID가 일치하지 않습니다.'
      );
    return this.settle(order, payment);
  }
  async reconcile(actor: DemoCheckoutActor, orderNumber: string) {
    const order = await this.owned(actor, orderNumber);
    if (order.status === 'paid') return this.response(order);
    const payment = await this.portone.payment(orderNumber, order.storeId);
    return this.settle(order, payment);
  }
  private async settle(
    order: DemoCheckoutOrderEntity,
    payment: DemoPortOnePayment
  ) {
    this.portone.assertTest(payment, order);
    const paidAt = payment.paidAt;
    if (
      payment.status !== 'PAID' ||
      !payment.transactionId ||
      !paidAt ||
      !Number.isFinite(Date.parse(paidAt))
    )
      throw new BadRequestException(
        'PortOne에서 테스트 결제 완료를 확인하지 못했습니다.'
      );
    const updated = await this.ds.transaction(async (manager) => {
      const visit = await this.visit(
        manager,
        { sub: order.userId },
        order.visitId
      );
      const locked = await manager.findOneOrFail(DemoCheckoutOrderEntity, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (locked.status === 'paid') return locked;
      if (
        locked.status === 'cancelled' ||
        locked.expiresAt.getTime() <= Date.now()
      ) {
        locked.status = 'cancelled';
        locked.cancelledAt ||= new Date();
      } else {
        locked.status = 'paid';
        locked.transactionId = payment.transactionId;
        locked.paymentMethod = payment.method?.type ?? null;
        locked.pgProvider = payment.channel.pgProvider;
        locked.paidAt = new Date(paidAt);
        if (visit.version === locked.cartVersion) {
          visit.items = [];
          visit.version++;
        }
        await manager.save(visit);
      }
      return manager.save(locked);
    });
    if (updated.status === 'cancelled') {
      await this.portone.cancel(order.orderNumber, order.storeId);
      throw new BadRequestException(
        '만료되거나 취소된 테스트 주문의 결제를 취소했습니다.'
      );
    }
    return this.response(updated);
  }
  async cancel(actor: DemoCheckoutActor, orderNumber: string) {
    const order = await this.owned(actor, orderNumber);
    const updated = await this.ds.transaction(async (manager) => {
      await manager.save(await this.visit(manager, actor, order.visitId));
      const locked = await manager.findOneOrFail(DemoCheckoutOrderEntity, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (locked.status === 'paid')
        throw new BadRequestException(
          '완료된 테스트 결제는 결제 대기 주문 취소 대상이 아닙니다.'
        );
      locked.status = 'cancelled';
      locked.cancelledAt ||= new Date();
      return manager.save(locked);
    });
    return this.response(updated);
  }
  async webhook(type: string, orderNumber: string) {
    if (type !== 'Transaction.Paid') return { message: 'demo event ignored' };
    const order = await this.ds.manager.findOne(DemoCheckoutOrderEntity, {
      where: { orderNumber },
    });
    if (!order) return { message: 'demo payment not found' };
    if (order.status === 'paid') return { message: 'demo already paid' };
    const payment = await this.portone.payment(orderNumber, order.storeId);
    this.portone.assertTest(payment, order);
    if (order.status === 'cancelled' && payment.status === 'CANCELLED')
      return { message: 'demo already cancelled' };
    try {
      await this.settle(order, payment);
    } catch (error) {
      // An expired payment was successfully cancelled; acknowledge the webhook.
      if (
        !(error instanceof BadRequestException) ||
        error.message !== '만료되거나 취소된 테스트 주문의 결제를 취소했습니다.'
      )
        throw error;
    }
    return { message: 'demo payment verified' };
  }
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanup() {
    await this.ds.manager.update(
      DemoCheckoutOrderEntity,
      { status: 'pending_payment', expiresAt: LessThan(new Date()) },
      { status: 'cancelled', cancelledAt: new Date() }
    );
    // These tables contain only isolated test data; normal orders and inventory are untouched.
    const expired = await this.ds.manager.find(DemoCheckoutVisitEntity, {
      where: { expiresAt: LessThan(new Date()) },
      select: ['id'],
    });
    for (const visit of expired)
      await this.ds.transaction(async (manager) => {
        const locked = await manager.findOne(DemoCheckoutVisitEntity, {
          where: { id: visit.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!locked || locked.expiresAt.getTime() > Date.now()) return;
        await manager.delete(DemoCheckoutOrderEntity, { visitId: visit.id });
        await manager.delete(DemoCheckoutVisitEntity, { id: visit.id });
      });
  }
  private response(order: DemoCheckoutOrderEntity) {
    return {
      id: order.id,
      isDemoCheckout: true,
      orderNumber: order.orderNumber,
      userId: order.userId,
      status: order.status,
      totalAmount: order.totalAmount,
      ...DEMO_SHIPPING,
      memo: null,
      paidAt: order.paidAt,
      cancelledAt: order.cancelledAt,
      cancellationReason:
        order.status === 'cancelled' ? '테스트 주문 취소·만료' : null,
      shippedAt: null,
      deliveredAt: null,
      completedAt: null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: order.items,
      shipments: [],
      canTestDeliver: false,
      payment: {
        id: order.id,
        paymentId: order.orderNumber,
        transactionId: order.transactionId,
        paymentMethod: order.paymentMethod,
        amount: order.totalAmount,
        status:
          order.status === 'paid'
            ? 'paid'
            : order.status === 'cancelled'
            ? 'failed'
            : 'ready',
        pgProvider: order.pgProvider,
        receiptUrl: null,
        paidAt: order.paidAt,
      },
      testPayment: { storeId: order.storeId, channelKey: order.channelKey },
    };
  }
}
