/**
 * 비밀번호 변경 화면 확인 (05-buyer-flow-complete.md §6 ⑦).
 *
 *   node scripts/buyer-flow/verify-password.mjs [--base http://localhost:3100] [--api http://localhost:4000/v1]
 *                                               [--email …] [--password …] [--json out.json] [--shot dir]
 *
 * 보는 것:
 *   1. 화면 검증: 약한 비밀번호 · 확인 불일치 · 현재와 같은 비밀번호
 *   2. 틀린 현재 비밀번호 → 서버 메시지가 폼에 보인다(세션은 그대로)
 *   3. 성공 → 로그인 화면으로 이동 · 옛 access 토큰 401 · 옛 비밀번호 로그인 실패 · 새 비밀번호로 로그인 → /my 복귀
 *   4. 데모 계정: 폼 대신 안내
 *   5. axe(WCAG 2.1 A/AA) · 모바일 390px 가로 넘침
 *
 * ⚠ 측정 계정의 비밀번호를 실제로 바꾼다 — **끝에서 원래 비밀번호로 되돌린다**(실패해도 시도한다).
 *   되돌리기가 실패하면 그 계정을 쓰는 다른 스크립트(scripts/a11y, scripts/buyer-flow)가 로그인하지 못한다.
 *   데모 계정으로는 성공 경로를 절대 시험하지 않는다.
 */
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resetLoginRateLimits } from './lib.mjs';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;

const args = parseArgs(process.argv.slice(2));
const BASE = args.base.replace(/\/$/, '');
const API = args.api.replace(/\/$/, '');
const TEMP_PASSWORD = 'Temp-Verify-789!';

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 로그인 API. 429 면 기다렸다 다시 한다 — 두 가지 제한이 있다:
 *   · 로그인 횟수(IP 당 10회/5분, Redis) → resetLoginRateLimits 로 비운다
 *   · 전역 Throttler(100요청/60초, 메모리) → 비울 수 없어 기다린다. 개발 서버는 브라우저가 백엔드를 직접 불러
 *     화면 몇 개만 열어도 100요청을 넘긴다.
 */
async function apiLogin(password) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: args.email, password }),
    });
    if (res.status !== 429 || attempt >= 5) return res;
    await resetLoginRateLimits().catch(() => undefined);
    await sleep(15000);
  }
}

if (args.shot) mkdirSync(args.shot, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
let axeViolations = null;

try {
  await resetLoginRateLimits();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${BASE}/login?redirect=%2Fmy%2Fpassword`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', args.email);
  await page.fill('input[name="password"]', args.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/my/password', { timeout: 60000 });

  const current = page.getByLabel('현재 비밀번호');
  const next = page.getByLabel('새 비밀번호', { exact: true });
  const confirm = page.getByLabel('새 비밀번호 확인');
  const submit = page.getByRole('button', { name: '비밀번호 변경' });
  await submit.waitFor({ timeout: 30000 });
  const oldAccessToken = await page.evaluate(
    () => sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken'),
  );

  await page.locator('#nprogress').waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
  axeViolations = await runAxe(page);
  check('axe: 비밀번호 변경 화면 위반 0', axeViolations.length === 0, `${axeViolations.length}건`);
  check('입력칸이 모두 password 타입', (await page.locator('input[type="password"]').count()) === 3);
  if (args.shot) await page.screenshot({ path: `${args.shot}/my-password.png`, fullPage: true });

  // ── 1. 화면 검증 ─────────────────────────────────────────────────────────
  const fill = async (c, n, cf) => {
    await current.fill(c);
    await next.fill(n);
    await confirm.fill(cf);
    await submit.click();
  };
  await fill(args.password, 'abcd1234', 'abcd1234');
  check('검증: 약한 비밀번호(대문자·특수문자 없음)', await page.getByText(/대문자, 소문자, 숫자, 특수문자/).last().isVisible());
  await fill(args.password, TEMP_PASSWORD, 'Different-1!');
  check('검증: 확인 불일치', await page.getByText('새 비밀번호가 일치하지 않습니다.').isVisible());
  await fill(args.password, args.password, args.password);
  check('검증: 현재와 같은 비밀번호', await page.getByText('새 비밀번호는 현재 비밀번호와 달라야 합니다.').isVisible());

  // ── 2. 틀린 현재 비밀번호 ────────────────────────────────────────────────
  await fill('Wrong-pass-1!', TEMP_PASSWORD, TEMP_PASSWORD);
  await page.getByText('현재 비밀번호가 일치하지 않습니다.').waitFor({ timeout: 10000 });
  check('틀린 현재 비밀번호 → 서버 메시지가 폼에 보인다', true);
  check('실패 후에도 화면·세션 그대로', new URL(page.url()).pathname === '/my/password' && (await submit.isVisible()));

  // ── 3. 성공 ──────────────────────────────────────────────────────────────
  await fill(args.password, TEMP_PASSWORD, TEMP_PASSWORD);
  await page.waitForURL((u) => new URL(u).pathname === '/login', { timeout: 30000 });
  check('성공 → 로그인 화면으로 이동', new URL(page.url()).search === '?redirect=%2Fmy', new URL(page.url()).search);
  const leftover = await page.evaluate(
    () => sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken'),
  );
  check('브라우저에 access 토큰이 남지 않는다', !leftover);

  const meOld = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${oldAccessToken}` } });
  check('옛 access 토큰은 401', meOld.status === 401, `HTTP ${meOld.status}`);
  const oldLogin = await apiLogin(args.password);
  check('옛 비밀번호로는 로그인되지 않는다', oldLogin.status === 401, `HTTP ${oldLogin.status}`);

  await page.fill('input[name="email"]', args.email);
  await page.fill('input[name="password"]', TEMP_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/my', { timeout: 30000 });
  await page.getByRole('heading', { name: '프로필' }).waitFor({ timeout: 30000 });
  check('새 비밀번호로 로그인 → /my 복귀', true);

  await page.goto(`${BASE}/my/password`, { waitUntil: 'networkidle' });
  await page.setViewportSize({ width: 390, height: 844 });
  await submit.waitFor({ timeout: 30000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('모바일(390px): 가로 넘침 없음', overflow <= 0, `${overflow}px`);
  await context.close();

  // ── 4. 데모 계정 ─────────────────────────────────────────────────────────
  // 앞 단계의 요청이 전역 Throttler(100요청/60초) 한도에 닿아 있을 수 있다 — 창이 비워질 때까지 기다린다
  await sleep(62000);
  const demoCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await demoCtx.route(SENTRY_RE, (route) => route.abort());
  const demo = await demoCtx.newPage();
  await demo.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await demo.getByRole('button', { name: /관리자 페이지 체험하기/ }).click();
  await demo.waitForURL((u) => new URL(u).pathname === '/admin/dashboard', { timeout: 120000 });
  await demo.goto(`${BASE}/my/password`, { waitUntil: 'networkidle' });
  await demo.getByText('데모 계정은 비밀번호를 변경할 수 없습니다.').waitFor({ timeout: 30000 });
  check('데모 계정: 변경 불가 안내', true);
  check('데모 계정: 폼이 없다', (await demo.locator('input[type="password"]').count()) === 0);
  await demoCtx.close();
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n')[0]);
} finally {
  await browser.close();
  await restorePassword();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
if (args.json) {
  writeFileSync(args.json, JSON.stringify({ base: BASE, checks, axeViolations }, null, 2));
  console.log(`JSON → ${args.json}`);
}
process.exit(failed.length ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────────

/** 임시 비밀번호로 바뀌어 있으면 원래 비밀번호로 되돌린다 */
async function restorePassword() {
  const temp = await apiLogin(TEMP_PASSWORD);
  if (temp.status !== 201) {
    const original = await apiLogin(args.password);
    console.log(`정리: 비밀번호가 바뀌지 않은 상태(원래 비밀번호 로그인 HTTP ${original.status})`);
    return;
  }
  const { accessToken } = await temp.json();
  const res = await fetch(`${API}/users/me/password`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: TEMP_PASSWORD, newPassword: args.password }),
  });
  const verify = await apiLogin(args.password);
  console.log(`정리: 비밀번호 복원 HTTP ${res.status}, 원래 비밀번호 로그인 HTTP ${verify.status}`);
  check('정리: 측정 계정 비밀번호가 원래대로 돌아왔다', verify.status === 201);
}

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
    json: null,
    shot: null,
    headed: false,
  };
  const map = { '--base': 'base', '--api': 'api', '--email': 'email', '--password': 'password', '--json': 'json', '--shot': 'shot' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--headed') out.headed = true;
    else if (map[argv[i]]) out[map[argv[i]]] = argv[++i];
  }
  return out;
}
