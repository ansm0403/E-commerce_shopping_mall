#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.DESIGN_PREVIEW_URL || 'http://127.0.0.1:3100';
const out = process.env.DESIGN_RESULTS_DIR || 'tmp/refresh-design-events';
const apiBase = process.env.DESIGN_API_URL || 'http://127.0.0.1:4000/v1';
mkdirSync(out, { recursive: true });
const api = async (path) => {
  const response = await fetch(`${apiBase}${path}`);
  assert.equal(response.status, 200);
  return response.json();
};
const first = await api('/products?take=100&page=1');
const catalog = [...first.data];
for (let page = 2; page <= first.meta.lastPage; page++) catalog.push(...(await api(`/products?take=100&page=${page}`)).data);
const ranked = (await api('/products?take=8&page=1&sortBy=rating&sortOrder=DESC&filter[rating][gt]=0')).data;
const tree = await api('/categories');
const allNodes = (nodes) => nodes.flatMap((node) => [node, ...allNodes(node.children)]);
const categoryIds = (...slugs) => new Set(allNodes(tree).filter((node) => slugs.includes(node.slug)).flatMap((node) => allNodes([node]).map((child) => child.id)));
const summer = categoryIds('clothing-summer');
const gifts = categoryIds('book', 'living');
const style = categoryIds('clothing', 'shoes');
const events = [
  ['special-finds', (product) => Number(product.discountRate) > 0],
  ['everyday-favorites', (product) => Number(product.rating) > 0],
  ['summer-edit', (product) => summer.has(product.categoryId)],
  ['gift-edit', (product) => gifts.has(product.categoryId)],
  ['style-edit', (product) => style.has(product.categoryId)],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const cache = new Map();
try {
  for (const width of [1440, 390, 320]) {
    console.log(`Events: ${width}px`);
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => sessionStorage.setItem('shopping-mall-splash-shown', '1'));
    await context.route(/\/monitoring(\?|$)|sentry\.io/, (route) => route.abort());
    await context.route('**/api/**', async (route) => {
      if (route.request().method() !== 'GET') return route.abort();
      const url = route.request().url();
      if (!cache.has(url)) { const response = await route.fetch(); cache.set(url, { status: response.status(), body: await response.body(), contentType: 'application/json' }); }
      return route.fulfill(cache.get(url));
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow ${width} ${page.url()}`);
    const ids = async (scope) => scope.locator('a[href^="/products/"]').evaluateAll((links) => links.map((link) => Number(link.getAttribute('href').split('/').pop())));
    await page.goto(base, { waitUntil: 'networkidle' });
    const main = page.locator('[data-banner-slide]');
    assert.ok((await main.nth(0).locator('img').getAttribute('src')).includes('main_banner3'));
    assert.ok((await main.nth(1).locator('img').getAttribute('src')).includes('main_banner2'));
    assert.ok((await main.nth(2).locator('img').getAttribute('src')).includes('main_banner1'));
    assert.deepEqual(await main.evaluateAll((links) => links.map((link) => link.getAttribute('href'))), events.slice(0, 3).map(([slug]) => `/events/${slug}`));
    assert.deepEqual(await page.locator('[data-side-banner]').evaluateAll((links) => links.map((link) => link.getAttribute('href'))), events.slice(3).map(([slug]) => `/events/${slug}`));
    const popular = page.locator('section').filter({ has: page.getByRole('heading', { name: '지금 많이 찾는 상품', exact: true }) }).last();
    await popular.locator('a[href^="/products/"]').first().waitFor();
    assert.deepEqual(await ids(popular), ranked.map((product) => product.id));
    await popular.getByRole('link', { name: /전체 보기/ }).click();
    await page.waitForURL(/rated=true/);
    const listIds = await ids(page);
    assert.ok(listIds.length > 0 && listIds.every((id) => Number(catalog.find((product) => product.id === id)?.rating) > 0));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('[data-banner-slide][aria-hidden="false"]').click();
    await page.waitForURL('**/events/special-finds');

    for (const [slug, match] of events) {
      await page.goto(`${base}/events/${slug}`, { waitUntil: 'networkidle' });
      const products = page.getByRole('region', { name: '기획전 상품', exact: true });
      const expected = catalog.filter(match);
      await products.getByText(`${expected.length}개의 상품`, { exact: true }).waitFor();
      const displayed = await ids(products);
      assert.equal(displayed.length, Math.min(12, expected.length));
      assert.ok(displayed.every((id) => expected.some((product) => product.id === id)));
      await products.getByRole('combobox', { name: '기획전 상품 정렬' }).selectOption('price');
      const sorted = [...expected].sort((a, b) => Number(a.price) - Number(b.price) || b.id - a.id);
      assert.deepEqual(await ids(products), sorted.slice(0, 12).map((product) => product.id));
      const more = products.getByRole('button', { name: /^상품 더 보기/ });
      if (expected.length > 12) { await more.click(); assert.deepEqual(await ids(products), sorted.slice(0, 24).map((product) => product.id)); }
      await noOverflow();
      await page.screenshot({ path: `${out}/${width}-${slug}.png` });
    }
    await page.goto(`${base}/events`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '취향을 만나는 기획전.', exact: true }).waitFor();
    assert.equal(await page.locator('a[href^="/events/"]').count(), 5);
    await noOverflow();
    const missing = await page.goto(`${base}/events/not-an-event`);
    assert.equal(missing.status(), 404);
    assert.deepEqual(errors, []);
    results.push({ width, checks: ['banner-order-and-links', 'rating-order-and-all-view', 'five-events', 'real-product-conditions', 'sort', 'load-more', 'events-index', '404', 'no-overflow', 'no-runtime-errors'] });
    await context.close();
  }
  writeFileSync(`${out}/verification.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
