import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { chromium } from 'playwright-core';

dotenv.config({
  path: fileURLToPath(new URL('../../backend/.env', import.meta.url)),
  quiet: true,
});
const api = process.env.TEST_API_URL || 'http://localhost:4000/v1';
const site = process.env.TEST_SITE_URL || 'http://localhost:3000';
const db = new pg.Client({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 4321),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});
let browser;
let checks = 0;
const accounts = [];
function pass(message) {
  console.log(`PASS ${message}`);
  checks++;
}
async function request(path, account, method = 'GET', body, expected = 200) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(account ? { Authorization: `Bearer ${account.accessToken}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: unexpected status ${response.status}`
  );
  return data;
}
async function demo(role) {
  const account = await request(
    '/auth/demo-login',
    null,
    'POST',
    role ? { role } : undefined,
    200
  );
  accounts.push(account);
  return account;
}
async function pageFor() {
  const context = await browser.newContext();
  if (api !== 'http://localhost:4000/v1')
    await context.route(
      (url) =>
        url.pathname.startsWith('/api/') ||
        (url.port === '4000' && url.pathname.startsWith('/v1/')),
      async (route) => {
        const url = new URL(route.request().url());
        const endpoint = url.pathname.startsWith('/api/')
          ? url.pathname.replace(/^\/api/, '')
          : url.pathname.replace(/^\/v1/, '');
        const response = await route.fetch({
          url: `${api}${endpoint}${url.search}`,
        });
        await route.fulfill({ response });
      }
    );
  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  return { page, context };
}
async function choose(page, label, path) {
  await page.goto(`${site}/login`);
  const button = page.getByRole('button', { name: new RegExp(`^${label}`) });
  await button.waitFor();
  // Wait for anonymous state to settle so initial hydration cannot mask a stale auth observer.
  await page.waitForTimeout(600);
  await button.click({ timeout: 30000 });
  await page.waitForURL(`${site}${path}`, { timeout: 30000 });
  await page.getByRole('complementary', { name: '체험 계정 안내' }).waitFor();
}
async function exit(page) {
  await page
    .getByRole('button', { name: '다른 역할 체험', exact: true })
    .click();
  await page.waitForURL(/\/login#demo-choice$/);
}

try {
  await db.connect();
  const options = await request('/auth/demo-options');
  assert.deepEqual(options, {
    enabled: true,
    roles: { buyer: true, seller: true, admin: true },
  });
  for (const body of [
    null,
    [],
    { role: ['buyer'] },
    { role: 'unknown' },
    { role: 'buyer', email: 'override@test.local' },
  ])
    await request('/auth/demo-login', null, 'POST', body, 400);
  const buyer = await demo('buyer');
  const seller = await demo('seller');
  const admin = await demo();
  assert.deepEqual(buyer.user.roles, ['buyer']);
  assert.deepEqual([...seller.user.roles].sort(), ['buyer', 'seller']);
  assert.deepEqual(admin.user.roles, ['admin']);
  assert(buyer.user.isDemo && seller.user.isDemo && admin.user.isDemo);
  pass(
    'role mapping, availability, malformed-body rejection and legacy no-body admin login'
  );

  const {
    rows: [fixture],
  } = await db.query(
    `SELECT o.id,o.order_number,oi.product_id FROM demo_fixtures f JOIN orders o ON o.id=f.order_id JOIN order_items oi ON oi.order_id=o.id WHERE f.scope='role-demo-v1' AND o.status='preparing' ORDER BY o.id LIMIT 1`
  );
  assert(fixture, 'Run demo:prepare --apply --replenish before verification.');
  for (const [path, method] of [
    ['/orders', 'POST'],
    [`/orders/${fixture.order_number}/cancel`, 'PATCH'],
    ['/payments/verify', 'POST'],
    [`/payments/${fixture.order_number}/cancel`, 'POST'],
    ['/seller/apply', 'POST'],
  ])
    await request(path, buyer, method, {}, 403);
  for (const [path, method] of [
    ['/products', 'POST'],
    [`/products/${fixture.product_id}`, 'PATCH'],
    [`/products/${fixture.product_id}/status`, 'PATCH'],
    [`/products/${fixture.product_id}`, 'DELETE'],
    [`/products/${fixture.product_id}/images`, 'POST'],
  ])
    await request(path, seller, method, {}, 403);
  await request(
    `/admin/payments/${fixture.order_number}/cancel`,
    admin,
    'POST',
    { reason: 'Demo verification' },
    403
  );
  const sellerOrders = await request('/seller/orders?take=100', seller);
  assert.equal(
    sellerOrders.data.find((o) => o.orderNumber === fixture.order_number)
      ?.canDemoChange,
    true
  );
  pass(
    'direct demo order, payment, seller application, product and upload writes are blocked'
  );

  browser = await chromium.launch({
    channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
    headless: true,
  });
  const { page, context } = await pageFor();
  await choose(page, '구매자 체험', '/my/orders');
  await page.goto(`${site}/my/orders/${fixture.order_number}`);
  assert.equal(
    await page
      .getByRole('button', { name: '결제 취소 / 환불', exact: true })
      .count(),
    0
  );
  await page
    .locator('button[aria-describedby="test-delivery-description"]')
    .click();
  await page.getByRole('button', { name: '구매 확정', exact: true }).click();
  await page.getByRole('button', { name: '리뷰 작성', exact: true }).waitFor();
  const order = await request(`/orders/${fixture.order_number}`, buyer);
  assert.equal(order.status, 'completed');
  const review = await request(
    '/reviews',
    buyer,
    'POST',
    {
      orderId: fixture.id,
      productId: fixture.product_id,
      rating: 5,
      comment: '[체험] 준비된 주문으로 배송과 구매 확정을 확인했습니다.',
    },
    201
  );
  await request(`/reviews/${review.id}`, buyer, 'PATCH', { rating: 4 }, 403);
  await request(`/reviews/${review.id}`, buyer, 'DELETE', undefined, 403);
  pass(
    'buyer UI performs test delivery and confirmation; review creation works and modification is blocked'
  );

  const inquiry = await request(
    '/inquiries',
    buyer,
    'POST',
    {
      productId: fixture.product_id,
      title: '[체험] 상품 안내 요청',
      content: '공용 구매자 체험에서 작성한 상품 문의입니다.',
      isSecret: true,
    },
    201
  );
  await request(`/inquiries/${inquiry.id}`, buyer, 'DELETE', undefined, 403);
  await exit(page);
  await choose(page, '셀러 체험', '/seller');
  const {
    rows: [toShip],
  } = await db.query(
    `SELECT o.order_number FROM demo_fixtures f JOIN orders o ON o.id=f.order_id WHERE f.scope='role-demo-v1' AND o.status='preparing' ORDER BY o.id LIMIT 1`
  );
  assert(
    toShip,
    'Replenish preparing orders before verifying seller shipment.'
  );
  await request(`/seller/orders/${toShip.order_number}/ship`, seller, 'PATCH', {
    carrier: '체험 택배',
    trackingNumber: 'ROLE-DEMO-TRACKING',
  });
  await request(
    `/seller/orders/${toShip.order_number}/deliver`,
    seller,
    'PATCH'
  );
  assert.equal(
    (await request(`/orders/${toShip.order_number}`, buyer)).status,
    'delivered'
  );
  pass(
    'demo seller can ship and deliver registered orders without a carrier integration'
  );
  await page.goto(`${site}/seller/products`);
  await page
    .getByText('체험 계정은 상품 등록이 제한됩니다', { exact: true })
    .waitFor();
  await page.goto(`${site}/seller/inquiries`);
  await page
    .getByRole('row')
    .filter({ hasText: '[체험] 상품 안내 요청' })
    .first()
    .waitFor();
  await request(`/seller/inquiries/${inquiry.id}/answer`, seller, 'PATCH', {
    answer: '[체험] 준비된 상품 문의에 대한 안내입니다.',
  });
  const mine = await request('/inquiries/my?take=100', buyer);
  assert.equal(mine.data.find((i) => i.id === inquiry.id).status, 'answered');
  const publicList = await request(
    `/inquiries/product/${fixture.product_id}?take=100`
  );
  assert.equal(publicList.data.find((i) => i.id === inquiry.id).content, '');
  pass(
    'seller UI shows safe product restrictions; shared buyer inquiry can be answered and secret content stays masked publicly'
  );

  const second = await context.newPage();
  await second.goto(`${site}/seller/orders`);
  await second.getByRole('complementary', { name: '체험 계정 안내' }).waitFor();
  await exit(page);
  await choose(page, '관리자 체험', '/admin/dashboard');
  await second.waitForFunction(() => {
    const token = sessionStorage.getItem('accessToken');
    if (!token) return false;
    try {
      return JSON.parse(atob(token.split('.')[1])).roles.includes('admin');
    } catch {
      return false;
    }
  });
  // A delayed response from the previous account has the old revision and cannot restore its token.
  await second.evaluate((token) => {
    const channel = new BroadcastChannel('auth-channel');
    channel.postMessage({
      type: 'TOKEN_RESPONSE',
      revision: 'obsolete-revision',
      requestId: 'obsolete-request',
      accessToken: token,
    });
    channel.close();
  }, buyer.accessToken);
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(atob(sessionStorage.getItem('accessToken').split('.')[1]))
          .roles[0]
    ),
    'admin'
  );
  await exit(page);
  pass(
    'role exit revokes the current session; role changes propagate to a second tab and old token responses cannot restore the buyer'
  );
  await context.close();
  console.log(
    `Verified ${checks} role-demo flows. Completed demo history is preserved; replenish samples with demo:prepare --apply --replenish.`
  );
} finally {
  for (const account of accounts)
    await request('/auth/logout', account, 'POST', undefined, 201).catch(
      () => undefined
    );
  if (browser) await browser.close();
  await db.end();
}
