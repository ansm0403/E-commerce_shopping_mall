/**
 * 상품 등록 화면의 이미지 미리보기 확인.
 *
 *   node scripts/buyer-flow/verify-upload-preview.mjs [--base http://localhost:3100] [--email seller1@seed.com] [--password …]
 *
 * 셀러로 로그인 → 상품 등록 화면에서 이미지 파일을 고른다 → 아래 미리보기가 **실제로 그려지는가**.
 * 미리보기는 `URL.createObjectURL(file)`(= `blob:` 주소)이라, CSP 의 img-src 가 `blob:` 을 허용하지 않으면
 * 브라우저가 막아 엑스박스가 된다. 그 차단 메시지(콘솔)도 함께 본다.
 * 상품을 실제로 등록하지는 않는다(파일만 고른다).
 */
import { chromium } from 'playwright-core';
import { makePng, resetLoginRateLimits } from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const BASE = arg('--base', 'http://localhost:3100').replace(/\/$/, '');
const EMAIL = arg('--email', 'seller1@seed.com');
const PASSWORD = arg('--password', 'Seed1234!');
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await resetLoginRateLimits();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();
  const cspErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy|img-src/i.test(msg.text())) cspErrors.push(msg.text().slice(0, 160));
  });

  await page.goto(`${BASE}/login?redirect=%2Fseller%2Fproducts%2Fnew`, { waitUntil: 'load' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/seller/products/new', { timeout: 60000 });

  const input = page.locator('input[type="file"]');
  await input.waitFor({ state: 'attached', timeout: 30000 });
  await input.setInputFiles({ name: 'preview-check.png', mimeType: 'image/png', buffer: makePng(64, [220, 38, 38]) });

  const preview = page.getByRole('img', { name: 'preview-check.png' });
  await preview.waitFor({ state: 'attached', timeout: 10000 });
  await page.waitForTimeout(800);
  const state = await preview.evaluate((img) => ({ src: img.src.slice(0, 5), complete: img.complete, width: img.naturalWidth }));
  check('미리보기 주소가 blob:', state.src === 'blob:', state.src);
  check('미리보기가 실제로 그려진다(엑스박스 아님)', state.width > 0, `naturalWidth ${state.width}px`);
  check('CSP 가 이미지를 막지 않는다', cspErrors.length === 0, cspErrors[0] ?? '');
  await context.close();
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n').slice(0, 3).join(' / '));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
