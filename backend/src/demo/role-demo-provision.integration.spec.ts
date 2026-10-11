import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { connectionOptions } from '../database/connection-options';
import { ROLE_DEMO_ENTITIES } from '../seed/role-demo.entities';
import { prepareRoleDemo } from '../seed/prepare-role-demo';
import { Role, RoleEntity } from '../user/entity/role.entity';
import { CategoryEntity } from '../category/entity/category.entity';
import {
  ApprovalStatus,
  ProductEntity,
  ProductStatus,
} from '../product/entity/product.entity';
import { mockProductCatalog } from '../common/seeds/mock-product-catalog';
import { DemoPolicyService } from './demo-policy.service';
import { OrderService } from '../order/order.service';
import { OrderEntity } from '../order/entity/order.entity';
import { ShipmentEntity } from '../order/entity/shipment.entity';
import { SellerEntity } from '../seller/entity/seller.entity';
import { InquiryService } from '../inquiry/inquiry.service';
import { InquiryEntity } from '../inquiry/entity/inquiry.entity';
import { ReviewService } from '../review/review.service';
import { ReviewEntity } from '../review/entity/review.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import { UserModel } from '../user/entity/user.entity';
import * as bcrypt from 'bcrypt';
import { seedCatalogOwner } from './testing/catalog-owner.fixture';
import { CartEntity } from '../cart/entity/cart.entity';
import { CartItemEntity } from '../cart/entity/cart-item.entity';
import { PaymentEntity, PaymentStatus } from '../payment/entity/payment.entity';
import { CommonService } from '../common/common.service';
import { ConfigService } from '@nestjs/config';
import { SellerInquiryQueryDto } from '../inquiry/dto/seller-inquiry-query.dto';
import { SettlementEntity } from '../settlement/entity/settlement.entity';
import { SettlementService } from '../settlement/settlement.service';
import { ProductService } from '../product/product.service';
import { ProductImageEntity } from '../product/entity/product-image.entity';
import { ProductQueryDto } from '../product/dto/product-query.dto';

/** All writes and schema synchronization are confined to a newly created test schema. */
describe('First role-demo provisioning and rollback', () => {
  let ds: DataSource;
  let admin: DataSource;
  let schema: string;
  beforeEach(async () => {
    schema = `role_demo_test_${randomUUID().replace(/-/g, '')}`;
    admin = await new DataSource(connectionOptions).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    ds = await new DataSource({
      ...connectionOptions,
      schema,
      entities: ROLE_DEMO_ENTITIES,
      synchronize: true,
      extra: { options: `-c search_path=${schema}` },
    }).initialize();
    await ds
      .getRepository(RoleEntity)
      .save([Role.BUYER, Role.SELLER, Role.ADMIN].map((name) => ({ name })));
    await ds.getRepository(CategoryEntity).save({ name: 'test', slug: 'test' });
    const owner = await seedCatalogOwner(ds);
    await ds.getRepository(ProductEntity).save({
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
  });
  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
    // The identifier is generated here and checked before any schema deletion.
    if (!/^role_demo_test_[a-f0-9]{32}$/.test(schema))
      throw new Error('Unexpected test schema');
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.destroy();
  });
  async function counts() {
    return ds.query(`SELECT (SELECT count(*) FROM users)::int AS users,
      (SELECT count(*) FROM sellers)::int AS sellers,(SELECT count(*) FROM orders)::int AS orders,
      (SELECT count(*) FROM demo_fixtures)::int AS fixtures,
      (SELECT count(*) FROM products WHERE seller_id IS NOT NULL)::int AS owned`);
  }
  it('dry-run creates no accounts and two initial concurrent batches create exactly one set', async () => {
    const plan = await prepareRoleDemo(ds, { apply: false });
    expect(plan.createBuyer).toBe(true);
    expect(plan.createSeller).toBe(true);
    expect(await counts()).toEqual([
      { users: 1, sellers: 1, orders: 0, fixtures: 0, owned: 1 },
    ]);
    const results = await Promise.all([
      prepareRoleDemo(ds, { apply: true }),
      prepareRoleDemo(ds, { apply: true }),
    ]);
    expect(
      results
        .map((r) => ('createdFixtureIds' in r ? r.createdFixtureIds.length : 0))
        .sort()
    ).toEqual([0, 8]);
    expect(await counts()).toEqual([
      { users: 3, sellers: 2, orders: 5, fixtures: 8, owned: 1 },
    ]);
  });

  it('does not silently approve an existing demo seller account whose seller record is missing', async () => {
    const roles = await ds.getRepository(RoleEntity).find();
    const password = process.env.DEMO_SELLER_PASSWORD;
    if (!password) throw new Error('Demo seller password is required');
    await ds.getRepository(UserModel).save({
      email: process.env.DEMO_SELLER_EMAIL,
      password: await bcrypt.hash(password, 10),
      roles: roles.filter((r) => [Role.BUYER, Role.SELLER].includes(r.name)),
      nickName: 'Existing demo seller',
      phoneNumber: '010-0000-0000',
      address: 'Test',
      isDemo: true,
      isEmailVerified: true,
    });
    const before = await counts();
    await expect(prepareRoleDemo(ds, { apply: true })).rejects.toThrow('셀러');
    expect(await counts()).toEqual(before);
  });
  it.each(['sellers', 'demo_fixtures'])(
    'failure while inserting %s rolls back accounts, ownership and orders',
    async (table) => {
      ds.subscribers.push({
        beforeInsert: (event) => {
          if (event.metadata.tableName === table)
            throw new Error('Injected provisioning failure');
        },
      });
      await expect(prepareRoleDemo(ds, { apply: true })).rejects.toThrow(
        'Injected provisioning failure'
      );
      expect(await counts()).toEqual([
        { users: 1, sellers: 1, orders: 0, fixtures: 0, owned: 1 },
      ]);
    }
  );
  it('the registry rejects missing targets and entries with both targets', async () => {
    await prepareRoleDemo(ds, { apply: true });
    await expect(
      ds.query(
        "INSERT INTO demo_fixtures(scope,fixture_key,order_id) VALUES ('role-demo-v1','invalid',-1)"
      )
    ).rejects.toMatchObject({ driverError: { code: '23503' } });
    const [{ order_id }] = await ds.query(
      'SELECT order_id FROM demo_fixtures WHERE order_id IS NOT NULL LIMIT 1'
    );
    const [{ inquiry_id }] = await ds.query(
      'SELECT inquiry_id FROM demo_fixtures WHERE inquiry_id IS NOT NULL LIMIT 1'
    );
    await expect(
      ds.query(
        "INSERT INTO demo_fixtures(scope,fixture_key,order_id,inquiry_id) VALUES ('role-demo-v1','both',$1,$2)",
        [order_id, inquiry_id]
      )
    ).rejects.toMatchObject({ driverError: { code: '23514' } });
  });

  it('validates an order using its transaction connection when the pool has only one connection', async () => {
    await prepareRoleDemo(ds, { apply: true });
    const [{ order_id: orderId, user_id: userId }] = await ds.query(
      'SELECT f.order_id,o.user_id FROM demo_fixtures f JOIN orders o ON o.id=f.order_id LIMIT 1'
    );
    const smallPool = await new DataSource({
      ...connectionOptions,
      schema,
      entities: ROLE_DEMO_ENTITIES,
      extra: {
        options: `-c search_path=${schema}`,
        max: 1,
        connectionTimeoutMillis: 1000,
      },
    }).initialize();
    try {
      const policy = new DemoPolicyService(smallPool);
      await expect(
        smallPool.transaction(async (manager) => {
          await manager.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [
            orderId,
          ]);
          await policy.assertOrderActor(userId, orderId, manager);
        })
      ).resolves.toBeUndefined();
    } finally {
      await smallPool.destroy();
    }
  });

  it.each(['missing seller', 'empty items'])(
    'rejects a registered order with %s',
    async (corruption) => {
      await prepareRoleDemo(ds, { apply: true });
      const [{ order_id: orderId, user_id: userId }] = await ds.query(
        'SELECT f.order_id,o.user_id FROM demo_fixtures f JOIN orders o ON o.id=f.order_id LIMIT 1'
      );
      await ds.query(
        corruption === 'missing seller'
          ? 'UPDATE order_items SET seller_id=NULL WHERE order_id=$1'
          : 'DELETE FROM order_items WHERE order_id=$1',
        [orderId]
      );
      await expect(
        new DemoPolicyService(ds).assertOrderActor(userId, orderId)
      ).rejects.toMatchObject({ status: 403 });
    }
  );

  it('rejects shipment states that disagree with the registered order before replenishing', async () => {
    await prepareRoleDemo(ds, { apply: true });
    await ds.query(
      "UPDATE shipments SET status='delivered' WHERE order_id=(SELECT id FROM orders WHERE status='preparing' LIMIT 1)"
    );
    const before = await counts();
    await expect(
      prepareRoleDemo(ds, { apply: true, replenish: true })
    ).rejects.toThrow('정합성');
    expect(await counts()).toEqual(before);
  });

  it('rejects a malformed fixture key before deriving the next sequence', async () => {
    await prepareRoleDemo(ds, { apply: true });
    await ds.query(
      "UPDATE demo_fixtures SET fixture_key='preparing/not-a-number' WHERE id=(SELECT id FROM demo_fixtures WHERE order_id IS NOT NULL LIMIT 1)"
    );
    const before = await counts();
    await expect(
      prepareRoleDemo(ds, { apply: true, replenish: true })
    ).rejects.toThrow('fixture 키');
    expect(await counts()).toEqual(before);
  });

  it('never reports a negative replenishment count when historical inquiries exceed the cap', async () => {
    await prepareRoleDemo(ds, { apply: true });
    await ds.query(`INSERT INTO inquiries(user_id,product_id,seller_id,title,content,status)
      SELECT i.user_id,i.product_id,i.seller_id,'history','test','answered'
      FROM inquiries i CROSS JOIN generate_series(1,98) WHERE i.id=(SELECT min(id) FROM inquiries)`);
    const plan = await prepareRoleDemo(ds, { apply: false, replenish: true });
    expect(plan.inquiryLimitReached).toBe(true);
    expect(plan.plans.find((p) => p.kind === 'inquiry')?.count).toBe(0);
  });

  it('allows only one of two simultaneous inquiries at the lifetime boundary and replenishes none', async () => {
    await prepareRoleDemo(ds, { apply: true });
    await ds.query(`INSERT INTO inquiries(user_id,product_id,seller_id,title,content,status)
      SELECT i.user_id,i.product_id,i.seller_id,'history','test','answered'
      FROM inquiries i CROSS JOIN generate_series(1,96) WHERE i.id=(SELECT min(id) FROM inquiries)`);
    const [{ user_id: userId, product_id: productId }] = await ds.query(
      'SELECT * FROM inquiries LIMIT 1'
    );
    const policy = new DemoPolicyService(ds);
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        policy.createDemoInquiry(userId, {
          productId,
          title: 'Boundary',
          content: 'Test',
          isSecret: false,
        })
      )
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .map((r) => r.status === 'rejected' && r.reason.status)
    ).toEqual([429]);
    const before = await counts();
    const plan = await prepareRoleDemo(ds, { apply: true, replenish: true });
    expect(plan.createdFixtureIds).toEqual([]);
    expect(plan.inquiryLimitReached).toBe(true);
    expect(await counts()).toEqual(before);
    expect(
      (await ds.query('SELECT count(*)::int AS total FROM inquiries'))[0].total
    ).toBe(100);
  });

  function orderService(events: { emit: jest.Mock }) {
    return new OrderService(
      ds.getRepository(OrderEntity),
      ds.getRepository(ShipmentEntity),
      ds.getRepository(CartEntity),
      ds.getRepository(SellerEntity),
      ds,
      events as never,
      { log: jest.fn() } as never,
      new DemoPolicyService(ds)
    );
  }

  it('lets the demo seller browse only catalog samples while their actual owner stays unchanged', async () => {
    await prepareRoleDemo(ds, { apply: true });
    const [sample] = await ds.getRepository(ProductEntity).find();
    const owner = await ds.getRepository(SellerEntity).findOneByOrFail({ id: sample.sellerId! });
    const demoSeller = await ds.getRepository(SellerEntity).findOneOrFail({ where: { user: { email: process.env.DEMO_SELLER_EMAIL } } });
    const privateProduct = await ds.getRepository(ProductEntity).save({
      name: 'Private catalog product', description: 'Private draft', brand: 'Test', price: 1000,
      stockQuantity: 10, isEvent: false, sellerId: owner.id, status: ProductStatus.DRAFT,
      approvalStatus: ApprovalStatus.PENDING,
    });
    const products = new ProductService(
      ds.getRepository(ProductEntity), ds.getRepository(ProductImageEntity), ds.getRepository(SellerEntity),
      ds.getRepository(OrderItemEntity), ds.getRepository(CategoryEntity), ds, {} as never, {} as never,
      new CommonService(new ConfigService()), {} as never, new DemoPolicyService(ds)
    );
    for (const page of [undefined, 1]) {
      const query = Object.assign(new ProductQueryDto(), { page, take: 100 });
      const result = await products.findMyProducts(demoSeller.userId, query);
      expect(result.data.map((entry) => entry.id)).toEqual([sample.id]);
      const ordinary = await products.findMyProducts(owner.userId, query);
      expect(ordinary.data.map((entry) => entry.id).sort()).toEqual([sample.id, privateProduct.id].sort());
    }
    expect((await products.findMyProduct(sample.id, demoSeller.userId)).sellerId).toBe(owner.id);
    await expect(products.findMyProduct(privateProduct.id, demoSeller.userId)).rejects.toMatchObject({ status: 403 });
    expect((await ds.getRepository(ProductEntity).findOneByOrFail({ id: sample.id })).sellerId).toBe(owner.id);
  });

  it('keeps ordinary purchasing, delivery and inquiries separate from public demo access', async () => {
    const previous = process.env.TEST_DELIVERY_ENABLED;
    process.env.TEST_DELIVERY_ENABLED = 'true';
    try {
      const [productBefore] = await ds.getRepository(ProductEntity).find();
      await prepareRoleDemo(ds, { apply: true });
      const product = await ds.getRepository(ProductEntity).findOneByOrFail({ id: productBefore.id });
      expect(product.sellerId).toBe(productBefore.sellerId);
      const owner = await ds.getRepository(SellerEntity).findOneByOrFail({ id: product.sellerId! });
      const buyer = await ds.getRepository(UserModel).save({
        email: 'ordinary-buyer@test.local', password: 'Unused test password', nickName: 'Private buyer',
        phoneNumber: '010-0000-0000', address: 'Private address', isDemo: false,
        roles: await ds.getRepository(RoleEntity).findBy({ name: Role.BUYER }),
      });
      const cart = await ds.getRepository(CartEntity).save({ userId: buyer.id });
      const item = await ds.getRepository(CartItemEntity).save({ cartId: cart.id, productId: product.id, quantity: 1 });
      const orders = orderService({ emit: jest.fn() });
      const order = await orders.createOrder(buyer.id, {
        cartItemIds: [item.id], recipientName: 'Private buyer', recipientPhone: '010-0000-0000', shippingAddress: 'Private address',
      });
      const snapshot = await ds.getRepository(OrderItemEntity).findOneByOrFail({ orderId: order.id });
      expect(snapshot.sellerId).toBe(owner.id);
      expect((await ds.getRepository(ProductEntity).findOneByOrFail({ id: product.id })).stockQuantity).toBe(product.stockQuantity - 1);
      // Simulate the existing ordinary payment-completion event; no external PG request.
      await ds.getRepository(PaymentEntity).update({ orderId: order.id }, { status: PaymentStatus.PAID });
      await ds.getRepository(OrderEntity).update(order.id, { status: 'preparing' as never });
      await ds.getRepository(ShipmentEntity).save({ orderId: order.id, sellerId: owner.id, status: 'preparing' as never });
      expect((await orders.getOrderDetail(buyer.id, order.orderNumber)).canTestDeliver).toBe(false);
      await expect(orders.markTestDelivered(buyer.id, order.orderNumber)).rejects.toMatchObject({ status: 403 });
      await orders.markShipped(owner.userId, order.orderNumber, { carrier: 'Fixture carrier', trackingNumber: 'Fixture tracking' });
      await orders.markSellerDelivered(owner.userId, order.orderNumber);
      await orders.confirmOrder(buyer.id, order.orderNumber);
      expect((await ds.getRepository(OrderEntity).findOneByOrFail({ id: order.id })).status).toBe('completed');

      const policy = new DemoPolicyService(ds);
      const demoBuyer = await ds.getRepository(UserModel).findOneByOrFail({ email: process.env.DEMO_BUYER_EMAIL });
      const demoSellerUser = await ds.getRepository(UserModel).findOneByOrFail({ email: process.env.DEMO_SELLER_EMAIL });
      const demoSeller = await ds.getRepository(SellerEntity).findOneByOrFail({ userId: demoSellerUser.id });
      const inquiries = new InquiryService(ds.getRepository(InquiryEntity), ds.getRepository(ProductEntity), ds.getRepository(SellerEntity), new CommonService(new ConfigService()), policy);
      const ordinary = await inquiries.create(buyer.id, { productId: product.id, title: 'Private inquiry', content: 'Private text' });
      expect(ordinary.sellerId).toBe(owner.id);
      const demo = await policy.createDemoInquiry(demoBuyer.id, { productId: product.id, title: 'Demo inquiry', content: 'Demo text' });
      expect(demo?.sellerId).toBe(demoSeller.id);
      // Even inconsistent legacy ownership must never expose ordinary customer data.
      await ds.getRepository(InquiryEntity).update(ordinary.id, { sellerId: demoSeller.id });
      await ds.getRepository(OrderItemEntity).update(snapshot.id, { sellerId: demoSeller.id });
      const visible = await orders.getSellerOrders(demoSellerUser.id, { page: 1, take: 100 });
      expect(visible.data).toHaveLength(5);
      expect(visible.data.some((entry) => entry.id === order.id)).toBe(false);
      for (const page of [undefined, 1]) {
        const query = Object.assign(new SellerInquiryQueryDto(), { page, take: 100 });
        const results = await inquiries.getSellerInquiries(demoSellerUser.id, query);
        expect(results.data.some((entry) => entry.id === ordinary.id)).toBe(false);
        expect(results.data.some((entry) => entry.id === demo?.id)).toBe(true);
      }
      await expect(inquiries.answer(demoSellerUser.id, ordinary.id, { answer: 'Must fail' })).rejects.toMatchObject({ status: 403 });
      const [{ order_id: fixtureOrderId }] = await ds.query('SELECT order_id FROM demo_fixtures WHERE order_id IS NOT NULL LIMIT 1');
      for (const id of [order.id, fixtureOrderId]) await ds.getRepository(SettlementEntity).save({ orderId: id, sellerId: demoSeller.id, orderNumber: `SETTLEMENT-${id}`, amount: 1000, commissionAmount: 100, settlementAmount: 900 });
      const settlements = new SettlementService(ds.getRepository(SettlementEntity), ds.getRepository(SellerEntity), policy);
      const result = await settlements.getSellerSettlements(demoSellerUser.id, { page: 1, take: 100 });
      expect(result.data.map((entry) => entry.orderId)).toEqual([fixtureOrderId]);
      expect((await settlements.getSellerSummary(demoSellerUser.id)).totalAmount).toBe(1000);
    } finally {
      if (previous === undefined) delete process.env.TEST_DELIVERY_ENABLED;
      else process.env.TEST_DELIVERY_ENABLED = previous;
    }
  });

  it('repairs only explicitly identified former demo ownership and preserves order snapshots', async () => {
    await prepareRoleDemo(ds, { apply: true });
    const seller = await ds.getRepository(SellerEntity).findOneOrFail({ where: { user: { email: process.env.DEMO_SELLER_EMAIL } } });
    const [product] = await ds.getRepository(ProductEntity).find();
    const snapshots = await ds.query('SELECT id,seller_id FROM order_items ORDER BY id');
    await ds.getRepository(ProductEntity).update(product.id, { sellerId: seller.id });
    const previous = process.env.DEMO_PREVIOUS_SELLER_EMAIL;
    try {
      delete process.env.DEMO_PREVIOUS_SELLER_EMAIL;
      await expect(prepareRoleDemo(ds, { apply: true })).rejects.toThrow('카탈로그');
      process.env.DEMO_PREVIOUS_SELLER_EMAIL = process.env.DEMO_SELLER_EMAIL;
      const repaired = await prepareRoleDemo(ds, { apply: true });
      expect(repaired.productIdsToMove).toEqual([product.id]);
      expect((await ds.getRepository(ProductEntity).findOneByOrFail({ id: product.id })).sellerId).toBe(product.sellerId);
      expect(await ds.query('SELECT id,seller_id FROM order_items ORDER BY id')).toEqual(snapshots);
      expect((await prepareRoleDemo(ds, { apply: true })).productIdsToMove).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.DEMO_PREVIOUS_SELLER_EMAIL;
      else process.env.DEMO_PREVIOUS_SELLER_EMAIL = previous;
    }
  });

  it('concurrent delivery, confirmation and review creation change an order only once', async () => {
    await prepareRoleDemo(ds, { apply: true });
    const [{ order_number: orderNumber, user_id: userId, id: orderId }] =
      await ds.query("SELECT * FROM orders WHERE status='preparing' LIMIT 1");
    const events = { emit: jest.fn() };
    const orders = orderService(events);
    const previous = process.env.TEST_DELIVERY_ENABLED;
    process.env.TEST_DELIVERY_ENABLED = 'true';
    try {
      const deliveries = await Promise.all([
        orders.markTestDelivered(userId, orderNumber),
        orders.markTestDelivered(userId, orderNumber),
      ]);
      expect(deliveries.every((o) => o.status === 'delivered')).toBe(true);
      expect(
        events.emit.mock.calls.filter((call) => call[0] === 'order.delivered')
      ).toHaveLength(1);
      const confirmations = await Promise.allSettled([
        orders.confirmOrder(userId, orderNumber),
        orders.confirmOrder(userId, orderNumber),
      ]);
      expect(
        confirmations.filter((r) => r.status === 'fulfilled')
      ).toHaveLength(1);
      expect(
        confirmations
          .filter((r) => r.status === 'rejected')
          .map((r) => r.status === 'rejected' && r.reason.status)
      ).toEqual([400]);
      expect(
        events.emit.mock.calls.filter((call) => call[0] === 'order.completed')
      ).toHaveLength(1);
      const [{ product_id: productId }] = await ds.query(
        'SELECT product_id FROM order_items WHERE order_id=$1',
        [orderId]
      );
      const reviews = new ReviewService(
        ds.getRepository(ReviewEntity),
        ds.getRepository(OrderEntity),
        ds.getRepository(OrderItemEntity),
        events as never,
        {} as never,
        new DemoPolicyService(ds)
      );
      const results = await Promise.allSettled(
        [0, 1].map(() =>
          reviews.create(userId, {
            productId,
            orderId,
            rating: 5,
            comment: 'Concurrent demo review',
          })
        )
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        results
          .filter((r) => r.status === 'rejected')
          .map((r) => r.status === 'rejected' && r.reason.status)
      ).toEqual([400]);
      expect(
        events.emit.mock.calls.filter((call) => call[0] === 'review.created')
      ).toHaveLength(1);
      expect(
        (await ds.query('SELECT count(*)::int AS total FROM reviews'))[0].total
      ).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.TEST_DELIVERY_ENABLED;
      else process.env.TEST_DELIVERY_ENABLED = previous;
    }
  });

  it('concurrent inquiry answers save only one answer', async () => {
    await prepareRoleDemo(ds, { apply: true });
    const [{ inquiry_id: id, user_id: userId }] = await ds.query(
      'SELECT f.inquiry_id,s.user_id FROM demo_fixtures f JOIN inquiries i ON i.id=f.inquiry_id JOIN sellers s ON s.id=i.seller_id LIMIT 1'
    );
    const inquiries = new InquiryService(
      ds.getRepository(InquiryEntity),
      ds.getRepository(ProductEntity),
      ds.getRepository(SellerEntity),
      {} as never,
      new DemoPolicyService(ds)
    );
    const results = await Promise.allSettled(
      ['first', 'second'].map((answer) =>
        inquiries.answer(userId, id, { answer })
      )
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .map((r) => r.status === 'rejected' && r.reason.status)
    ).toEqual([400]);
  });

  it('concurrent replenishment preserves completed history and stock while restoring only missing slots', async () => {
    await prepareRoleDemo(ds, { apply: true });
    const [{ id: orderId }] = await ds.query(
      "SELECT id FROM orders WHERE status='preparing' LIMIT 1"
    );
    await ds.query(
      "UPDATE orders SET status='completed',delivered_at=now(),completed_at=now() WHERE id=$1",
      [orderId]
    );
    await ds.query(
      "UPDATE shipments SET status='delivered',delivered_at=now() WHERE order_id=$1",
      [orderId]
    );
    const before = await ds.query(
      'SELECT id,"stockQuantity" FROM products ORDER BY id'
    );
    const results = await Promise.all([
      prepareRoleDemo(ds, { apply: true, replenish: true }),
      prepareRoleDemo(ds, { apply: true, replenish: true }),
    ]);
    expect(results.map((r) => r.createdFixtureIds.length).sort()).toEqual([
      0, 1,
    ]);
    expect(
      await ds.query('SELECT id,"stockQuantity" FROM products ORDER BY id')
    ).toEqual(before);
    expect(
      (await ds.query('SELECT status FROM orders WHERE id=$1', [orderId]))[0]
        .status
    ).toBe('completed');
    expect(
      await ds.query(
        'SELECT status,count(*)::int AS count FROM orders GROUP BY status ORDER BY status::text'
      )
    ).toEqual([
      { status: 'completed', count: 1 },
      { status: 'preparing', count: 3 },
      { status: 'shipped', count: 2 },
    ]);
  });
});
