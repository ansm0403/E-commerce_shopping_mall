/**
 * 새로고침 튕김 프로브 (05-buyer-flow-complete.md §3 F5 · §6 ④).
 *
 *   node scripts/buyer-flow/reload-probe.mjs [--base http://localhost:3100] [--email …] [--password …]
 *                                            [--paths /cart,/my/orders,…] [--json out.json]
 *
 * 로그인한 상태로 각 주소를 **직접 열고**(= 새로고침과 같은 조건: /auth/me 응답 전 첫 렌더) 3초 뒤 어디에 있는지 본다.
 *   그대로 = 정상 · /login 으로 가 있으면 튕김
 * 이어서 비로그인으로 같은 주소를 열어 /login 으로 가는지, redirect 쿼리가 실리는지도 본다.
 *
 * 수정 전/후 같은 스크립트를 돌려 비교한다.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const args = parseArgs(process.argv.slice(2));
const BASE = args.base.replace(/\/$/, '');
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;
const PATHS = args.paths.split(',').map((p) => p.trim()).filter(Boolean);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = { base: BASE, loggedIn: [], anonymous: [] };

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', args.email);
  await page.fill('input[name="password"]', args.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 20000 });

  console.log('── 로그인 상태에서 주소로 직접 열기(=새로고침)');
  for (const path of PATHS) {
    const r = await visit(page, path);
    results.loggedIn.push(r);
    console.log(`${r.finalPath === path ? '✓ 그대로' : '✗ 튕김  '} ${path} → ${r.finalPath}${r.search}`);
  }
  await context.close();

  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await anon.route(SENTRY_RE, (route) => route.abort());
  const anonPage = await anon.newPage();
  console.log('── 비로그인으로 같은 주소 열기');
  for (const path of PATHS) {
    const r = await visit(anonPage, path);
    results.anonymous.push(r);
    console.log(`${r.finalPath === '/login' ? '✓ 로그인으로' : '✗ 그대로   '} ${path} → ${r.finalPath}${r.search}`);
  }
  await anon.close();
} finally {
  await browser.close();
}

if (args.json) {
  writeFileSync(args.json, JSON.stringify(results, null, 2));
  console.log(`JSON → ${args.json}`);
}

async function visit(page, path) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(3000);
  const url = new URL(page.url());
  return { path, finalPath: url.pathname, search: url.search };
}

function parseArgs(argv) {
  const out = {
    base: 'http://localhost:3100',
    email: 'a11y-buyer@test.local',
    password: 'A11yTest123!',
    paths: '/cart,/checkout,/my/orders,/my/reviews,/my,/my/wishlist,/my/inquiries,/my/password',
    json: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = argv[++i];
    else if (a === '--email') out.email = argv[++i];
    else if (a === '--password') out.password = argv[++i];
    else if (a === '--paths') out.paths = argv[++i];
    else if (a === '--json') out.json = argv[++i];
  }
  return out;
}
