#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = 'tmp/refresh-design-banner';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const width of [1440, 390, 320]) {
    console.log(`Banner: ${width}px`);
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'no-preference' });
    await context.addInitScript(() => sessionStorage.setItem('shopping-mall-splash-shown', '1'));
    await context.route(/\/monitoring(\?|$)|sentry\.io/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:3100', { waitUntil: 'networkidle' });
    const carousel = page.getByRole('region', { name: '쇼핑 배너', exact: true });
    const sideBanners = page.locator('[data-side-banner]');
    assert.equal(await sideBanners.count(), 2);
    const mainBounds = await carousel.boundingBox();
    const firstSide = await sideBanners.nth(0).boundingBox();
    const secondSide = await sideBanners.nth(1).boundingBox();
    if (width >= 1024) {
      assert.ok(firstSide.x > mainBounds.x + mainBounds.width);
      assert.ok(secondSide.y > firstSide.y);
      assert.ok(mainBounds.width > firstSide.width * 1.7);
    } else {
      assert.ok(firstSide.y >= mainBounds.y + mainBounds.height);
      assert.ok(secondSide.x > firstSide.x);
    }
    const active = () => carousel.getAttribute('data-current-banner');
    const outside = async () => {
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(1, 1);
    };
    await outside();
    const initial = await active();
    await page.waitForFunction((previous) => document.querySelector('[data-current-banner]')?.getAttribute('data-current-banner') !== previous, initial, { timeout: 6500 });
    await carousel.hover();
    const hovered = await active();
    await page.waitForTimeout(900);
    assert.ok(await carousel.locator('[data-banner-image]').first().evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a > 1.02));
    await page.waitForTimeout(4600);
    assert.equal(await active(), hovered, 'hover pauses autoplay');
    await carousel.getByRole('button', { name: '배너 3 보기', exact: true }).click();
    await carousel.getByRole('button', { name: '다음 배너', exact: true }).click();
    assert.equal(await active(), '1', 'last slide wraps to first');
    await carousel.getByRole('button', { name: '이전 배너', exact: true }).click();
    assert.equal(await active(), '3', 'first slide wraps to last');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await active(), '2');
    await carousel.getByRole('button', { name: '배너 자동 전환 멈추기' }).click();
    await outside();
    await page.waitForTimeout(4700);
    assert.equal(await active(), '2', 'explicit pause');
    await carousel.getByRole('button', { name: '배너 자동 전환 재생' }).click();
    await outside();
    await page.waitForFunction(() => document.querySelector('[data-current-banner]')?.getAttribute('data-current-banner') === '3', null, { timeout: 6500 });
    await page.waitForTimeout(900);
    assert.ok(await carousel.locator('[data-banner-track]').evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41 < -node.clientWidth * 1.9));
    await carousel.getByRole('button', { name: '배너 1 보기', exact: true }).click();
    await page.waitForTimeout(850);
    const visible = carousel.locator('[data-banner-slide][aria-hidden="false"]');
    await visible.locator('img').evaluate((node) => node.decode());
    assert.equal(await visible.count(), 1);
    assert.equal(await carousel.locator('[data-banner-slide][tabindex="0"]').count(), 1);
    assert.ok(await visible.evaluate((node) => Number(getComputedStyle(node).opacity) > 0.99));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await carousel.screenshot({ path: `${out}/${width}-carousel.png` });
    await page.locator('section[aria-label="새로운 취향을 발견하는 쇼핑"]').screenshot({ path: `${out}/${width}-banner-layout.png` });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `${out}/${width}-home.png` });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await carousel.getByRole('button', { name: '움직임 줄이기로 자동 전환 정지됨' }).waitFor();
    await outside();
    const reduced = await active();
    await page.waitForTimeout(4700);
    assert.equal(await active(), reduced, 'reduced motion stops autoplay');
    await carousel.hover();
    assert.ok(await carousel.locator('[data-banner-image]').first().evaluate((node) => new DOMMatrixReadOnly(getComputedStyle(node).transform).a === 1));
    assert.deepEqual(errors, []);
    results.push({ width, checks: ['three-banner-layout', 'autoplay-slide', 'hover-zoom-and-pause', 'wrap', 'keyboard', 'pause-resume', 'image-loaded', 'reduced-motion', 'no-overflow', 'no-runtime-errors'] });
    await context.close();
  }
  writeFileSync(`${out}/verification.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
