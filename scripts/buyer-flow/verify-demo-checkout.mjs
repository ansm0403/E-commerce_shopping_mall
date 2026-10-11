import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const site = process.env.TEST_SITE_URL || 'http://localhost:3000';
const api = process.env.TEST_API_URL || 'http://localhost:4000/v1';
// Opening the external PG window is optional. No payment is approved by this script.
const openPG = process.env.DEMO_CHECKOUT_OPEN_PG === 'true';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext();
await context.route(
  (url) =>
    (url.origin === new URL(site).origin && url.pathname.startsWith('/api/')) ||
    ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      url.port === '4000' &&
      url.pathname.startsWith('/v1/')),
  async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace(/^\/(api|v1)/, '');
    await route.fulfill({
      response: await route.fetch({ url: `${api}${endpoint}${url.search}` }),
    });
  }
);
const page = await context.newPage();
page.setDefaultTimeout(45000);
let headers;
let orderNumber;
const externalHosts = new Set();
const failedHosts = [];
page.on('console', async (message) => {
  if (message.type() !== 'error' || !message.text().startsWith('[PortOne]'))
    return;
  const error = message.args()[1];
  const details = await error
    ?.evaluate((value) => ({
      name: value?.name,
      message: value?.message,
      code: value?.code,
    }))
    .catch(() => undefined);
  console.log('PortOne SDK error:', JSON.stringify(details));
});
context.on('response', async (response) => {
  const host = new URL(response.url()).hostname;
  if (!/portone|iamport/.test(host) || response.status() < 400) return;
  const data = await response.json().catch(() => ({}));
  console.log(
    'PortOne HTTP error:',
    JSON.stringify({
      host,
      status: response.status(),
      code: data.code,
      message: data.message,
    })
  );
});
page.on('dialog', async (dialog) => {
  console.log(`SDK/UI notice: ${dialog.message()}`);
  await dialog.dismiss();
});
context.on('requestfailed', (request) => {
  const host = new URL(request.url()).hostname;
  if (/portone|iamport|kakaopay|kakao\.com/.test(host))
    failedHosts.push(`${host}: ${request.failure()?.errorText}`);
});
context.on('request', (request) => {
  const host = new URL(request.url()).hostname;
  if (/portone|iamport|kakaopay|kakao\.com/.test(host)) externalHosts.add(host);
});
async function request(method, endpoint, data) {
  return context.request.fetch(`${api}${endpoint}`, { method, headers, data });
}

try {
  await page.goto(`${site}/login`);
  await page.getByRole('button', { name: /^구매자 체험/ }).waitFor();
  await page.waitForTimeout(600);
  const login = page.waitForResponse(
    (response) =>
      response.url().endsWith('/auth/demo-login') &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: /^구매자 체험/ }).click();
  const credentials = await (await login).json();
  headers = { Authorization: `Bearer ${credentials.accessToken}` };
  await page.waitForURL(`${site}/my/orders`);
  await page
    .getByRole('heading', { name: '이번 로그인에서 만든 테스트 주문' })
    .waitFor();
  const options = await (await request('GET', '/demo/checkout/options')).json();
  assert.equal(
    options.enabled,
    true,
    'Dedicated TEST channel must be configured'
  );
  const cart = await request('GET', '/cart');
  assert.equal(cart.status(), 200);
  assert.equal((await cart.json()).items.length, 0);
  const samples = await (await request('GET', '/orders?take=10')).json();
  const productId = samples.data
    .flatMap((order) => order.items)
    .find(
      (item) =>
        Number(item.productPrice) > 0 && Number(item.productPrice) < 100000
    )?.productId;
  assert(
    productId,
    'An approved demo sample under the payment cap is required'
  );
  const added = await request('POST', '/cart/items', {
    productId,
    quantity: 1,
  });
  assert.equal(added.status(), 201);
  await page.goto(`${site}/cart`);
  await page
    .getByRole('button', { name: '테스트 결제하기', exact: true })
    .click();
  await page.waitForURL(`${site}/checkout`);
  const pay = page.getByRole('button', {
    name: '테스트 결제하기',
    exact: true,
  });
  await pay.waitFor();
  assert.equal(await pay.isEnabled(), true);
  assert.equal(
    await page.getByLabel(/수령인/).inputValue(),
    options.shipping.recipientName
  );
  assert.equal(await page.getByLabel(/수령인/).getAttribute('readonly'), '');
  console.log(
    'PASS buyer login, isolated cart, checkout, fixed shipping and TEST settings'
  );

  if (openPG) {
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/demo/checkout/orders') &&
        response.request().method() === 'POST'
    );
    await pay.click();
    const response = await created;
    assert.equal(response.status(), 201);
    const order = await response.json();
    orderNumber = order.orderNumber;
    assert.equal(order.isDemoCheckout, true);
    const deadline = Date.now() + 30000;
    let pgWindow = false;
    while (Date.now() < deadline) {
      pgWindow =
        context
          .pages()
          .some(
            (tab) =>
              tab !== page && !tab.isClosed() && /^https:/.test(tab.url())
          ) ||
        page
          .frames()
          .some(
            (frame) =>
              frame !== page.mainFrame() &&
              /^https:/.test(frame.url()) &&
              /portone|iamport|kakao/.test(frame.url())
          );
      if (pgWindow) break;
      await page.waitForTimeout(500);
    }
    assert(
      pgWindow,
      `External TEST PG window did not open; contacted hosts: ${[
        ...externalHosts,
      ].join(', ')}; failures: ${failedHosts.join(', ')}`
    );
    // Let preparation finish, then validate the real server-to-PortOne lookup.
    // An unpaid TEST transaction must pass identity/channel checks and fail only PAID validation.
    await page.waitForTimeout(4000);
    const unpaid = await request(
      'POST',
      `/demo/checkout/orders/${orderNumber}/reconcile`
    );
    const unpaidResult = await unpaid.json();
    assert.equal(
      unpaid.status(),
      400,
      'The actual TEST transaction lookup must succeed'
    );
    assert.equal(
      unpaidResult.message,
      'PortOne에서 테스트 결제 완료를 확인하지 못했습니다.'
    );
    console.log(
      'PASS external PortOne TEST payment window opened; no approval attempted'
    );
    console.log(
      'PASS real PortOne payment lookup: matching TEST channel, store, currency and amount; still unpaid'
    );
    for (const tab of context.pages()) if (tab !== page) await tab.close();
  } else {
    const response = await request('POST', '/demo/checkout/orders', {
      requestId: crypto.randomUUID(),
    });
    assert.equal(response.status(), 201);
    orderNumber = (await response.json()).orderNumber;
  }
  const cancelled = await request(
    'PATCH',
    `/demo/checkout/orders/${orderNumber}/cancel`
  );
  assert.equal(cancelled.status(), 200);
  await page.goto(`${site}/my/orders/${orderNumber}`);
  await page
    .getByText('PortOne 테스트 결제 주문입니다.', { exact: false })
    .waitFor();
  await page.getByText('취소됨', { exact: true }).waitFor();
  await page.getByRole('link', { name: '장바구니로 다시 결제하기' }).click();
  await page.waitForURL(`${site}/checkout`);
  assert.equal(
    await page
      .getByRole('button', { name: '테스트 결제하기', exact: true })
      .isEnabled(),
    true
  );
  console.log(
    'PASS cancelled TEST order detail and checkout retry; cart retained'
  );
  const other = await request('POST', '/auth/demo-login', { role: 'buyer' });
  assert.equal(other.status(), 200);
  const otherCredentials = await other.json();
  const otherHeaders = {
    Authorization: `Bearer ${otherCredentials.accessToken}`,
  };
  const otherCart = await context.request.get(`${api}/cart`, {
    headers: otherHeaders,
  });
  assert.equal((await otherCart.json()).items.length, 0);
  const hidden = await context.request.get(
    `${api}/demo/checkout/orders/${orderNumber}`,
    { headers: otherHeaders }
  );
  assert.equal(hidden.status(), 404);
  console.log(
    'PASS independent visitor cannot see this cart or guessed TEST order'
  );
} finally {
  if (headers && orderNumber)
    await request('PATCH', `/demo/checkout/orders/${orderNumber}/cancel`).catch(
      () => undefined
    );
  await browser.close();
}
