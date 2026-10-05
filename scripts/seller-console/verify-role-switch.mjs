/**
 * 계정을 바꿔 로그인했을 때 콘솔 가드가 앞 계정의 역할로 판정하지 않는가.
 *
 *   node scripts/seller-console/verify-role-switch.mjs [--base http://localhost:3100]
 *
 * 새로고침 없이(같은 탭, 화면 안의 링크·버튼만 눌러) 다음을 한다 — 새로고침하면 캐시가 비어 결함이 가려진다:
 *   1. 셀러로 로그인 → 셀러 센터 → 로그아웃 → 데모 관리자로 로그인 → 관리자 대시보드가 열린다(홈으로 튕기지 않는다)
 *   2. 관리자 → 로그아웃 → 셀러로 로그인 → 셀러 센터가 열린다("셀러 전용 페이지입니다"가 아니다)
 *
 * 원인이었던 것: AdminGuard·SellerGuard 의 `['auth','me']` 캐시가 로그아웃·로그인 때 지워지지 않았다.
 */
import { chromium } from 'playwright-core';
import { resetLoginRateLimits } from '../buyer-flow/lib.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const BASE = arg('--base', 'http://localhost:3100').replace(/\/$/, '');
const SELLER = { email: arg('--email', 'seller1@seed.com'), password: arg('--password', 'Seed1234!') };
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const pathOf = (url) => new URL(url).pathname;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await resetLoginRateLimits();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();
  let reloads = 0;
  page.on('load', () => (reloads += 1));

  /** 헤더 메뉴로 로그아웃한 뒤 로그인 화면까지 — 전부 화면 안의 버튼·링크로 */
  const logoutToLogin = async () => {
    await page.getByRole('link', { name: '← 쇼핑몰 홈으로' }).first().click();
    await page.waitForURL((u) => pathOf(u) === '/', { timeout: 60000 });
    await page.getByRole('button', { name: /님$/ }).click();
    await page.getByRole('button', { name: '로그아웃' }).first().click();
    await page.getByText('로그아웃 하시겠습니까?').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '로그아웃' }).last().click();
    const loginLink = page.getByRole('link', { name: /로그인\/회원가입/ });
    await loginLink.waitFor({ timeout: 30000 });
    await loginLink.click();
    await page.waitForURL((u) => pathOf(u) === '/login', { timeout: 60000 });
  };
  const loginAsSeller = async () => {
    await page.fill('input[name="email"]', SELLER.email);
    await page.fill('input[name="password"]', SELLER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => pathOf(u) !== '/login', { timeout: 60000 });
  };
  const openSellerCenter = async () => {
    await page.getByRole('button', { name: /님$/ }).click();
    await page.getByRole('button', { name: '셀러 센터' }).click();
    await page.waitForURL((u) => pathOf(u) === '/seller', { timeout: 60000 });
  };

  // 준비: 셀러로 로그인해 셀러 센터를 연다(가드가 "셀러" 역할을 캐시한다)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await loginAsSeller();
  await openSellerCenter();
  await page.getByRole('heading', { name: '대시보드', level: 1 }).waitFor({ timeout: 30000 });
  const loadsAfterSetup = reloads;

  // ── 1. 셀러 → 관리자 ─────────────────────────────────────────────────────
  await logoutToLogin();
  await page.getByRole('button', { name: /관리자 페이지 체험하기/ }).click();
  await page.waitForURL((u) => pathOf(u) === '/admin/dashboard', { timeout: 30000 });
  await page.waitForTimeout(4000); // 가드가 앞 계정의 역할로 판정하면 이 사이에 홈으로 보낸다
  const adminHeading = await page.getByRole('heading', { name: '대시보드', level: 1 }).isVisible().catch(() => false);
  check('셀러 → 로그아웃 → 관리자 로그인: 관리자 대시보드가 열린다', pathOf(page.url()) === '/admin/dashboard' && adminHeading, `지금 주소 ${pathOf(page.url())}`);

  // ── 2. 관리자 → 셀러 ─────────────────────────────────────────────────────
  if (pathOf(page.url()) !== '/admin/dashboard') {
    // 1번이 실패해 홈으로 튕긴 경우에도 2번을 이어서 본다
    await page.getByRole('button', { name: /님$/ }).click();
    await page.getByRole('button', { name: '로그아웃' }).first().click();
    await page.getByRole('button', { name: '로그아웃' }).last().click();
    await page.getByRole('link', { name: /로그인\/회원가입/ }).click();
    await page.waitForURL((u) => pathOf(u) === '/login', { timeout: 60000 });
  } else {
    await logoutToLogin();
  }
  await loginAsSeller();
  await openSellerCenter();
  await page.waitForTimeout(4000);
  const blocked = await page.getByText('셀러 전용 페이지입니다.').isVisible().catch(() => false);
  const sellerHeading = await page.getByRole('heading', { name: '대시보드', level: 1 }).isVisible().catch(() => false);
  check('관리자 → 로그아웃 → 셀러 로그인: 셀러 센터가 열린다', sellerHeading && !blocked, blocked ? '"셀러 전용 페이지입니다"가 보임' : '');
  check('이 과정에서 새로고침(전체 페이지 로드)이 없었다', reloads === loadsAfterSetup, `추가 로드 ${reloads - loadsAfterSetup}회`);
  await context.close();
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n').slice(0, 3).join(' / '));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
