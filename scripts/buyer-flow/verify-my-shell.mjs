/**
 * 마이페이지 셸 + 프로필 홈 확인 (05-buyer-flow-complete.md §6 ④).
 *
 *   node scripts/buyer-flow/verify-my-shell.mjs [--base http://localhost:3100] [--api http://localhost:4000/v1]
 *                                               [--email …] [--password …] [--json out.json] [--shot dir]
 *
 * 보는 것:
 *   1. 비로그인으로 /my 주소 진입 → 로그인 → **원래 경로(/my)로 복귀**
 *   2. 셸: 네비 7개, 현재 화면에 aria-current · 네비 클릭으로 하위 화면 이동
 *   3. 프로필: 표시 → 수정(검증 문구) → 저장 → **새로고침해도 유지** · 헤더 닉네임 반영 · 끝나면 원래 값으로 되돌림
 *   4. 장바구니에 상품이 있을 때 /checkout 새로고침이 그대로인지(빈 장바구니면 /cart 로 가는 것은 정상 동작)
 *   5. 데모 계정: 수정 버튼 대신 안내
 *   6. axe(WCAG 2.1 A/AA) · 모바일 390px 가로 넘침
 *
 * 전제: 로컬 백엔드·프론트. 계정은 로컬 DB 의 측정 계정(운영 무접촉).
 */
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { apiAuth, cartItems } from '../a11y/lib.mjs';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;

const args = parseArgs(process.argv.slice(2));
const BASE = args.base.replace(/\/$/, '');
const API = args.api.replace(/\/$/, '');
const NEW_NICK = `확인${String(Date.now()).slice(-6)}`;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

if (args.shot) mkdirSync(args.shot, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
let axeViolations = null;
let auth = null;
let original = null;
let addedCartItem = false;

try {
  auth = await apiAuth(API, args.email, args.password);
  original = await (await fetch(`${API}/users/me`, { headers: auth })).json();

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();

  // ── 1. 비로그인 /my → 로그인 → 복귀 ───────────────────────────────────────
  await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await page.waitForURL((u) => new URL(u).pathname === '/login', { timeout: 15000 });
  check('비로그인 /my → 로그인 화면', new URL(page.url()).search === '?redirect=%2Fmy', new URL(page.url()).search);
  await page.fill('input[name="email"]', args.email);
  await page.fill('input[name="password"]', args.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/my', { timeout: 20000 });
  check('로그인 후 원래 경로(/my)로 복귀', true);

  // ── 2. 셸 ────────────────────────────────────────────────────────────────
  const nav = page.getByRole('navigation', { name: '마이페이지' });
  check('셸: 네비 항목 7개', (await nav.getByRole('link').count()) === 7, `${await nav.getByRole('link').count()}개`);
  check(
    '셸: 현재 화면에 aria-current',
    (await nav.getByRole('link', { name: '내 정보' }).getAttribute('aria-current')) === 'page',
  );
  await page.getByRole('heading', { name: '프로필' }).waitFor({ timeout: 15000 });
  await page.getByText(original.email).waitFor({ timeout: 15000 });
  check('프로필: 이메일·닉네임이 보인다', await page.getByText(original.nickName, { exact: true }).first().isVisible());

  axeViolations = await runAxe(page);
  check('axe: /my 위반 0', axeViolations.length === 0, `${axeViolations.length}건`);
  if (args.shot) await page.screenshot({ path: `${args.shot}/my-home.png`, fullPage: true });

  // ── 3. 프로필 수정 ───────────────────────────────────────────────────────
  await page.getByRole('button', { name: '수정' }).click();
  const nick = page.getByLabel('닉네임');
  await nick.fill('가');
  await page.getByRole('button', { name: '저장' }).click();
  check('수정: 1자 닉네임 → 검증 문구', await page.getByText('닉네임은 2자 이상 입력해주세요.').isVisible());
  await nick.fill(NEW_NICK);
  await page.getByRole('button', { name: '저장' }).click();
  await page.getByText('프로필이 수정되었습니다.').waitFor({ timeout: 10000 });
  check('수정: 저장 후 완료 문구', true);
  await page.getByRole('button', { name: `${NEW_NICK}님` }).waitFor({ timeout: 10000 });
  check('수정: 헤더 닉네임에 반영', true);

  await page.reload({ waitUntil: 'networkidle' });
  check('새로고침해도 /my 그대로(로그인으로 튕기지 않음)', new URL(page.url()).pathname === '/my');
  await page.getByText(NEW_NICK, { exact: true }).first().waitFor({ timeout: 15000 });
  check('새로고침해도 수정한 닉네임 유지', true);

  // 네비 클릭 이동
  await nav.getByRole('link', { name: '주문 내역' }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/my/orders', { timeout: 15000 });
  check(
    '네비 클릭 → /my/orders, 셸 유지',
    (await nav.getByRole('link', { name: '주문 내역' }).getAttribute('aria-current')) === 'page',
  );
  if (args.shot) await page.screenshot({ path: `${args.shot}/my-orders-in-shell.png`, fullPage: true });

  // ── 4. 장바구니가 있을 때 /checkout 새로고침 ──────────────────────────────
  if ((await cartItems(API, auth)).length === 0) {
    const add = await fetch(`${API}/cart/items`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ productId: Number(args.productId), quantity: 1 }),
    });
    addedCartItem = add.ok;
  }
  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  check('장바구니에 상품이 있으면 /checkout 직접 진입이 그대로', new URL(page.url()).pathname === '/checkout', new URL(page.url()).pathname);

  // 모바일
  await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: '프로필' }).waitFor({ timeout: 15000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('모바일(390px): 페이지 가로 넘침 없음(네비는 자체 가로 스크롤)', overflow <= 0, `${overflow}px`);
  if (args.shot) await page.screenshot({ path: `${args.shot}/my-home-mobile.png`, fullPage: true });
  await context.close();

  // ── 5. 데모 계정 ─────────────────────────────────────────────────────────
  const demoCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await demoCtx.route(SENTRY_RE, (route) => route.abort());
  const demo = await demoCtx.newPage();
  await demo.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await demo.getByRole('button', { name: /관리자 페이지 체험하기/ }).click();
  await demo.waitForURL((u) => new URL(u).pathname === '/admin/dashboard', { timeout: 20000 });
  await demo.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await demo.getByRole('heading', { name: '프로필' }).waitFor({ timeout: 15000 });
  await demo.getByText('데모 계정은 프로필을 변경할 수 없습니다.').waitFor({ timeout: 10000 });
  check('데모 계정: 변경 불가 안내가 보인다', true);
  check('데모 계정: 수정 버튼이 없다', (await demo.getByRole('button', { name: '수정' }).count()) === 0);
  await demoCtx.close();
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n')[0]);
} finally {
  await browser.close();
  // 원래 값으로 되돌린다
  if (auth && original) {
    const restore = await fetch(`${API}/users/me`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ nickName: original.nickName }),
    });
    console.log(`정리: 닉네임 복원 HTTP ${restore.status}`);
    if (addedCartItem) {
      const clear = await fetch(`${API}/cart`, { method: 'DELETE', headers: auth });
      console.log(`정리: 장바구니 비우기 HTTP ${clear.status}`);
    }
  }
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
if (args.json) {
  writeFileSync(args.json, JSON.stringify({ base: BASE, checks, axeViolations }, null, 2));
  console.log(`JSON → ${args.json}`);
}
process.exit(failed.length ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────────

async function runAxe(page) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async (tags) => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return res.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160), summary: n.failureSummary })),
    }));
  }, TAGS);
}

function parseArgs(argv) {
  const out = {
    base: 'http://localhost:3100',
    api: 'http://localhost:4000/v1',
    email: 'a11y-buyer@test.local',
    password: 'A11yTest123!',
    productId: '521',
    json: null,
    shot: null,
    headed: false,
  };
  const map = {
    '--base': 'base',
    '--api': 'api',
    '--email': 'email',
    '--password': 'password',
    '--product-id': 'productId',
    '--json': 'json',
    '--shot': 'shot',
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--headed') out.headed = true;
    else if (map[argv[i]]) out[map[argv[i]]] = argv[++i];
  }
  return out;
}
