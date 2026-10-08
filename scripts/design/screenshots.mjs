#!/usr/bin/env node
/**
 * 디자인 개편 전후 비교용 스크린샷 — 쇼핑몰(비로그인·구매자) · 셀러 · 관리자 대표 화면을 데스크톱/폰 폭으로 찍는다.
 *
 *   node scripts/design/screenshots.mjs --out tmp/design-shots --prefix before
 *   node scripts/design/screenshots.mjs --out tmp/design-shots --prefix after --only home,product-detail
 *
 * 바이트 비교(seller-console/admin-screenshots)와 달리 **눈으로 보는 비교**용이다 — 데이터는 로컬 DB 를 그대로 쓴다.
 * 상세 화면은 조회수 1위 상품을 고정해서 연다(열 때마다 조회수가 올라도 "인기 상품" 순서가 바뀌지 않게).
 *
 * 전제: 로컬 백엔드(DEMO_LOGIN_ENABLED=true) + 프론트 운영 빌드(next start -p 3100).
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { apiAuth, ensureCartItem, loginAsDemoAdmin } from '../a11y/lib.mjs';
import { resetLoginRateLimits } from '../buyer-flow/lib.mjs';

const args = {
  base: 'http://localhost:3100',
  api: 'http://localhost:4000/v1',
  out: 'tmp/design-shots',
  prefix: 'shot',
  'product-id': '46',
  only: '',
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i].slice(2)] = argv[i + 1];
const only = new Set(args.only.split(',').filter(Boolean));
mkdirSync(args.out, { recursive: true });

const BUYER = { email: 'a11y-buyer@test.local', password: 'A11yTest123!' };
const SELLER = { email: 'seller1@seed.com', password: 'Seed1234!' };
const FIXED_NOW = new Date('2026-10-05T12:00:00+09:00');
const VIEWPORTS = [
  ['desktop', { width: 1280, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
];

/** 묶음마다 로그인 방법과 찍을 화면 */
const GROUPS = [
  {
    login: null,
    pages: [
      ['home', '/'],
      ['products', '/products'],
      ['product-detail', `/products/${args['product-id']}`],
      ['login', '/login'],
    ],
  },
  {
    login: (page) => loginWithForm(page, BUYER, '/my'),
    pages: [
      ['my', '/my'],
      ['my-orders', '/my/orders'],
      ['cart', '/cart'],
      ['checkout', '/checkout'],
    ],
  },
  {
    login: (page) => loginWithForm(page, SELLER, '/seller'),
    pages: [
      ['seller-dashboard', '/seller'],
      ['seller-products', '/seller/products'],
    ],
  },
  {
    login: (page) => loginAsDemoAdmin(page, args.base),
    pages: [['admin-dashboard', '/admin/dashboard']],
  },
];

async function loginWithForm(page, { email, password }, redirect) {
  await page.goto(`${args.base}/login?redirect=${encodeURIComponent(redirect)}`, { waitUntil: 'load' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === redirect, { timeout: 60000 });
}

await resetLoginRateLimits();
// 주문서는 장바구니가 비면 /cart 로 튕긴다
await ensureCartItem(args.api, await apiAuth(args.api, BUYER.email, BUYER.password), args['product-id']);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [label, viewport] of VIEWPORTS) {
    for (const group of GROUPS) {
      const pages = group.pages.filter(([name]) => only.size === 0 || only.has(name));
      if (pages.length === 0) continue;
      const context = await browser.newContext({ viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
      await context.clock.install({ time: FIXED_NOW });
      await context.route(/\/monitoring(\?|$)|sentry\.io/, (route) => route.abort());
      // 첫 방문 스플래시를 건너뛴다(SplashScreen 의 sessionStorage 키)
      await context.addInitScript(() => sessionStorage.setItem('shopping-mall-splash-shown', '1'));
      const page = await context.newPage();
      if (group.login) await group.login(page);

      for (const [name, path] of pages) {
        // networkidle 은 /login 에서 끝나지 않을 때가 있다 — load 뒤 networkidle 은 최대 10초만 기다린다
        await page.goto(args.base + path, { waitUntil: 'load' });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.locator('#nprogress').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
        // 이미지·차트 등장 애니메이션이 끝난 뒤에 찍는다
        await page.waitForTimeout(2500);
        const file = `${args.prefix}-${label}-${name}.png`;
        await page.screenshot({ path: join(args.out, file), fullPage: true, animations: 'disabled' });
        console.log(file);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
