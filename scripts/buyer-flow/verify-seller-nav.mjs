/**
 * 셀러 센터 사용감 확인 — 현재 메뉴 표시 · 상품 이름 링크 · 구매자가 아닌 계정의 찜 안내.
 *
 *   node scripts/buyer-flow/verify-seller-nav.mjs [--base http://localhost:3100] [--email seller1@seed.com] [--password …]
 *
 * 보는 것:
 *   1. 사이드바 메뉴 6개를 차례로 눌렀을 때 **그 메뉴 하나만** 현재 표시(aria-current)가 되고 글자색이 다른 메뉴와 다르다
 *      ("상품 등록"에서는 "상품 관리"가 같이 켜지지 않는다 · 상품 수정 화면에서는 "상품 관리"가 켜진다)
 *   2. 상품 관리 표의 상품 이름이 링크다 — 상점에 보이는 상품은 상세로, 아직 안 보이는 상품은 수정 화면으로
 *   3. 구매자 역할이 없는 계정(시드 셀러)이 하트를 누르면 서버 403 문구가 아니라 이유를 알려 준다(요청도 보내지 않는다)
 */
import { chromium } from 'playwright-core';
import { resetLoginRateLimits } from './lib.mjs';

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

const MENU = [
  ['대시보드', '/seller'],
  ['상품 관리', '/seller/products'],
  ['상품 등록', '/seller/products/new'],
  ['주문/배송', '/seller/orders'],
  ['정산', '/seller/settlements'],
  ['문의', '/seller/inquiries'],
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await resetLoginRateLimits();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();
  const alerts = [];
  page.on('dialog', async (d) => {
    alerts.push(d.message());
    await d.accept();
  });
  let toggleRequests = 0;
  // 로그인 응답의 역할 — 이 계정에 구매자 역할이 있으면 3번(구매자가 아닌 계정의 찜 안내)은 전제가 맞지 않는다
  let loginRoles = null;
  page.on('response', async (res) => {
    if (res.url().endsWith('/api/auth/login') && res.ok()) {
      loginRoles = (await res.json().catch(() => null))?.user?.roles ?? null;
    }
  });
  page.on('request', (req) => {
    if (/\/wishlist\/toggle$/.test(req.url())) toggleRequests += 1;
  });

  await page.goto(`${BASE}/login?redirect=%2Fseller%2Fproducts`, { waitUntil: 'load' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/seller/products', { timeout: 60000 });

  const nav = page.getByRole('navigation', { name: '셀러 센터' });
  await nav.waitFor({ timeout: 30000 });
  const currentLabels = () => nav.locator('a[aria-current="page"]').allInnerTexts();
  const colorOf = (label) => nav.getByRole('link', { name: label, exact: true }).evaluate((el) => getComputedStyle(el).color);

  // ── 1. 현재 메뉴 표시 ────────────────────────────────────────────────────
  for (const [label, path] of MENU) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL((u) => new URL(u).pathname === path, { timeout: 60000 });
    await page.waitForTimeout(300);
    const current = await currentLabels();
    const other = MENU.find(([l]) => l !== label)[0];
    const distinct = (await colorOf(label)) !== (await colorOf(other));
    check(`"${label}" 를 누르면 그 메뉴만 현재 표시 + 색이 다르다`, current.length === 1 && current[0] === label && distinct, `현재: ${current.join(', ')}`);
  }

  // ── 2. 상품 이름 링크 ────────────────────────────────────────────────────
  await nav.getByRole('link', { name: '상품 관리', exact: true }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/seller/products', { timeout: 60000 });
  const rows = page.locator('tbody tr');
  await rows.first().waitFor({ timeout: 30000 });
  const links = await rows.evaluateAll((trs) =>
    trs
      .map((tr) => {
        const a = tr.querySelector('td:nth-child(2) a');
        return a ? { name: a.textContent.trim(), href: a.getAttribute('href'), status: tr.querySelector('td:nth-child(4)')?.textContent.trim(), approval: tr.querySelector('td:nth-child(5) span')?.textContent.trim() } : null;
      })
      .filter(Boolean),
  );
  check('상품 이름이 링크다', links.length > 0, `${links.length}개`);
  const wrong = links.filter((l) => !/^\/products\/\d+$/.test(l.href) && !/^\/seller\/products\/\d+\/edit$/.test(l.href));
  check('링크는 상점 상세 또는 수정 화면 둘 중 하나', wrong.length === 0, links.map((l) => `${l.status}/${l.approval}→${l.href}`).slice(0, 4).join(' · '));
  const live = links.find((l) => /^\/products\/\d+$/.test(l.href));
  if (live) {
    await page.getByRole('link', { name: live.name, exact: true }).first().click();
    await page.waitForURL((u) => new URL(u).pathname === live.href, { timeout: 60000 });
    await page.getByRole('heading', { name: live.name }).first().waitFor({ timeout: 30000 });
    check('게시된 상품의 이름을 누르면 상점의 상품 화면이 열린다', true, live.href);

    // ── 3. 구매자 역할이 없는 계정의 찜 ─────────────────────────────────────
    const isBuyer = (loginRoles ?? []).some((r) => (typeof r === 'string' ? r : r?.name) === 'buyer');
    if (isBuyer) {
      // 누르면 이 계정의 찜이 실제로 바뀐다 — 전제가 안 맞으면 누르지 않는다
      console.log(`- 건너뜀: 찜 안내 확인 — ${EMAIL} 에 구매자 역할이 있다(구매자 역할이 없는 계정을 --email 로 줄 것)`);
    } else {
      const heart = page.locator('button[aria-pressed]');
      await page.locator('button[aria-pressed]:not([disabled])').waitFor({ timeout: 15000 });
      await heart.click();
      await page.waitForTimeout(800);
      check('구매자가 아닌 계정: 이유를 알려 주는 안내가 뜬다', alerts.some((m) => m.includes('구매자 계정')), alerts.join(' | '));
      check('… 서버로 찜 요청을 보내지 않는다(403 을 받지 않는다)', toggleRequests === 0, `요청 ${toggleRequests}건`);
    }
  } else {
    check('게시된 상품이 있어야 상세 이동·찜 안내를 확인할 수 있다', false, '이 셀러에게 게시된 상품이 없음');
  }

  // 수정 화면에서는 "상품 관리"가 켜진다
  const edit = links.find((l) => /edit$/.test(l.href)) ?? (live ? { href: `/seller/products/${live.href.split('/').pop()}/edit` } : null);
  if (edit) {
    await page.goto(BASE + edit.href, { waitUntil: 'load' });
    await nav.waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    const current = await currentLabels();
    check('상품 수정 화면에서는 "상품 관리"가 현재 표시', current.length === 1 && current[0] === '상품 관리', current.join(', '));
  }
  await context.close();
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n').slice(0, 3).join(' / '));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
