/**
 * 마이페이지 네비의 "셀러 센터" 확인.
 *
 *   node scripts/buyer-flow/verify-my-nav-seller.mjs [--base http://localhost:3100]
 *
 * 보는 것:
 *   1. 셀러 계정: 마이페이지 네비 맨 끝에 "셀러 센터" · 누르면 셀러 센터(상품 관리)로 · "셀러 신청"도 남아 있다
 *   2. 구매자 계정: "셀러 센터"가 없다(네비 7개 그대로)
 *   3. 모바일 390px: 페이지 가로 넘침 없음(네비는 자체 가로 스크롤)
 */
import { chromium } from 'playwright-core';
import { resetLoginRateLimits } from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const BASE = arg('--base', 'http://localhost:3100').replace(/\/$/, '');
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;
const SELLER = { email: arg('--seller-email', 'seller1@seed.com'), password: arg('--seller-password', 'Seed1234!') };
const BUYER = { email: arg('--email', 'a11y-buyer@test.local'), password: arg('--password', 'A11yTest123!') };

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function openMy(browser, account) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${BASE}/login?redirect=%2Fmy`, { waitUntil: 'load' });
  await page.fill('input[name="email"]', account.email);
  await page.fill('input[name="password"]', account.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/my', { timeout: 60000 });
  const nav = page.getByRole('navigation', { name: '마이페이지' });
  await page.getByRole('heading', { name: '프로필' }).waitFor({ timeout: 30000 });
  return { context, page, nav };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await resetLoginRateLimits();

  // ── 1. 셀러 ──────────────────────────────────────────────────────────────
  const seller = await openMy(browser, SELLER);
  const sellerLabels = (await seller.nav.getByRole('link').allInnerTexts()).map((t) => t.replace(/\s*→\s*$/, '').trim());
  check('셀러: 네비 맨 끝에 "셀러 센터"', sellerLabels.at(-1) === '셀러 센터', sellerLabels.join(' · '));
  check('셀러: "셀러 신청"도 남아 있다', sellerLabels.includes('셀러 신청'));

  await seller.page.setViewportSize({ width: 390, height: 844 });
  await seller.page.waitForTimeout(300);
  const overflow = await seller.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('셀러·모바일(390px): 페이지 가로 넘침 없음', overflow <= 0, `${overflow}px`);
  await seller.page.setViewportSize({ width: 1280, height: 900 });

  await seller.nav.getByRole('link', { name: /셀러 센터/ }).click();
  await seller.page.waitForURL((u) => new URL(u).pathname === '/seller/products', { timeout: 60000 });
  await seller.page.getByRole('navigation', { name: '셀러 센터' }).waitFor({ timeout: 30000 });
  check('셀러: 누르면 셀러 센터(상품 관리)로 이동', true);
  await seller.context.close();

  // ── 2. 구매자 ────────────────────────────────────────────────────────────
  const buyer = await openMy(browser, BUYER);
  const buyerLabels = await buyer.nav.getByRole('link').allInnerTexts();
  check('구매자: "셀러 센터"가 없다(7개 그대로)', buyerLabels.length === 7 && !buyerLabels.some((t) => t.includes('셀러 센터')), buyerLabels.join(' · '));
  await buyer.context.close();
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n').slice(0, 3).join(' / '));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
