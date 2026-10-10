#!/usr/bin/env node
/**
 * UI 개편 공개 화면 확인. DB·계정·장바구니를 수정하지 않는다.
 * 운영 빌드(next start) 실행 뒤:
 * node scripts/design/verify-refresh.mjs --base http://localhost:3100 --out tmp/refresh-design
 * 상품·카테고리는 연결된 API에서 받고 반복 GET 응답만 메모리에 보관한다.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const args = { base: 'http://localhost:3100', out: 'tmp/refresh-design' };
for (let i = 2; i < process.argv.length; i += 2)
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
mkdirSync(args.out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const apiCache = new Map();
const results = [];

async function checkOverflow(page, name, viewport) {
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(
    dimensions.scroll <= dimensions.width + 1,
    `${name} ${viewport}: horizontal overflow ${JSON.stringify(dimensions)}`
  );
}

async function capture(page, filename) {
  // fullPage 캡처만으로는 화면 아래 lazy 이미지가 로드되지 않는다.
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    for (
      let y = 0;
      y < document.documentElement.scrollHeight;
      y += window.innerHeight
    ) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    await Promise.all(
      [...document.images].map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
              setTimeout(resolve, 4000);
            })
      )
    );
    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForFunction(() => [...document.images].filter((img) => !img.closest('[aria-hidden="true"]')).every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 15000 });
  await page.screenshot({
    path: join(args.out, filename),
    fullPage: true,
    animations: 'disabled',
  });
  // fullPage 촬영이 뷰포트를 복원한 뒤에도 다음 촬영은 반드시 맨 위에서 한다.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

try {
  for (const [label, width] of [
    ['desktop', 1440],
    ['mobile', 390],
    ['small-mobile', 320],
  ]) {
    console.log(`Checking ${label} (${width}px)`);
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      locale: 'ko-KR',
      reducedMotion: 'reduce',
    });
    await context.addInitScript(() =>
      sessionStorage.setItem('shopping-mall-splash-shown', '1')
    );
    await context.route(/\/monitoring(\?|$)|sentry\.io/, (route) =>
      route.abort()
    );
    // Bound unavailable external photo hosts; exercise the real image-error fallback.
    // Hidden carousel slides remain lazy and are checked by verify-banner separately.
    await context.route('https://**/*', async (route) => {
      if (route.request().resourceType() !== 'image') return route.fallback();
      try { await route.fulfill({ response: await route.fetch({ timeout: 8000 }) }); }
      catch { await route.abort(); }
    });
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      if (request.method() !== 'GET') return route.abort();
      const url = request.url();
      if (!apiCache.has(url)) {
        const response = await route.fetch();
        apiCache.set(url, {
          status: response.status(),
          contentType: response.headers()['content-type'] || 'application/json',
          body: await response.body(),
        });
      }
      await route.fulfill(apiCache.get(url));
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(args.base, { waitUntil: 'networkidle', timeout: 60000 });
    await page.getByRole('heading', { name: '지금 많이 찾는 상품' }).waitFor();
    const firstProduct = page.locator('a[href^="/products/"]').first();
    await firstProduct.waitFor();
    const detailPath = await firstProduct.getAttribute('href');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto', 'Reduced motion must disable smooth scrolling');
    const categoryButton = page.getByRole('button', {
      name: '카테고리',
      exact: true,
    });
    await categoryButton.focus();
    await categoryButton.press('Enter');
    const categoryMenu = page.getByRole('navigation', {
      name: '전체 카테고리',
      exact: true,
    });
    // 메뉴의 링크들이 absolute 배치라 nav 자체 높이는 0이다. 실제 링크의 표시를 확인한다.
    await categoryMenu.getByRole('link', { name: /^의류/ }).waitFor();
    await categoryMenu.getByRole('link', { name: /^의류/ }).focus();
    await categoryMenu
      .getByRole('link', { name: '겨울', exact: true })
      .waitFor();
    await checkOverflow(page, 'category-menu', label);
    await page.keyboard.press('Escape');
    assert.equal(await categoryButton.getAttribute('aria-expanded'), 'false');
    assert.ok(
      await categoryButton.evaluate(
        (element) => element === document.activeElement
      )
    );
    await page.getByRole('heading', { name: '지금 많이 찾는 상품' }).click();
    await checkOverflow(page, 'home', label);
    await capture(page, `${label}-home.png`);
    await page.screenshot({
      path: join(args.out, `${label}-home-top.png`),
      animations: 'disabled',
    });
    const imageUrl = await firstProduct
      .locator('img')
      .first()
      .getAttribute('src');
    const brokenImage = (route) =>
      route.fulfill({ status: 404, body: 'Preview image failure' });
    await context.route(imageUrl, brokenImage);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('a[href^="/products/"]').first().scrollIntoViewIfNeeded();
    await page.locator('img[src="/images/placeholder.svg"]').first().waitFor();
    await context.unroute(imageUrl, brokenImage);

    await page.goto(`${args.base}/products`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '취향을 발견하는 시간' }).waitFor();
    assert.ok(
      (await page.locator('a[href^="/products/"]').count()) > 0,
      'Product grid is empty'
    );
    if (width < 640)
      await page.getByLabel('상품 정렬', { exact: true }).selectOption('3');
    else
      await page
        .getByRole('button', { name: '낮은 가격순', exact: true })
        .click();
    await page.waitForURL(
      (url) =>
        url.searchParams.get('sortBy') === 'price' &&
        url.searchParams.get('sortOrder') === 'ASC'
    );
    await page.waitForLoadState('networkidle');
    await checkOverflow(page, 'products', label);
    await capture(page, `${label}-products.png`);

    await page.getByRole('button', { name: '의류', exact: true }).click();
    const subcategories = page.getByLabel('의류 세부 카테고리', {
      exact: true,
    });
    await subcategories.waitFor();
    await subcategories
      .getByRole('button', { name: '겨울', exact: true })
      .click();
    await page.getByRole('heading', { name: '겨울', exact: true }).waitFor();
    await checkOverflow(page, 'subcategory', label);

    await page
      .getByRole('textbox', { name: '검색어', exact: true })
      .fill('패딩');
    await page
      .getByRole('textbox', { name: '검색어', exact: true })
      .press('Enter');
    await page.getByRole('heading', { name: '“패딩” 검색 결과' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('keyword'), '패딩');

    await page.goto(`${args.base}${detailPath}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '구매하기', exact: true }).waitFor();
    await checkOverflow(page, 'product-detail', label);
    await capture(page, `${label}-product-detail.png`);
    await page.getByRole('button', { name: /^리뷰(?: \(\d+\))?$/ }).click();
    await page.getByRole('heading', { name: /리뷰/ }).first().waitFor();
    await checkOverflow(page, 'reviews', label);

    await page.goto(`${args.base}/login`, { waitUntil: 'networkidle' });
    await page.getByRole('textbox', { name: '이메일', exact: true }).waitFor();
    await checkOverflow(page, 'login', label);
    await capture(page, `${label}-login.png`);
    await page.goto(`${args.base}/register`, { waitUntil: 'networkidle' });
    await checkOverflow(page, 'register', label);

    // 계정 화면은 브라우저 내부 픽스처로만 검사한다. 가짜 토큰은 서버에 보내지 않는다.
    const buyerContext = await browser.newContext({
      viewport: { width, height: 900 },
      locale: 'ko-KR',
      reducedMotion: 'reduce',
    });
    const buyer = {
      id: 999999,
      name: '미리보기',
      nickName: '미리보기',
      email: 'preview@example.test',
      roles: ['buyer'],
      isEmailVerified: true,
      isDemo: false,
      address: '',
      phoneNumber: '',
    };
    const cart = {
      id: 1,
      userId: buyer.id,
      items: [
        {
          id: 1,
          productId: 46,
          quantity: 1,
          product: {
            id: 46,
            name: '상품 이름이 긴 경우에도 모바일 장바구니를 확인하는 테스트 상품',
            brand: 'SHOPMALL',
            price: '63000.00',
            stockQuantity: 10,
            status: 'published',
            discountRate: 0,
          },
        },
      ],
    };
    await buyerContext.addInitScript(() => {
      sessionStorage.setItem('shopping-mall-splash-shown', '1');
      localStorage.setItem('accessToken', 'browser-only-preview-fixture');
      localStorage.setItem('auth:persist', '1');
    });
    await buyerContext.route(/\/monitoring(\?|$)|sentry\.io/, (route) =>
      route.abort()
    );
    await buyerContext.route('**/api/**', (route) => {
      const request = route.request();
      assert.equal(request.method(), 'GET', 'Buyer preview must be read-only');
      const path = new URL(request.url()).pathname;
      const fixture =
        path === '/api/auth/me' || path === '/api/users/me'
          ? buyer
          : path === '/api/cart'
          ? cart
          : undefined;
      if (fixture)
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(fixture),
        });
      if (apiCache.has(request.url()))
        return route.fulfill(apiCache.get(request.url()));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]',
      });
    });
    const buyerPage = await buyerContext.newPage();
    buyerPage.on('pageerror', (error) => errors.push(error.message));
    for (const [name, path, heading] of [
      ['cart', '/cart', '장바구니'],
      ['checkout', '/checkout', '주문서 작성'],
      ['my', '/my', '내 정보'],
    ]) {
      await buyerPage.goto(`${args.base}${path}`, { waitUntil: 'networkidle' });
      await buyerPage.getByRole('heading', { name: heading }).waitFor();
      await checkOverflow(buyerPage, name, label);
      await capture(buyerPage, `${label}-${name}.png`);
    }
    await buyerContext.close();

    // 실제 API가 실패했을 때의 홈 상태도 확인한다.
    await context.route('**/api/products?**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"Preview failure check"}',
      })
    );
    await page.goto(args.base, { waitUntil: 'networkidle' });
    await page
      .getByText('상품을 불러오지 못했습니다.')
      .first()
      .waitFor({ timeout: 20000 });
    await checkOverflow(page, 'api-error', label);
    assert.deepEqual(errors, [], `Runtime errors on ${label}`);
    results.push({
      viewport: label,
      width,
      checks: [
        'home',
        'category-keyboard-menu',
        'image-fallback',
        'sorting',
        'subcategory',
        'search',
        'detail',
        'reviews',
        'login',
        'register',
        'cart-fixture',
        'checkout-fixture',
        'my-fixture',
        'api-error',
        'no-horizontal-overflow',
        'no-runtime-errors',
        'reduced-motion',
      ],
    });
    await context.close();
  }
  writeFileSync(
    join(args.out, 'verification.json'),
    JSON.stringify(results, null, 2)
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
