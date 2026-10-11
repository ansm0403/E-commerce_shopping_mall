import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { connectionOptions } from '../database/connection-options';
import { prepareRoleDemo } from '../seed/prepare-role-demo';
import { DemoPolicyService } from './demo-policy.service';

describe('Role demos in existing PostgreSQL schema', () => {
  let ds: DataSource;
  const createdInquiryIds: number[] = [];
  const run = `ROLE-DEMO-VERIFY-${Date.now()}`;
  beforeAll(async () => {
    ds = await new DataSource({
      ...connectionOptions,
      entities: ['src/**/*.entity.ts'],
      synchronize: false,
    }).initialize();
  });
  afterAll(async () => {
    if (createdInquiryIds.length)
      await ds.query('DELETE FROM inquiries WHERE id=ANY($1::int[])', [
        createdInquiryIds,
      ]);
    await ds.destroy();
  });
  async function snapshot() {
    return ds.query(`SELECT (SELECT count(*) FROM users)::int AS users,
      (SELECT count(*) FROM orders)::int AS orders, (SELECT count(*) FROM inquiries)::int AS inquiries,
      (SELECT count(*) FROM demo_fixtures)::int AS fixtures, (SELECT count(*) FROM audit_logs)::int AS audit,
      (SELECT sum("stockQuantity") FROM products)::text AS stock`);
  }
  it('dry-run leaves data unchanged and applying twice concurrently creates no duplicates', async () => {
    const before = await snapshot();
    const plan = await prepareRoleDemo(ds, { apply: false });
    expect(plan.createBuyer).toBe(false);
    expect(plan.productIdsToMove).toEqual([]);
    expect(await snapshot()).toEqual(before);
    const results = await Promise.all([
      prepareRoleDemo(ds, { apply: true }),
      prepareRoleDemo(ds, { apply: true }),
    ]);
    expect(
      results.every(
        (r) => 'createdFixtureIds' in r && r.createdFixtureIds.length === 0
      )
    ).toBe(true);
    expect(await snapshot()).toEqual(before);
  });
  it('synthetic payments, order items and shipments match the demo accounts', async () => {
    const [result] = await ds.query(
      `SELECT count(*)::int AS total FROM demo_fixtures f JOIN orders o ON o.id=f.order_id
      JOIN users u ON u.id=o.user_id JOIN payments p ON p.order_id=o.id JOIN order_items oi ON oi.order_id=o.id
      JOIN shipments sh ON sh.order_id=o.id AND sh.seller_id=oi.seller_id JOIN sellers s ON s.id=sh.seller_id
      JOIN users su ON su.id=s.user_id WHERE f.scope='role-demo-v1' AND u.email=$1 AND su.email=$2
      AND p.status='paid' AND p.imp_uid IS NULL AND p.receipt_url IS NULL AND p.amount=o.total_amount AND oi.subtotal=o.total_amount`,
      [process.env.DEMO_BUYER_EMAIL, process.env.DEMO_SELLER_EMAIL]
    );
    expect(result.total).toBeGreaterThanOrEqual(5);
  });
  it('registered order deletion is rejected by the database', async () => {
    const [{ order_id }] = await ds.query(
      'SELECT order_id FROM demo_fixtures WHERE order_id IS NOT NULL LIMIT 1'
    );
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await expect(
        runner.query('DELETE FROM orders WHERE id=$1', [order_id])
      ).rejects.toMatchObject({ driverError: { code: '23001' } });
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
  it('ordinary administrators cannot financially process registered synthetic orders', async () => {
    const [{ order_id }] = await ds.query(
      'SELECT order_id FROM demo_fixtures WHERE order_id IS NOT NULL LIMIT 1'
    );
    await expect(
      new DemoPolicyService(ds).forbidFixtureOrder(order_id)
    ).rejects.toMatchObject({ status: 403 });
  });
  it('concurrent demo inquiries respect the shared waiting limit', async () => {
    const [{ id: userId }] = await ds.query(
      'SELECT id FROM users WHERE email=$1',
      [process.env.DEMO_BUYER_EMAIL]
    );
    const [{ id: productId }] = await ds.query(
      'SELECT id FROM products WHERE seed_key IS NOT NULL LIMIT 1'
    );
    const [{ count: before }] = await ds.query(
      "SELECT count(*)::int AS count FROM inquiries WHERE user_id=$1 AND status='waiting'",
      [userId]
    );
    const policy = new DemoPolicyService(ds);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        policy.createDemoInquiry(userId, {
          productId,
          title: run,
          content: `Concurrency ${i}`,
          isSecret: false,
        })
      )
    );
    for (const r of results)
      if (r.status === 'fulfilled' && r.value)
        createdInquiryIds.push(r.value.id);
    expect(createdInquiryIds.length).toBe(10 - before);
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .every((r) => r.status === 'rejected' && r.reason.status === 429)
    ).toBe(true);
    const [{ count }] = await ds.query(
      "SELECT count(*)::int AS count FROM inquiries WHERE user_id=$1 AND status='waiting'",
      [userId]
    );
    expect(count).toBe(10);
  });
});
