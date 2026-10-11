import { mockDemoPolicy } from '../demo/demo-policy.mock';
import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

jest.mock('../order/entity/order.entity', () => ({
  OrderEntity: class OrderEntity {},
  OrderStatus: { PENDING_PAYMENT: 'pending_payment', PAID: 'paid', PREPARING: 'preparing', SHIPPED: 'shipped', DELIVERED: 'delivered', COMPLETED: 'completed', CANCELLED: 'cancelled' },
}));

import { PaymentService } from './payment.service';
import { OrderEntity } from '../order/entity/order.entity';
import { PaymentEntity } from './entity/payment.entity';
import { ShipmentEntity } from '../order/entity/shipment.entity';

describe('Refund versus shipment completion', () => {
  let service: PaymentService;
  let order: any;
  let payment: any;
  let shipments: any[];
  let manager: any;
  let cancel: jest.SpyInstance;
  let events: { emit: jest.Mock };
  let stock: { execute: jest.Mock };

  beforeEach(() => {
    order = { id: 1, userId: 10, orderNumber: 'TEST', status: 'preparing' };
    payment = { id: 2, orderId: 1, paymentId: 'TEST', status: 'paid' };
    shipments = [{ id: 3, orderId: 1, status: 'preparing' }];
    const items = [{ productId: 7, quantity: 1 }];
    const qb: any = { execute: jest.fn().mockResolvedValue({ affected: 1 }) };
    for (const key of ['update', 'set', 'setParameter', 'where']) qb[key] = jest.fn(() => qb);
    stock = qb;
    manager = {
      findOne: jest.fn(async (entity) => entity === OrderEntity ? { ...order } : payment),
      find: jest.fn(async (entity) => entity === ShipmentEntity ? shipments : items),
      update: jest.fn(async (entity, id, values) => Object.assign(entity === OrderEntity ? order : payment, values)),
      delete: jest.fn(), createQueryBuilder: () => qb,
    };
    // A read before acquiring the lock can already be stale.
    const repository = { findOne: jest.fn(async () => ({ ...order, status: 'preparing', items, payment })) };
    events = { emit: jest.fn() };
    service = new PaymentService({ findOne: jest.fn(async () => payment) } as any, repository as any,
      {} as any, {} as any, { transaction: (fn: any) => fn(manager) } as any,
      {} as any, {} as any, events as any, mockDemoPolicy() as any);
    cancel = jest.spyOn(service as any, 'cancelPaymentOnPortOne').mockResolvedValue({ status: 'SUCCEEDED', amount: 1000, cancelledAt: null });
  });

  it.each(['shipped', 'delivered', 'completed', 'cancelled'])('rejects a stale refund after the order became %s', async (status) => {
    order.status = status;
    await expect(service.cancelPayment(10, 'TEST', { reason: 'test' })).rejects.toBeInstanceOf(BadRequestException);
    expect(cancel).not.toHaveBeenCalled(); expect(manager.update).not.toHaveBeenCalled();
  });

  it('rejects full refund when one seller shipped but another is preparing', async () => {
    shipments.push({ id: 4, orderId: 1, status: 'shipped' });
    await expect(service.cancelPayment(10, 'TEST', { reason: 'test' })).rejects.toBeInstanceOf(BadRequestException);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('enforces the buyer identity before calling the payment provider', async () => {
    await expect(service.cancelPayment(99, 'TEST', { reason: 'test' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('refunds once and restores stock once on a repeated request', async () => {
    await service.cancelPayment(10, 'TEST', { reason: 'test' });
    await expect(service.cancelPayment(10, 'TEST', { reason: 'test' })).rejects.toBeInstanceOf(BadRequestException);
    expect(cancel).toHaveBeenCalledTimes(1); expect(stock.execute).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(manager.findOne).toHaveBeenCalledWith(OrderEntity, expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
  });

  it('applies the same state and partial shipment checks to admin refunds', async () => {
    shipments[0].status = 'delivered';
    await expect(service.cancelPaymentByAdmin('TEST', { reason: 'test' })).rejects.toBeInstanceOf(BadRequestException);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('does not update local order or stock if the provider rejects cancellation', async () => {
    cancel.mockResolvedValue({ status: 'FAILED', amount: 0, cancelledAt: null });
    await expect(service.cancelPayment(10, 'TEST', { reason: 'test' })).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.update).not.toHaveBeenCalled(); expect(stock.execute).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('Isolated demo payment webhook dispatch', () => {
  const payload = { type: 'Transaction.Paid', data: { paymentId: 'DEMO-PG-test', transactionId: 'tx-test' } };
  const normalRepository = { findOne: jest.fn() };
  const events = { emit: jest.fn() };
  const checkout = { webhook: jest.fn() };
  function build(includeDemo = true) {
    return new PaymentService(normalRepository as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, events as never,
      mockDemoPolicy() as never, includeDemo ? checkout as never : undefined);
  }
  beforeEach(() => jest.clearAllMocks());
  it('sends TEST order notifications only to the isolated checkout service', async () => {
    checkout.webhook.mockResolvedValue({ message: 'demo payment verified' });
    await expect(build().handleWebhook(payload)).resolves.toEqual({ message: 'demo payment verified' });
    expect(checkout.webhook).toHaveBeenCalledWith(payload.type, payload.data.paymentId);
    expect(normalRepository.findOne).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
  it('propagates transient errors so PortOne can retry', async () => {
    checkout.webhook.mockRejectedValue(new ServiceUnavailableException('retry'));
    await expect(build().handleWebhook(payload)).rejects.toMatchObject({ status: 503 });
    expect(normalRepository.findOne).not.toHaveBeenCalled();
  });
  it('never falls back to operational payments if the demo provider is absent', async () => {
    await expect(build(false).handleWebhook(payload)).rejects.toMatchObject({ status: 503 });
    expect(normalRepository.findOne).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });
});
