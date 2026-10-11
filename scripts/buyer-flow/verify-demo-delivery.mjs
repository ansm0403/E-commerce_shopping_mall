import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';
import { chromium } from 'playwright-core';

dotenv.config({ path: fileURLToPath(new URL('../../backend/.env', import.meta.url)), quiet: true });
const api = process.env.TEST_API_URL || 'http://localhost:4000/v1';
const site = process.env.TEST_SITE_URL || 'http://localhost:3000';
const db = new pg.Client({ host: process.env.POSTGRES_HOST || 'localhost', port: Number(process.env.POSTGRES_PORT || 4321),
  user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB });
const password = process.env.TEST_ACCOUNT_PASSWORD || 'Seed1234!';
const runId = `TEST-DELIVERY-${Date.now()}`;
const orderIds = [];
const productIds = [];
const reservedProducts = [];
let reviewId;
let inquiryId;
let buyer;
let browser;
let checks = 0;

async function request(path, account, method = 'GET', body, expected = 200) {
  const response = await fetch(`${api}${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(account ? { Authorization: `Bearer ${account.accessToken}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function login(email) {
  let response;
  for (let attempt = 0; attempt < 11; attempt++) {
    response = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (response.status !== 429) break;
    console.log('Waiting for the normal login rate-limit window.');
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  assert.equal(response.status, 201, `Login failed for test account ${email}`);
  const account = await response.json();
  account.refreshToken = /refreshToken=([^;]+)/.exec(response.headers.get('set-cookie') || '')?.[1];
  return account;
}

async function contextFor(account) {
  const context = await browser.newContext();
  if (api !== 'http://localhost:4000/v1') {
    // An isolated verification server can be used without changing the user's dev proxy or stopping their server.
    await context.route((url) => url.pathname.startsWith('/api/') || (url.port === '4000' && url.pathname.startsWith('/v1/')), async (route) => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.startsWith('/api/')
        ? url.pathname.replace(/^\/api/, '')
        : url.pathname.replace(/^\/v1/, '');
      const response = await route.fetch({ url: `${api}${endpoint}${url.search}` });
      await route.fulfill({ response });
    });
  }
  await context.addInitScript((token) => sessionStorage.setItem('accessToken', token), account.accessToken);
  if (account.refreshToken) {
    await context.addCookies([{ name: 'refreshToken', value: account.refreshToken, url: site, httpOnly: true }]);
  }
  return context;
}

async function waitOrderStatus(number, status) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const order = await request(`/orders/${number}`, buyer);
    if (order.status === status) return order;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Order did not become ${status}`);
}

async function fixture(number, userId, products, sellers) {
  const { rows: [order] } = await db.query(
    `INSERT INTO orders (order_number,user_id,status,total_amount,shipping_address,recipient_name,recipient_phone,memo,paid_at)
     VALUES ($1::text,$2,'preparing',$3,'TEST','TEST','010-0000-0000',$1::text,now()) RETURNING id,order_number`,
    [number, userId, products.length * 1000],
  );
  orderIds.push(order.id);
  // Some dashboard seeds are dated later today; keep this fixture on the first UI page.
  await db.query(`UPDATE orders SET "createdAt"=(SELECT GREATEST(now(),MAX("createdAt")) + interval '1 second'
    FROM orders WHERE user_id=$2) WHERE id=$1`, [order.id, userId]);
  await db.query("INSERT INTO payments (order_id,merchant_uid,amount,status,paid_at) VALUES ($1,$2,$3,'paid',now())", [order.id, number, products.length * 1000]);
  for (let i = 0; i < products.length; i++) {
    await db.query(`INSERT INTO order_items (order_id,product_id,seller_id,product_name,product_price,quantity,subtotal)
      VALUES ($1,$2,$3,'TEST product',1000,1,1000)`, [order.id, products[i], sellers[i]]);
    await db.query("INSERT INTO shipments (order_id,seller_id,status) VALUES ($1,$2,'preparing') ON CONFLICT DO NOTHING", [order.id, sellers[i]]);
  }
  return order;
}

function pass(message) { checks++; console.log(`PASS ${message}`); }

try {
  await db.connect();
  buyer = await login(process.env.TEST_BUYER_EMAIL || 'user20@seed.com');
  const seller = await login(process.env.TEST_SELLER_EMAIL || 'seller1@seed.com');
  const seller2 = await login('seller2@seed.com');
  const outsider = await login('user19@seed.com');
  const { rows: sellers } = await db.query('SELECT id,user_id FROM sellers WHERE user_id = ANY($1::int[])', [[seller.user.id, seller2.user.id]]);
  const sellerId = sellers.find((s) => s.user_id === seller.user.id).id;
  const seller2Id = sellers.find((s) => s.user_id === seller2.user.id).id;
  const product = await request('/products/253');
  assert.equal(product.sellerId, sellerId);
  pass('mock product belongs to the configured test seller');

  // Exercise the real cart/order APIs; only PG verification is replaced by a paid fixture.
  // This script never calls a payment provider or completes another user's existing order.
  const cart = await request('/cart', buyer);
  assert(!cart.items.some((i) => i.productId === product.id), 'Test buyer already has this product in cart; choose a fresh test account.');
  const added = await request('/cart/items', buyer, 'POST', { productId: product.id, quantity: 1 }, 201);
  const cartItem = added.items.find((i) => i.productId === product.id);
  const order = await request('/orders', buyer, 'POST', { cartItemIds: [cartItem.id], shippingAddress: 'TEST',
    recipientName: 'TEST', recipientPhone: '010-0000-0000', memo: runId }, 201);
  orderIds.push(order.id); reservedProducts.push(product.id);
  assert.equal(order.items[0].sellerId, sellerId);
  pass('new purchase snapshots the mock product seller');
  await request(`/orders/${order.orderNumber}/test-deliver`, null, 'PATCH', undefined, 401);
  await request(`/seller/orders/${order.orderNumber}/deliver`, buyer, 'PATCH', undefined, 403);
  await request(`/orders/${runId}-missing/test-deliver`, buyer, 'PATCH', undefined, 404);
  await request(`/orders/${order.orderNumber}/test-deliver`, buyer, 'PATCH', undefined, 403);
  assert.equal((await request(`/orders/${order.orderNumber}`, buyer)).canTestDeliver, false);
  await db.query("UPDATE payments SET status='paid',paid_at=now() WHERE order_id=$1", [order.id]);
  await db.query("UPDATE orders SET status='preparing',paid_at=now() WHERE id=$1", [order.id]);
  await db.query("INSERT INTO shipments (order_id,seller_id,status) VALUES ($1,$2,'preparing')", [order.id, sellerId]);
  await request(`/seller/orders/${order.orderNumber}/deliver`, seller, 'PATCH', undefined, 400);
  await request(`/orders/${order.orderNumber}/test-deliver`, outsider, 'PATCH', undefined, 403);
  await request(`/seller/orders/${order.orderNumber}/deliver`, seller2, 'PATCH', undefined, 403);
  pass('unpaid orders, seller pre-shipment completion and other users are rejected');

  const preparing = await request(`/orders/${order.orderNumber}`, buyer);
  assert.equal(preparing.status, 'preparing');
  assert.equal(preparing.canTestDeliver, false);
  await request(`/orders/${order.orderNumber}/confirm`, buyer, 'PATCH', undefined, 400);
  await request('/reviews', buyer, 'POST', { orderId: order.id, productId: product.id, rating: 5, comment: runId }, 400);
  pass('anonymous access, wrong roles, missing orders and review before confirmation are blocked');
  browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
  const buyerContext = await contextFor(buyer);
  const buyerPage = await buyerContext.newPage();
  buyerPage.on('dialog', (dialog) => dialog.accept());
  await buyerPage.goto(`${site}/my/orders/${order.orderNumber}`);
  const testDeliveryButton = buyerPage.locator('button[aria-describedby="test-delivery-description"]');
  await buyerPage.getByRole('heading', { name: '주문 상품', exact: true }).waitFor();
  assert.equal(await testDeliveryButton.count(), 0);
  await request(`/orders/${order.orderNumber}/test-deliver`, buyer, 'PATCH', undefined, 403);
  pass('ordinary buyers never see or invoke fixture-only test delivery');
  await request(`/seller/orders/${order.orderNumber}/ship`, seller, 'PATCH', { carrier: 'TEST', trackingNumber: 'TEST-123' });
  await request(`/seller/orders/${order.orderNumber}/deliver`, seller, 'PATCH');
  await waitOrderStatus(order.orderNumber, 'delivered');
  await request('/reviews', buyer, 'POST', { orderId: order.id, productId: product.id, rating: 5, comment: runId }, 400);
  await request(`/orders/${order.orderNumber}/confirm`, outsider, 'PATCH', undefined, 403);
  await buyerPage.reload();
  await buyerPage.getByRole('button', { name: '구매 확정', exact: true }).click();
  await waitOrderStatus(order.orderNumber, 'completed');
  await buyerPage.getByRole('button', { name: '리뷰 작성', exact: true }).waitFor();
  pass('ordinary seller delivery enables buyer confirmation and review');
  const review = await request('/reviews', buyer, 'POST', { orderId: order.id, productId: product.id, rating: 5, comment: runId }, 201);
  reviewId = review.id;
  await request('/reviews', buyer, 'POST', { orderId: order.id, productId: product.id, rating: 5, comment: runId }, 400);
  pass('review submission works and duplicate review is rejected');
  await request('/reviews', outsider, 'POST', { orderId: order.id, productId: product.id, rating: 5, comment: runId }, 404);
  await request('/reviews', buyer, 'POST', { orderId: order.id, productId: 254, rating: 5, comment: runId }, 400);
  await request('/reviews', buyer, 'POST', { orderId: order.id, productId: product.id, rating: 6, comment: runId }, 400);
  const completedBefore = await request(`/orders/${order.orderNumber}`, buyer);
  await request(`/orders/${order.orderNumber}/test-deliver`, buyer, 'PATCH', undefined, 403);
  const completedAfter = await request(`/orders/${order.orderNumber}`, buyer);
  assert.equal(completedAfter.status, 'completed');
  assert.equal(completedAfter.deliveredAt, completedBefore.deliveredAt);
  assert.deepEqual(completedAfter.shipments.map((s) => s.deliveredAt), completedBefore.shipments.map((s) => s.deliveredAt));
  pass('review ownership, product/rating validation and delivery retries after confirmation');

  const inquiry = await request('/inquiries', buyer, 'POST', { productId: product.id, title: runId, content: 'Test inquiry', isSecret: true }, 201);
  inquiryId = inquiry.id;
  const inbox = await request('/seller/inquiries?page=1&take=100', seller);
  assert(inbox.data.some((q) => q.id === inquiryId));
  await request(`/seller/inquiries/${inquiryId}/answer`, seller2, 'PATCH', { answer: 'Wrong seller' }, 403);
  await request(`/seller/inquiries/${inquiryId}/answer`, seller, 'PATCH', { answer: 'Test answer' });
  await request(`/seller/inquiries/${inquiryId}/answer`, seller, 'PATCH', { answer: 'Overwrite' }, 400);
  await request(`/inquiries/${inquiryId}`, buyer, 'DELETE', undefined, 400);
  const myInquiries = await request('/inquiries/my?take=100', buyer);
  assert.equal(myInquiries.data.find((q) => q.id === inquiryId).answer, 'Test answer');
  const publicInquiries = await request(`/inquiries/product/${product.id}?take=100`);
  assert.equal(publicInquiries.data.find((q) => q.id === inquiryId).content, '');
  const otherInquiries = await request(`/inquiries/product/${product.id}?take=100`, outsider);
  assert.equal(otherInquiries.data.find((q) => q.id === inquiryId).answer, null);
  const authorInquiries = await request(`/inquiries/product/${product.id}?take=100`, buyer);
  assert.equal(authorInquiries.data.find((q) => q.id === inquiryId).answer, 'Test answer');
  pass('mock inquiry, seller reply, buyer view and secret masking');

  const { rows: [otherProduct] } = await db.query(`INSERT INTO products
    (name,description,price,brand,"stockQuantity",status,approval_status,"isEvent",seller_id)
    VALUES ($1,'Temporary verification fixture',1000,'TEST',10,'hidden','approved',false,$2) RETURNING id`, [runId, seller2Id]);
  productIds.push(otherProduct.id);
  // No image and duplicate names: product IDs, not names or image URLs, must define link targets.
  const multi = await fixture(`${runId}-MULTI`, buyer.user.id, [product.id, otherProduct.id], [sellerId, seller2Id]);
  await request(`/seller/orders/${multi.order_number}/ship`, seller, 'PATCH', { carrier: 'TEST', trackingNumber: 'TEST-456' });
  const shipped = await request('/seller/orders?status=shipped&take=100', seller);
  assert(shipped.data.some((o) => o.orderNumber === multi.order_number && o.status === 'preparing'));
  const sellerContext = await contextFor(seller);
  const sellerPage = await sellerContext.newPage();
  sellerPage.on('dialog', (dialog) => dialog.accept());
  await sellerPage.goto(`${site}/seller/orders?status=shipped`);
  const row = sellerPage.locator('tr').filter({ hasText: multi.order_number });
  await row.getByRole('button', { name: '배송 완료 처리하기', exact: true }).click({ timeout: 60000 });
  await row.waitFor({ state: 'detached' });
  const partial = await request(`/orders/${multi.order_number}`, buyer);
  assert.equal(partial.status, 'preparing');
  assert.equal(partial.shipments.find((s) => s.sellerId === seller2Id).status, 'preparing');
  await buyerPage.goto(`${site}/my/orders/${multi.order_number}`);
  await buyerPage.getByRole('heading', { name: '주문 상품', exact: true }).waitFor();
  assert.equal(await buyerPage.getByRole('button', { name: '결제 취소 / 환불', exact: true }).count(), 0);
  const itemSection = buyerPage.locator('section').filter({ has: buyerPage.getByRole('heading', { name: '주문 상품', exact: true }) });
  assert.equal(await itemSection.locator('a[href^="/products/"]').count(), 2);
  const imageLessLink = itemSection.locator(`a[href="/products/${otherProduct.id}"]`);
  assert.equal(await imageLessLink.locator('img').count(), 0);
  await imageLessLink.click();
  await buyerPage.waitForURL(`${site}/products/${otherProduct.id}`);
  await buyerPage.goto(`${site}/my/orders`);
  const orderCard = buyerPage.locator('article').filter({ hasText: multi.order_number });
  const productLink = orderCard.locator('a[href^="/products/"]');
  await productLink.waitFor({ timeout: 60000 });
  const listedProductPath = await productLink.getAttribute('href');
  assert([`/products/${product.id}`, `/products/${otherProduct.id}`].includes(listedProductPath));
  await productLink.locator('p').first().click();
  await buyerPage.waitForURL(`${site}${listedProductPath}`);
  await buyerPage.goto(`${site}/my/orders`);
  await orderCard.getByRole('link', { name: '주문 상세', exact: true }).click();
  await buyerPage.waitForURL(`${site}/my/orders/${multi.order_number}`);
  await buyerPage.setViewportSize({ width: 390, height: 844 });
  const mobileItem = itemSection.locator(`a[href="/products/${product.id}"]`);
  await mobileItem.waitFor();
  const bounds = await mobileItem.boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await buyerPage.setViewportSize({ width: 1280, height: 720 });
  pass('multi-item and imageless product links preserve product IDs and order detail access');
  pass('seller UI lists partial shipments and completes only its own shipment');
  await request(`/seller/orders/${multi.order_number}/ship`, seller2, 'PATCH', { carrier: 'TEST', trackingNumber: 'TEST-789' });
  // Concurrent retries must produce a single final transition.
  await Promise.all([
    request(`/seller/orders/${multi.order_number}/deliver`, seller2, 'PATCH'),
    request(`/seller/orders/${multi.order_number}/deliver`, seller2, 'PATCH'),
  ]);
  const delivered = await request(`/orders/${multi.order_number}`, buyer);
  assert.equal(delivered.status, 'delivered');
  assert(delivered.shipments.every((s) => s.status === 'delivered'));
  const confirmations = await Promise.all([
    fetch(`${api}/orders/${multi.order_number}/confirm`, { method: 'PATCH', headers: { Authorization: `Bearer ${buyer.accessToken}` } }),
    fetch(`${api}/orders/${multi.order_number}/confirm`, { method: 'PATCH', headers: { Authorization: `Bearer ${buyer.accessToken}` } }),
  ]);
  assert.deepEqual(confirmations.map((r) => r.status).sort(), [200, 400]);
  pass('concurrent delivery and confirmation preserve final states');

  const reviewOutcomes = await Promise.all(Array.from({ length: 6 }, async () => {
    const response = await fetch(`${api}/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyer.accessToken}` },
      body: JSON.stringify({ orderId: multi.id, productId: product.id, rating: 5, comment: `${runId}-race` }) });
    return { status: response.status, data: await response.json() };
  }));
  const successfulReviews = reviewOutcomes.filter((r) => r.status === 201);
  assert.equal(successfulReviews.length, 1);
  assert.equal(reviewOutcomes.filter((r) => r.status === 400).length, 5);
  await request(`/reviews/${successfulReviews[0].data.id}`, buyer, 'DELETE');
  pass('six concurrent review requests create one review and return five duplicate errors');

  const answerRace = await request('/inquiries', buyer, 'POST', { productId: product.id, title: runId, content: 'Concurrent inquiry' }, 201);
  const replyOutcomes = await Promise.all(['First candidate', 'Second candidate'].map(async (answer) => {
    const response = await fetch(`${api}/seller/inquiries/${answerRace.id}/answer`, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller.accessToken}` }, body: JSON.stringify({ answer }) });
    return response.status;
  }));
  assert.deepEqual(replyOutcomes.sort(), [200, 400]);
  await db.query('DELETE FROM inquiries WHERE id=$1 AND title=$2', [answerRace.id, runId]);
  pass('concurrent replies save only one answer');

  const invalid = await fixture(`${runId}-INVALID`, buyer.user.id, [product.id], [sellerId]);
  await db.query("UPDATE orders SET status='cancelled' WHERE id=$1", [invalid.id]);
  await request(`/orders/${invalid.order_number}/test-deliver`, buyer, 'PATCH', undefined, 403);
  assert.equal((await request(`/orders/${invalid.order_number}`, buyer)).canTestDeliver, false);
  await db.query("UPDATE orders SET status='preparing' WHERE id=$1", [invalid.id]);
  await db.query('DELETE FROM shipments WHERE order_id=$1', [invalid.id]);
  await request(`/orders/${invalid.order_number}/test-deliver`, buyer, 'PATCH', undefined, 403);
  assert.equal((await request(`/orders/${invalid.order_number}`, buyer)).canTestDeliver, false);
  pass('cancelled and missing-shipment orders do not expose the test button or complete');
  console.log(`Verified ${checks} integration checks.`);
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  // Clean up successful concurrent inserts even if a later assertion fails.
  if (buyer && orderIds.length) {
    const { rows: reviews } = await db.query('SELECT id FROM reviews WHERE order_id=ANY($1::int[]) AND comment=ANY($2::text[])', [orderIds, [runId, `${runId}-race`]]);
    for (const review of reviews) await request(`/reviews/${review.id}`, buyer, 'DELETE');
  }
  // Answered inquiries deliberately cannot be deleted via the buyer API.
  if (buyer) await db.query('DELETE FROM inquiries WHERE user_id=$1 AND title=$2', [buyer.user.id, runId]);
  // Wait for async review/settlement listeners before removing only this run's fixtures.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (orderIds.length) {
    await db.query('DELETE FROM settlements WHERE order_id = ANY($1::int[])', [orderIds]);
    await db.query('DELETE FROM payments WHERE order_id = ANY($1::int[])', [orderIds]);
    await db.query('DELETE FROM orders WHERE id = ANY($1::int[])', [orderIds]);
  }
  for (const id of reservedProducts) await db.query('UPDATE products SET "stockQuantity" = "stockQuantity" + 1 WHERE id = $1', [id]);
  if (productIds.length) await db.query('DELETE FROM products WHERE id = ANY($1::int[])', [productIds]);
  await db.end();
}
