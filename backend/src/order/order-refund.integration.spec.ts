import { DemoPolicyService } from '../demo/demo-policy.service';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { connectionOptions } from '../database/connection-options';
import { OrderService } from './order.service';
import { PaymentService } from '../payment/payment.service';
import { OrderEntity } from './entity/order.entity';
import { OrderItemEntity } from './entity/order-item.entity';
import { ShipmentEntity } from './entity/shipment.entity';
import { PaymentEntity } from '../payment/entity/payment.entity';
import { ProductEntity } from '../product/entity/product.entity';
import { SellerEntity } from '../seller/entity/seller.entity';

// Existing schema, isolated fixtures only: never synchronize, dropSchema, reset seeds, or contact a PG.
describe('Order delivery versus refund (real PostgreSQL)', () => {
  const runId = `EDGE-RACE-${Date.now()}`;
  const originalFlag = process.env.TEST_DELIVERY_ENABLED;
  const orderIds: number[] = [];
  let ds: DataSource;
  let buyerId: number;
  let sellerId: number;
  let productId: number;
  let orders: OrderService;
  let payments: PaymentService;
  let events: { emit: jest.Mock };
  let pgCancel: jest.SpyInstance;

  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  };

  beforeAll(async () => {
    process.env.TEST_DELIVERY_ENABLED = 'true';
    ds = await new DataSource({ ...connectionOptions, entities: ['src/**/*.entity.ts'], synchronize: false }).initialize();
    const [seller] = await ds.query(`SELECT s.id FROM sellers s JOIN users u ON u.id=s.user_id
      WHERE u.email=$1 AND s.status='approved'`, [process.env.TEST_SELLER_EMAIL || 'seller1@seed.com']);
    if (!seller) throw new Error('Approved test seller required');
    sellerId = seller.id;
    const [buyer] = await ds.query(`INSERT INTO users (email,password,"nickName","phoneNumber",address,"isEmailVerified")
      VALUES ($1,'unusable test password','edge tester','01000000000','TEST',true) RETURNING id`, [`${runId}@test.local`]);
    buyerId = buyer.id;
    const [product] = await ds.query(`INSERT INTO products (name,description,price,brand,"stockQuantity",status,approval_status,"isEvent",seller_id)
      VALUES ($1,'Temporary concurrency fixture',1000,'TEST',10,'hidden','approved',false,$2) RETURNING id`, [runId, sellerId]);
    productId = product.id;
  });

  beforeEach(() => {
    events = { emit: jest.fn() };
    orders = new OrderService(ds.getRepository(OrderEntity), ds.getRepository(OrderItemEntity), {} as any,
      ds.getRepository(SellerEntity), ds, events as any, {} as any, new DemoPolicyService(ds));
    payments = new PaymentService(ds.getRepository(PaymentEntity), ds.getRepository(OrderEntity),
      ds.getRepository(OrderItemEntity), ds.getRepository(ProductEntity), ds,
      { get: () => { throw new Error('External PG disabled'); }, post: () => { throw new Error('External PG disabled'); } } as any,
      {} as any, events as any, new DemoPolicyService(ds));
    pgCancel = jest.spyOn(payments as any, 'cancelPaymentOnPortOne').mockResolvedValue({ status: 'SUCCEEDED', amount: 1000, cancelledAt: null });
  });

  afterAll(async () => {
    if (originalFlag === undefined) delete process.env.TEST_DELIVERY_ENABLED;
    else process.env.TEST_DELIVERY_ENABLED = originalFlag;
    if (ds?.isInitialized) {
      if (orderIds.length) {
        await ds.query('DELETE FROM payments WHERE order_id=ANY($1::int[])', [orderIds]);
        await ds.query('DELETE FROM orders WHERE id=ANY($1::int[]) AND memo=$2', [orderIds, runId]);
      }
      if (productId) await ds.query('DELETE FROM products WHERE id=$1 AND name=$2', [productId, runId]);
      if (buyerId) await ds.query('DELETE FROM users WHERE id=$1 AND email=$2', [buyerId, `${runId}@test.local`]);
      await ds.destroy();
    }
  });

  async function fixture(tag: string) {
    const number = `${runId}-${tag}`;
    const [order] = await ds.query(`INSERT INTO orders (order_number,user_id,status,total_amount,shipping_address,recipient_name,recipient_phone,memo)
      VALUES ($1,$2,'preparing',1000,'TEST','TEST','01000000000',$3) RETURNING id`, [number, buyerId, runId]);
    orderIds.push(order.id);
    await ds.query("INSERT INTO payments (order_id,merchant_uid,amount,status) VALUES ($1,$2,1000,'paid')", [order.id, number]);
    await ds.query(`INSERT INTO order_items (order_id,product_id,seller_id,product_name,product_price,quantity,subtotal)
      VALUES ($1,$2,$3,'TEST',1000,1,1000)`, [order.id, productId, sellerId]);
    await ds.query("INSERT INTO shipments (order_id,seller_id,status) VALUES ($1,$2,'preparing')", [order.id, sellerId]);
    return { id: order.id, number };
  }

  async function state(id: number) {
    const [row] = await ds.query(`SELECT o.status, p.status AS payment, x."stockQuantity" AS stock
      FROM orders o JOIN payments p ON p.order_id=o.id CROSS JOIN products x WHERE o.id=$1 AND x.id=$2`, [id, productId]);
    return row;
  }

  it('refund wins while delivery waits for the same order lock', async () => {
    const order = await fixture('REFUND-FIRST');
    const before = await state(order.id);
    const entered = deferred(); const release = deferred();
    pgCancel.mockImplementation(async () => { entered.resolve(); await release.promise; return { status: 'SUCCEEDED', amount: 1000, cancelledAt: null }; });
    const refund = payments.cancelPayment(buyerId, order.number, { reason: 'TEST' });
    await entered.promise;
    const delivery = orders.markTestDelivered(buyerId, order.number);
    const outcomes = Promise.allSettled([refund, delivery]);
    release.resolve();
    const results = await outcomes;
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(await state(order.id)).toEqual({ status: 'cancelled', payment: 'cancelled', stock: before.stock + 1 });
    expect(pgCancel).toHaveBeenCalledTimes(1);
    expect(events.emit.mock.calls.map((call) => call[0])).toEqual(['order.cancelled']);
  });

  it('delivery wins while refund waits and never contacts the provider', async () => {
    const order = await fixture('DELIVERY-FIRST');
    const before = await state(order.id);
    const entered = deferred(); const release = deferred();
    const gatedDs = { transaction: (fn: any) => ds.transaction((manager) => fn(new Proxy(manager, {
      get(target, key) {
        if (key === 'findOne') return async (entity: any, options: any) => {
          const row = await target.findOne(entity, options);
          if (entity === OrderEntity && options.lock) { entered.resolve(); await release.promise; }
          return row;
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }))) };
    const gatedOrders = new OrderService(ds.getRepository(OrderEntity), ds.getRepository(OrderItemEntity), {} as any,
      ds.getRepository(SellerEntity), gatedDs as any, events as any, {} as any, new DemoPolicyService(ds));
    const delivery = gatedOrders.markTestDelivered(buyerId, order.number);
    await entered.promise;
    const outcomes = Promise.allSettled([delivery, payments.cancelPayment(buyerId, order.number, { reason: 'TEST' })]);
    release.resolve();
    const results = await outcomes;
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(await state(order.id)).toEqual({ status: 'delivered', payment: 'paid', stock: before.stock });
    expect(pgCancel).not.toHaveBeenCalled();
    expect(events.emit.mock.calls.map((call) => call[0])).toEqual(['order.delivered']);
  });

  it('eight simultaneous refunds restore stock and emit cancellation only once', async () => {
    const order = await fixture('RETRIES');
    const before = await state(order.id);
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => payments.cancelPayment(buyerId, order.number, { reason: 'TEST' })));
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await state(order.id)).toEqual({ status: 'cancelled', payment: 'cancelled', stock: before.stock + 1 });
    expect(pgCancel).toHaveBeenCalledTimes(1); expect(events.emit).toHaveBeenCalledTimes(1);
  });
});
