#!/usr/bin/env node
/** 실제 로컬 API의 공개 상품 데이터와 UI 연결 검증. 주문·인증 변경 요청은 하지 않는다. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:3100';
const api = 'http://127.0.0.1:4000/v1';
const out = 'tmp/refresh-design-live';
mkdirSync(out, { recursive: true });
async function get(path) {
  const response = await fetch(`${api}${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
}
const product = await get('/products/46');
const summary = await get('/reviews/product/46/summary');
const reviews = await get('/reviews/product/46?take=5&page=1');
assert.equal(product.reviewCount, summary.count);
assert.equal(reviews.meta.total, summary.count);
assert.equal(Number(product.rating), summary.average);
assert.equal(product.specs.skinType, 'DRY');
assert.equal(product.specs.volume, 50);
assert.equal(typeof product.wishCount, 'number');
const categories = await get('/categories');
const categoryResults = [];
for (const category of categories) {
  const list = await get(`/products?categoryId=${category.id}&take=1&page=1`);
  assert.ok(list.meta.total > 0, category.name);
  assert.equal(typeof list.data[0].reviewCount, 'number');
  assert.ok('specs' in list.data[0]);
  categoryResults.push({ name: category.name, publicProducts: list.meta.total });
}
const sellerList = await get('/products?sellerId=1&take=20&page=1');
assert.ok(sellerList.data.length > 0);
assert.ok(sellerList.data.every((item) => item.sellerId === 1));
const sellerProduct = sellerList.data[0];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const width of [1440, 390, 320]) {
    console.log(`Actual DB UI: ${width}px`);
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', locale: 'ko-KR' });
    await context.addInitScript(() => sessionStorage.setItem('shopping-mall-splash-shown', '1'));
    await context.route('**/api/**', (route) => route.request().method() === 'GET' ? route.continue() : route.abort());
    await context.route(/\/monitoring(\?|$)|sentry\.io/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const overflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow ${width} ${page.url()}`);
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '지금 많이 찾는 상품' }).waitFor();
    await overflow();
    await page.screenshot({ path: `${out}/${width}-home.png` });
    await page.goto(`${base}/products/46`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: product.name, exact: true }).waitFor();
    assert.ok(await page.getByText(`(${product.reviewCount}개 리뷰)`, { exact: true }).isVisible());
    await overflow();
    await page.getByRole('button', { name: '상품 스펙', exact: true }).click();
    await page.getByText('피부 타입', { exact: true }).waitFor();
    assert.ok(await page.getByRole('definition').filter({ hasText: /^건성$/ }).isVisible());
    assert.ok(await page.getByRole('definition').filter({ hasText: /^50 ml$/ }).isVisible());
    assert.ok(await page.getByRole('definition').filter({ hasText: /^대한민국$/ }).isVisible());
    await overflow();
    await page.screenshot({ path: `${out}/${width}-specs.png` });
    await page.getByRole('button', { name: `리뷰 (${product.reviewCount})`, exact: true }).click();
    await page.getByRole('heading', { name: `고객 리뷰 (${summary.count})`, exact: true }).waitFor();
    await page.getByText(`${summary.count}개의 리뷰`, { exact: true }).waitFor();
    await page.getByText('리뷰를 불러오는 중...', { exact: true }).waitFor({ state: 'hidden' });
    assert.ok(await page.getByText(reviews.data[0].comment, { exact: true }).isVisible());
    await overflow();
    await page.screenshot({ path: `${out}/${width}-reviews.png` });
    await page.goto(`${base}/products/${sellerProduct.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '판매자 정보', exact: true }).click();
    await page.getByRole('link', { name: '판매자의 다른 상품 보기 →' }).click();
    await page.getByRole('heading', { name: '판매자의 상품', exact: true }).waitFor();
    await page.getByText(sellerProduct.name, { exact: true }).waitFor();
    const links = await page.locator('a[href^="/products/"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
    assert.deepEqual([...new Set(links)].sort(), sellerList.data.map((item) => `/products/${item.id}`).sort());
    await overflow();
    assert.deepEqual(errors, []);
    results.push({ width, checks: ['actual-home', 'review-count', 'translated-specs', 'actual-reviews', 'seller-filter', 'no-overflow', 'no-runtime-errors'] });
    await context.close();
  }
  writeFileSync(`${out}/verification.json`, JSON.stringify({ categories: categoryResults, productId: product.id, reviewCount: product.reviewCount, results }, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
