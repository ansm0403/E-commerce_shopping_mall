import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { ValidationPipe } from '@nestjs/common';
import { connectionOptions } from '../database/connection-options';
import { ROLE_DEMO_ENTITIES } from '../seed/role-demo.entities';
import { prepareRoleDemo } from '../seed/prepare-role-demo';
import { Role, RoleEntity } from '../user/entity/role.entity';
import { UserModel } from '../user/entity/user.entity';
import { CategoryEntity } from '../category/entity/category.entity';
import {
  ApprovalStatus,
  ProductEntity,
  ProductStatus,
} from '../product/entity/product.entity';
import { mockProductCatalog } from '../common/seeds/mock-product-catalog';
import { DemoCheckout1791849600000 } from '../database/migrations/1791849600000-DemoCheckout';
import {
  DemoCheckoutOrderEntity,
  DemoCheckoutVisitEntity,
} from './entity/demo-checkout.entity';
import { DemoCheckoutService, DEMO_SHIPPING } from './demo-checkout.service';
import { DemoPortOnePayment, DemoPortOneService } from './demo-portone.service';
import { CreateDemoCheckoutDto } from './dto/demo-checkout.dto';
import { seedCatalogOwner } from './testing/catalog-owner.fixture';

/** Real PostgreSQL and the real gateway validator; only external HTTP is mocked. */
describe('Isolated PortOne TEST checkout', () => {
  let ds: DataSource;
  let admin: DataSource;
  let schema: string;
  let service: DemoCheckoutService;
  let gateway: DemoPortOneService;
  let buyerId: number;
  let productId: number;
  let baseline: unknown;
  const http = { get: jest.fn(), post: jest.fn() };
  const settings = {
    DEMO_CHECKOUT_ENABLED: 'true',
    DEMO_PORTONE_CHANNEL_IS_TEST: 'true',
    DEMO_PORTONE_STORE_ID: 'store-test',
    DEMO_PORTONE_CHANNEL_KEY: 'channel-test',
    PORTONE_API_SECRET: 'test-secret',
  };
  const actor = () => ({
    sub: buyerId,
    demoSessionId: randomUUID(),
  });

  async function normalSnapshot() {
    return ds.query(`SELECT (SELECT count(*) FROM orders)::int AS orders,
      (SELECT count(*) FROM payments)::int AS payments,
      (SELECT count(*) FROM shipments)::int AS shipments,
      (SELECT sum("stockQuantity") FROM products)::text AS stock,
      (SELECT sum("salesCount") FROM products)::text AS sales`);
  }
  beforeAll(async () => {
    schema = `demo_checkout_test_${randomUUID().replace(/-/g, '')}`;
    admin = await new DataSource(connectionOptions).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    ds = await new DataSource({
      ...connectionOptions,
      schema,
      entities: [
        ...ROLE_DEMO_ENTITIES,
        DemoCheckoutVisitEntity,
        DemoCheckoutOrderEntity,
      ],
      extra: { options: `-c search_path=${schema}` },
    }).initialize();
    // Synchronize operational entities only, then run the actual new migration.
    const setup = await new DataSource({
      ...connectionOptions,
      schema,
      entities: ROLE_DEMO_ENTITIES,
      synchronize: true,
      extra: { options: `-c search_path=${schema}` },
    }).initialize();
    await setup.destroy();
    const runner = ds.createQueryRunner();
    try {
      await new DemoCheckout1791849600000().up(runner);
    } finally {
      await runner.release();
    }
    await ds
      .getRepository(RoleEntity)
      .save([Role.BUYER, Role.SELLER, Role.ADMIN].map((name) => ({ name })));
    await ds.getRepository(CategoryEntity).save({ name: 'test', slug: 'test' });
    const owner = await seedCatalogOwner(ds);
    const product = await ds.getRepository(ProductEntity).save({
      sellerId: owner.id,
      seedKey: mockProductCatalog[0].seedKey,
      name: 'Test sample',
      description: 'Test',
      brand: 'Test',
      price: 1000,
      isEvent: false,
      stockQuantity: 10,
      status: ProductStatus.PUBLISHED,
      approvalStatus: ApprovalStatus.APPROVED,
    });
    productId = product.id;
    await prepareRoleDemo(ds, { apply: true });
    const buyer = await ds
      .getRepository(UserModel)
      .findOneByOrFail({ email: process.env.DEMO_BUYER_EMAIL });
    buyerId = buyer.id;
    baseline = await normalSnapshot();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new DemoPortOneService(
      new ConfigService(settings),
      http as never
    );
    service = new DemoCheckoutService(ds, gateway);
    http.post.mockReturnValue(
      of({ data: { cancellation: { status: 'SUCCEEDED' } } })
    );
  });
  afterEach(async () => {
    expect(await normalSnapshot()).toEqual(baseline);
  });
  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (!/^demo_checkout_test_[a-f0-9]{32}$/.test(schema))
      throw new Error('Unexpected test schema');
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.destroy();
  });
  async function create(who = actor()) {
    await service.changeCart(who, 'add', productId, 1);
    const order = await service.create(who, randomUUID());
    return { who, order };
  }
  function payment(order: {
    orderNumber: string;
    totalAmount: number;
  }): DemoPortOnePayment {
    return {
      id: order.orderNumber,
      storeId: 'store-test',
      transactionId: 'tx-test',
      status: 'PAID',
      currency: 'KRW',
      amount: { total: order.totalAmount },
      channel: { type: 'TEST', key: 'channel-test', pgProvider: 'KAKAOPAY' },
      paidAt: new Date().toISOString(),
      method: { type: 'PaymentMethodEasyPay' },
    };
  }
  it('separates visitors sharing the same buyer and prevents guessed order access', async () => {
    const { who, order } = await create();
    const other = actor();
    expect((await service.cart(other)).items).toHaveLength(0);
    expect(await service.list(other)).toEqual([]);
    await expect(
      service.detail(other, order.orderNumber)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.cancel(other, order.orderNumber)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.verify(other, order.orderNumber, 'tx-test')
    ).rejects.toMatchObject({ status: 404 });
    expect(http.get).not.toHaveBeenCalled();
    expect((await service.cart(who)).items).toHaveLength(1);
  });
  it('rejects missing session claims and seller accounts', async () => {
    await expect(service.cart({ sub: buyerId })).rejects.toMatchObject({
      status: 403,
    });
    const seller = await ds
      .getRepository(UserModel)
      .findOneByOrFail({ email: process.env.DEMO_SELLER_EMAIL });
    await expect(
      service.cart({ sub: seller.id, demoSessionId: randomUUID() })
    ).rejects.toMatchObject({ status: 403 });
  });
  it('validates quantities, catalog ownership and strictly rejects client price/address fields', async () => {
    const who = actor();
    for (const quantity of [0, -1, 1.5, 6])
      await expect(
        service.changeCart(who, 'add', productId, quantity)
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.changeCart(who, 'add', 2147483647, 1)
    ).rejects.toMatchObject({ status: 400 });
    await expect(service.create(who, randomUUID())).rejects.toMatchObject({
      status: 400,
    });
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        { requestId: randomUUID(), totalAmount: 1, shippingAddress: 'private' },
        {
          type: 'body',
          metatype: CreateDemoCheckoutDto,
        }
      )
    ).rejects.toMatchObject({ status: 400 });
    const { order } = await create(who);
    expect(order.totalAmount).toBe(4000);
    expect(order).toMatchObject(DEMO_SHIPPING);
    expect(order.testPayment).toEqual({
      storeId: 'store-test',
      channelKey: 'channel-test',
    });
  });
  it('serializes duplicate creates and enforces the pending order cap under concurrent requests', async () => {
    const who = actor();
    await service.changeCart(who, 'add', productId, 1);
    const request = randomUUID();
    const duplicates = await Promise.all(
      Array.from({ length: 6 }, () => service.create(who, request))
    );
    expect(new Set(duplicates.map((order) => order.orderNumber)).size).toBe(1);
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () => service.create(who, randomUUID()))
    );
    expect(
      attempts.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(2);
    expect(
      attempts
        .filter((result) => result.status === 'rejected')
        .every(
          (result) =>
            result.status === 'rejected' && result.reason.status === 429
        )
    ).toBe(true);
    await service.cancel(who, duplicates[0].orderNumber);
    expect((await service.create(who, randomUUID())).status).toBe(
      'pending_payment'
    );
  });
  it.each([
    'LIVE',
    'missing',
    'channel',
    'amount',
    'currency',
    'store',
    'id',
    'transaction',
    'pending',
  ])('rejects invalid gateway results: %s', async (mismatch) => {
    const { who, order } = await create();
    const result = payment(order);
    if (mismatch === 'LIVE') result.channel.type = 'LIVE';
    if (mismatch === 'missing')
      delete (result as Partial<DemoPortOnePayment>).channel;
    if (mismatch === 'channel') result.channel.key = 'other';
    if (mismatch === 'amount') result.amount.total++;
    if (mismatch === 'currency') result.currency = 'USD';
    if (mismatch === 'store') result.storeId = 'other';
    if (mismatch === 'id') result.id = 'other';
    if (mismatch === 'transaction') result.transactionId = 'other';
    if (mismatch === 'pending') result.status = 'READY';
    http.get.mockReturnValue(of({ data: result }));
    await expect(
      service.verify(who, order.orderNumber, 'tx-test')
    ).rejects.toBeDefined();
    expect((await service.detail(who, order.orderNumber)).status).toBe(
      'pending_payment'
    );
    expect((await service.cart(who)).items).toHaveLength(1);
    expect(http.post).not.toHaveBeenCalled();
  });
  it('handles simultaneous verification, reconciliation and webhook exactly once', async () => {
    const { who, order } = await create();
    http.get.mockReturnValue(of({ data: payment(order) }));
    await Promise.all([
      service.verify(who, order.orderNumber, 'tx-test'),
      service.reconcile(who, order.orderNumber),
      service.webhook('Transaction.Paid', order.orderNumber),
    ]);
    expect((await service.detail(who, order.orderNumber)).status).toBe('paid');
    expect((await service.cart(who)).items).toHaveLength(0);
    expect(
      (
        await ds
          .getRepository(DemoCheckoutVisitEntity)
          .findOneByOrFail({ id: who.demoSessionId })
      ).version
    ).toBe(2);
    expect(http.post).not.toHaveBeenCalled();
    await expect(service.cancel(who, order.orderNumber)).rejects.toMatchObject({
      status: 400,
    });
  });
  it('retains cart changes made while the payment window was open', async () => {
    const { who, order } = await create();
    await service.changeCart(who, 'add', productId, 1);
    http.get.mockReturnValue(of({ data: payment(order) }));
    await service.verify(who, order.orderNumber, 'tx-test');
    expect((await service.cart(who)).items[0].quantity).toBe(2);
  });
  it.each(['expired', 'cancelled'])(
    'compensates a paid TEST transaction for an %s order',
    async (kind) => {
      const { who, order } = await create();
      if (kind === 'expired')
        await ds
          .getRepository(DemoCheckoutOrderEntity)
          .update(order.id, { expiresAt: new Date(0) });
      else await service.cancel(who, order.orderNumber);
      http.get.mockReturnValue(of({ data: payment(order) }));
      await expect(
        service.verify(who, order.orderNumber, 'tx-test')
      ).rejects.toMatchObject({ status: 400 });
      expect((await service.detail(who, order.orderNumber)).status).toBe(
        'cancelled'
      );
      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.post.mock.calls[0][2].headers['Idempotency-Key']).toBe(
        `"demo-cancel-${order.orderNumber}"`
      );
    }
  );
  it('keeps TEST cancellation failures retryable through the webhook', async () => {
    const { who, order } = await create();
    await service.cancel(who, order.orderNumber);
    http.get.mockReturnValue(of({ data: payment(order) }));
    http.post.mockReturnValueOnce(
      of({ data: { cancellation: { status: 'REQUESTED' } } })
    );
    await expect(
      service.webhook('Transaction.Paid', order.orderNumber)
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      service.webhook('Transaction.Paid', order.orderNumber)
    ).resolves.toEqual({ message: 'demo payment verified' });
    const cancelled = payment(order);
    cancelled.status = 'CANCELLED';
    http.get.mockReturnValue(of({ data: cancelled }));
    await service.webhook('Transaction.Paid', order.orderNumber);
    expect(http.post).toHaveBeenCalledTimes(2);
  });
  it('fails closed when the TEST channel is disabled without issuing a payment request', async () => {
    const disabled = new DemoPortOneService(
      new ConfigService({ ...settings, DEMO_CHECKOUT_ENABLED: 'false' }),
      http as never
    );
    const blocked = new DemoCheckoutService(ds, disabled);
    expect((await blocked.options(actor())).enabled).toBe(false);
    await expect(blocked.create(actor(), randomUUID())).rejects.toMatchObject({
      status: 503,
    });
    expect(http.get).not.toHaveBeenCalled();
  });
  it('expires and removes only isolated demo rows', async () => {
    const { who, order } = await create();
    await ds
      .getRepository(DemoCheckoutOrderEntity)
      .update(order.id, { expiresAt: new Date(0) });
    await service.cleanup();
    expect((await service.detail(who, order.orderNumber)).status).toBe(
      'cancelled'
    );
    await ds
      .getRepository(DemoCheckoutVisitEntity)
      .update(who.demoSessionId, { expiresAt: new Date(0) });
    await service.cleanup();
    await expect(service.detail(who, order.orderNumber)).rejects.toMatchObject({
      status: 404,
    });
    expect(await normalSnapshot()).toEqual(baseline);
  });
});
