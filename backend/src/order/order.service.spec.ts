import { mockDemoPolicy } from '../demo/demo-policy.mock';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

// Avoid decorator metadata cycles between order, items, and shipments in SWC tests.
jest.mock('./entity/order.entity', () => ({
  OrderEntity: class OrderEntity {},
  OrderStatus: { PENDING_PAYMENT: 'pending_payment', PAID: 'paid', PREPARING: 'preparing', SHIPPED: 'shipped', DELIVERED: 'delivered', COMPLETED: 'completed', CANCELLED: 'cancelled' },
}));

import { OrderService } from './order.service';
import { OrderEntity } from './entity/order.entity';
import { ShipmentEntity } from './entity/shipment.entity';
import { OrderItemEntity } from './entity/order-item.entity';
import { PaymentEntity } from '../payment/entity/payment.entity';

describe('OrderService shipping permissions and transitions', () => {
  let service: OrderService;
  let order: any;
  let items: any[];
  let shipments: any[];
  let payment: any;
  let manager: any;
  let events: any;
  let repository: any;
  let sellerRepository: any;
  const originalFlag = process.env.TEST_DELIVERY_ENABLED;

  beforeEach(() => {
    process.env.TEST_DELIVERY_ENABLED = 'true';
    order = { id: 1, orderNumber: 'TEST-1', userId: 10, status: 'shipped' };
    payment = { orderId: 1, status: 'paid' };
    items = [{ sellerId: 7 }, { sellerId: 8 }];
    shipments = [
      { id: 2, sellerId: 7, status: 'shipped' },
      { id: 3, sellerId: 8, status: 'shipped' },
    ];
    manager = {
      findOne: jest.fn(async (entity) => entity === PaymentEntity ? payment : { ...order }),
      find: jest.fn(async (entity) => entity === OrderItemEntity ? items : shipments.map((s) => ({ ...s }))),
      update: jest.fn(async (entity, id, update) => {
        if (entity === OrderEntity) Object.assign(order, update);
        else Object.assign(shipments.find((s) => s.id === id), update);
      }),
    };
    repository = { findOne: jest.fn(async () => ({ ...order, items, shipments, payment })) };
    sellerRepository = { findOne: jest.fn(async () => ({ id: 7, status: 'approved' })) };
    events = { emit: jest.fn() };
    service = new OrderService(repository, {} as any, {} as any, sellerRepository,
      { transaction: (fn: any) => fn(manager) } as any, events, {} as any, mockDemoPolicy() as any);
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.TEST_DELIVERY_ENABLED;
    else process.env.TEST_DELIVERY_ENABLED = originalFlag;
  });

  it('completes only the seller shipment; the remaining seller still owns their shipment', async () => {
    await service.markSellerDelivered(20, 'TEST-1');
    expect(shipments.map((s) => s.status)).toEqual(['delivered', 'shipped']);
    expect(order.status).toBe('shipped');
    expect(manager.findOne).toHaveBeenCalledWith(OrderEntity, expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('completes the whole order only after every shipment arrives and emits once on retries', async () => {
    await service.markSellerDelivered(20, 'TEST-1');
    await service.markTestDelivered(10, 'TEST-1');
    await service.markTestDelivered(10, 'TEST-1');
    expect(order.status).toBe('delivered');
    expect(order.deliveredAt).toBeInstanceOf(Date);
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('order.delivered', expect.anything());
  });

  it('allows partial delivery while another seller is still preparing', async () => {
    order.status = 'preparing'; shipments[1].status = 'preparing';
    await service.markSellerDelivered(20, 'TEST-1');
    expect(shipments.map((s) => s.status)).toEqual(['delivered', 'preparing']);
    expect(order.status).toBe('preparing');
    sellerRepository.findOne.mockResolvedValue({ id: 8 });
    await service.markShipped(21, 'TEST-1', { carrier: 'TEST', trackingNumber: '123' });
    expect(order.status).toBe('shipped');
    await service.markSellerDelivered(21, 'TEST-1');
    expect(order.status).toBe('delivered');
  });

  it('rejects other buyers, unrelated sellers, and unapproved sellers', async () => {
    await expect(service.markTestDelivered(11, 'TEST-1')).rejects.toBeInstanceOf(ForbiddenException);
    sellerRepository.findOne.mockResolvedValue({ id: 99 });
    await expect(service.markSellerDelivered(99, 'TEST-1')).rejects.toBeInstanceOf(ForbiddenException);
    sellerRepository.findOne.mockResolvedValue(null);
    await expect(service.markSellerDelivered(99, 'TEST-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('enforces the server flag independently of the UI', async () => {
    process.env.TEST_DELIVERY_ENABLED = 'false';
    await expect(service.markTestDelivered(10, 'TEST-1')).rejects.toBeInstanceOf(ForbiddenException);
    await service.markSellerDelivered(20, 'TEST-1');
    expect(shipments[0].status).toBe('delivered');
  });

  it.each(['TRUE', '1', '', undefined])('requires the exact enabled flag, received %s', async (flag) => {
    if (flag === undefined) delete process.env.TEST_DELIVERY_ENABLED;
    else process.env.TEST_DELIVERY_ENABLED = flag;
    expect((await service.getOrderDetail(10, 'TEST-1') as any).canTestDeliver).toBe(false);
    await expect(service.markTestDelivered(10, 'TEST-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('returns not found for a missing order without writing anything', async () => {
    manager.findOne.mockResolvedValue(null);
    await expect(service.markTestDelivered(10, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it.each(['pending_payment', 'paid', 'cancelled'])('rejects delivery for %s', async (status) => {
    order.status = status;
    await expect(service.markTestDelivered(10, 'TEST-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('shows the test button and completes a paid order directly from preparing', async () => {
    shipments.forEach((s) => s.status = 'preparing'); order.status = 'preparing';
    const detail = await service.getOrderDetail(10, 'TEST-1');
    expect((detail as any).canTestDeliver).toBe(true);
    await service.markTestDelivered(10, 'TEST-1');
    expect(shipments.map((s) => s.status)).toEqual(['delivered', 'delivered']);
    expect(order.status).toBe('delivered');
    expect((await service.getOrderDetail(10, 'TEST-1') as any).canTestDeliver).toBe(false);
    expect(events.emit).toHaveBeenCalledWith('order.delivered', expect.anything());
  });

  it('completes both preparing and shipped deliveries for a buyer test', async () => {
    shipments[1].status = 'preparing'; order.status = 'preparing';
    await service.markTestDelivered(10, 'TEST-1');
    expect(shipments.map((s) => s.status)).toEqual(['delivered', 'delivered']);
    expect(order.status).toBe('delivered');
  });

  it.each(['ready', 'cancelled', 'partial_cancelled'])('hides the test button and rejects a %s payment', async (status) => {
    payment.status = status;
    expect((await service.getOrderDetail(10, 'TEST-1') as any).canTestDeliver).toBe(false);
    await expect(service.markTestDelivered(10, 'TEST-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('keeps seller and admin completion restricted to shipped deliveries', async () => {
    shipments.forEach((s) => s.status = 'preparing'); order.status = 'preparing';
    await expect(service.markSellerDelivered(20, 'TEST-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.markDelivered('TEST-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('rejects missing shipment coverage for buyer tests', async () => {
    shipments[0].status = 'shipped'; shipments.pop();
    expect((await service.getOrderDetail(10, 'TEST-1') as any).canTestDeliver).toBe(false);
    await expect(service.markTestDelivered(10, 'TEST-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('does not regress a completed order on a retry', async () => {
    order.status = 'completed'; shipments.forEach((s) => s.status = 'delivered');
    await service.markSellerDelivered(20, 'TEST-1');
    expect(order.status).toBe('completed');
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('preserves delivery times and emits no new event on a buyer retry after confirmation', async () => {
    await service.markTestDelivered(10, 'TEST-1');
    const deliveredAt = order.deliveredAt;
    const shipmentTimes = shipments.map((s) => s.deliveredAt);
    order.status = 'completed'; events.emit.mockClear(); manager.update.mockClear();
    await service.markTestDelivered(10, 'TEST-1');
    expect(order.status).toBe('completed'); expect(order.deliveredAt).toBe(deliveredAt);
    expect(shipments.map((s) => s.deliveredAt)).toEqual(shipmentTimes);
    expect(manager.update).not.toHaveBeenCalled(); expect(events.emit).not.toHaveBeenCalled();
  });

  it.each(['null seller', 'extra shipment', 'empty items'])('rejects corrupted shipment ownership: %s', async (kind) => {
    if (kind === 'null seller') items[0].sellerId = null;
    if (kind === 'extra shipment') shipments.push({ id: 4, sellerId: 99, status: 'shipped' });
    if (kind === 'empty items') items.length = 0;
    expect((await service.getOrderDetail(10, 'TEST-1') as any).canTestDeliver).toBe(false);
    await expect(service.markTestDelivered(10, 'TEST-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it.each(['preparing', 'shipped', 'cancelled', 'completed'])('rejects confirmation for %s', async (status) => {
    order.status = status;
    await expect(service.confirmOrder(10, 'TEST-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('rejects confirmation by another buyer', async () => {
    order.status = 'delivered';
    await expect(service.confirmOrder(99, 'TEST-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('filters the seller list by their shipment status', async () => {
    const qb: any = {};
    for (const key of ['innerJoinAndSelect', 'leftJoinAndSelect', 'orderBy', 'take', 'skip', 'andWhere']) qb[key] = jest.fn(() => qb);
    qb.getManyAndCount = jest.fn(async () => [[], 0]); repository.createQueryBuilder = () => qb;
    await service.getSellerOrders(20, { status: 'shipped' } as any);
    expect(qb.andWhere).toHaveBeenCalledWith('shipments.status = :status', { status: 'shipped' });
    expect(qb.andWhere).not.toHaveBeenCalledWith('order.status = :status', expect.anything());
  });

  it('automatic delivery and confirmation skip registered fixtures and process ordinary orders', async () => {
    const demoPolicy = { ...mockDemoPolicy(), isFixtureOrder: jest.fn(async (id: number) => id === 2) };
    const audit = { log: jest.fn() };
    const cronShipments = { find: jest.fn(async () => [
      { id: 20, orderId: 2, sellerId: 7, order: { orderNumber: 'DEMO' } },
      { id: 21, orderId: 1, sellerId: 7, order: { orderNumber: 'TEST-1' } },
    ]) };
    repository.find = jest.fn(async () => [
      { id: 2, userId: 11, orderNumber: 'DEMO' },
      { id: 1, userId: 10, orderNumber: 'TEST-1' },
    ]);
    service = new OrderService(repository, cronShipments as never, {} as never, sellerRepository,
      { transaction: (fn: any) => fn(manager) } as any, events, audit as never, demoPolicy as never);
    const delivery = jest.spyOn(service as any, 'changeShipments').mockResolvedValue({
      order: { id: 1, orderNumber: 'TEST-1' }, changed: true, orderDelivered: true,
    });
    const confirm = jest.spyOn(service, 'confirmOrder').mockResolvedValue(order);
    await service.autoDeliverShipments();
    await service.autoCompleteOrders();
    expect(delivery).toHaveBeenCalledTimes(1);
    expect(delivery).toHaveBeenCalledWith('TEST-1', 'deliver', { sellerId: 7 });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(10, 'TEST-1');
    expect(audit.log).toHaveBeenCalledTimes(2);
  });
});
