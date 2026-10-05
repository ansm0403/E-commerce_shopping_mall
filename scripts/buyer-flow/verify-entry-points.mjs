/**
 * 진입 경로 확인 (05-buyer-flow-complete.md §6 ⑧ · §9 DoD 1).
 *
 *   node scripts/buyer-flow/verify-entry-points.mjs [--base http://localhost:3100] [--email …] [--password …]
 *
 * 보는 것:
 *   1. 헤더 사용자 메뉴의 "내 정보"·"위시리스트"·"내 문의"·"주문 목록"·"장바구니" 가 각각 제 화면으로 간다(죽은 항목 없음)
 *   2. 마이페이지 좌측 네비 7개가 전부 **빈 stub 이 아닌** 화면으로 간다(제목이 있는 화면)
 *   3. /my/cart → /cart
 */
import { chromium } from 'playwright-core';
import { resetLoginRateLimits } from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const BASE = arg('--base', 'http://localhost:3100').replace(/\/$/, '');
const EMAIL = arg('--email', 'a11y-buyer@test.local');
const PASSWORD = arg('--password', 'A11yTest123!');
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const MENU = [
  ['내 정보', '/my'],
  ['주문 목록', '/my/orders'],
  ['위시리스트', '/my/wishlist'],
  ['내 문의', '/my/inquiries'],
  ['장바구니', '/cart'],
];
const NAV = [
  ['내 정보', '/my'],
  ['주문 내역', '/my/orders'],
  ['내 리뷰', '/my/reviews'],
  ['위시리스트', '/my/wishlist'],
  ['내 문의', '/my/inquiries'],
  ['비밀번호 변경', '/my/password'],
  ['셀러 신청', '/my/seller-apply'],
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await resetLoginRateLimits();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 60000 });

  // ── 1. 헤더 메뉴 ─────────────────────────────────────────────────────────
  for (const [label, path] of MENU) {
    // 홈은 로그인 상태에서 networkidle 에 닿지 않을 때가 있다(이미지 등 긴 요청) — load 까지만 기다리고 메뉴 버튼이 뜨면 진행한다
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.getByRole('button', { name: /님$/ }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    const arrived = await page
      .waitForURL((u) => new URL(u).pathname === path, { timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    check(`헤더 메뉴 "${label}" → ${path}`, arrived, new URL(page.url()).pathname);
  }

  // ── 2. 마이페이지 네비 ───────────────────────────────────────────────────
  await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  const nav = page.getByRole('navigation', { name: '마이페이지' });
  for (const [label, path] of NAV) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL((u) => new URL(u).pathname === path, { timeout: 60000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(800);
    // stub 은 제목 없이 글자 한 줄뿐이었다 — 내용 영역에 제목(h1/h2)이나 폼이 있어야 한다
    const content = page.locator('nav[aria-label="마이페이지"] + div');
    const headings = await content.locator('h1, h2').count();
    const forms = await content.locator('form').count();
    const text = (await content.innerText()).trim();
    check(
      `네비 "${label}" → ${path} (빈 화면 아님)`,
      new URL(page.url()).pathname === path && (headings > 0 || forms > 0) && text.length > 20,
      `제목 ${headings}개, 글자 ${text.length}자`,
    );
  }

  // ── 3. /my/cart ──────────────────────────────────────────────────────────
  await page.goto(`${BASE}/my/cart`, { waitUntil: 'load' });
  await page.waitForURL((u) => new URL(u).pathname === '/cart', { timeout: 30000 }).catch(() => undefined);
  check('/my/cart → /cart', new URL(page.url()).pathname === '/cart', new URL(page.url()).pathname);
  await context.close();
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n')[0]);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
