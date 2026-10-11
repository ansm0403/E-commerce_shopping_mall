import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { connectionOptions } from '../database/connection-options';
import { mockProductCatalog } from '../common/seeds/mock-product-catalog';
import { LegacyProduct, planMockOwnership } from './demo-ownership-plan';

/** Explicit batch only. Default is read-only; --apply enables the reviewed repair. */
async function main() {
  const apply = process.argv.includes('--apply');
  const ds = await new DataSource(connectionOptions).initialize();
  try {
    const report = await ds.transaction(async (manager) => {
      const [seller] = await manager.query(
        `SELECT s.id, u.email FROM sellers s JOIN users u ON u.id = s.user_id
         WHERE u.email = $1 AND u.is_demo=false AND s.status = 'approved'
           AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                       WHERE ur.user_id = u.id AND r.name = 'seller')`,
        [process.env.TEST_SELLER_EMAIL || 'seller1@seed.com'],
      );
      if (!seller) throw new Error('Approved test seller not found. Check TEST_SELLER_EMAIL.');
      // Lock catalog rows during apply so seller changes cannot race with orders.
      const products: LegacyProduct[] = await manager.query(
        `SELECT p.id, p.name, p.brand, p.description, p.seller_id AS "sellerId", p.seed_key AS "seedKey",
          ARRAY(SELECT url FROM product_images WHERE "productId" = p.id) AS urls
         FROM products p ORDER BY p.id ${apply ? 'FOR UPDATE OF p' : ''}`,
      );
      const plan = planMockOwnership(products, mockProductCatalog, seller.id);
      if (plan.ambiguous.length) throw new Error(`Ambiguous mock fixtures: ${plan.ambiguous.join(', ')}`);
      const orderItems = await manager.query(
        `SELECT i.id, i.order_id, o.order_number, o.status, i.product_id
         FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE i.product_id = ANY($1::int[]) AND i.seller_id IS NULL
           AND o.status IN ('pending_payment', 'preparing') ORDER BY i.id`,
        [plan.matchedIds],
      );
      const inquiries = await manager.query(
        `SELECT q.id FROM inquiries q JOIN users u ON u.id = q.user_id
         WHERE q.product_id = ANY($1::int[]) AND q.seller_id != $2
           AND u.email ~ '^user[0-9]+@seed[.]com$' ORDER BY q.id`,
        [plan.matchedIds, seller.id],
      );
      const uncertainOrders = await manager.query(
        `SELECT DISTINCT o.id, o.order_number, o.status FROM orders o JOIN order_items i ON i.order_id = o.id
         WHERE i.product_id = ANY($1::int[]) AND i.seller_id IS NULL AND o.status IN ('paid', 'shipped', 'delivered')`,
        [plan.matchedIds],
      );
      const shipmentsCreated: number[] = [];
      const skippedOrders: number[] = [];
      if (apply) {
        for (const product of plan.updates) {
          await manager.query('UPDATE products SET seller_id = $1, seed_key = $2, "updatedAt" = now() WHERE id = $3',
            [product.sellerId, product.seedKey, product.id]);
        }
        for (const orderId of [...new Set<number>(orderItems.map((i: { order_id: number }) => i.order_id))].sort((a, b) => a - b)) {
          const [order] = await manager.query('SELECT id, status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
          if (!['pending_payment', 'preparing'].includes(order.status)) { skippedOrders.push(orderId); continue; }
          if (order.status === 'preparing') {
            const [payment] = await manager.query("SELECT id FROM payments WHERE order_id = $1 AND status = 'paid'", [orderId]);
            if (!payment) { skippedOrders.push(orderId); continue; }
          }
          await manager.query(
            `UPDATE order_items SET seller_id = $1, "updatedAt" = now()
             WHERE order_id = $2 AND seller_id IS NULL AND product_id = ANY($3::int[])`,
            [seller.id, orderId, plan.matchedIds],
          );
          if (order.status === 'preparing') {
            const created = await manager.query(
              `INSERT INTO shipments (order_id, seller_id, status)
               SELECT DISTINCT order_id, seller_id, 'preparing'::shipments_status_enum FROM order_items
               WHERE order_id = $1 AND seller_id IS NOT NULL
               ON CONFLICT (order_id, seller_id) DO NOTHING RETURNING id`, [orderId],
            );
            shipmentsCreated.push(...created.map((s: { id: number }) => s.id));
          }
        }
        if (inquiries.length) {
          await manager.query('UPDATE inquiries SET seller_id = $1, "updatedAt" = now() WHERE id = ANY($2::int[])',
            [seller.id, inquiries.map((q: { id: number }) => q.id)]);
        }
        if (plan.updates.length || orderItems.length || inquiries.length) {
          await manager.query(
            'INSERT INTO audit_logs (action, "ipAddress", metadata) VALUES ($1, $2, $3::json)',
            ['DEMO_DATA_REPAIRED', 'system', JSON.stringify({
              productIds: plan.updates.map((p) => p.id), orderItemIds: orderItems.map((i: { id: number }) => i.id),
              inquiryIds: inquiries.map((q: { id: number }) => q.id), shipmentsCreated, skippedOrders,
            })],
          );
        }
      }
      return { apply, seller, products: plan.updates, matchedProductIds: plan.matchedIds,
        orderItems, inquiryIds: inquiries.map((q: { id: number }) => q.id), uncertainOrders, skippedOrders, shipmentsCreated };
    });
    console.log(JSON.stringify({ ...report,
      products: { count: report.products.length, ids: report.products.map((p) => p.id) },
      matchedProductIds: { count: report.matchedProductIds.length },
    }));
    if (apply && report.matchedProductIds.length) {
      const redis = new Redis({ host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379),
        password: process.env.REDIS_PASSWORD, db: Number(process.env.REDIS_DB || 0),
        lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 1 });
      redis.on('error', () => undefined);
      try {
        await redis.connect();
        await redis.del(...report.matchedProductIds.map((id) => `products:detail:${id}`));
      } finally { redis.disconnect(); }
    }
  } finally { await ds.destroy(); }
}

main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
