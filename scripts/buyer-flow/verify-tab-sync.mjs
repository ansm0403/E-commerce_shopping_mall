/**
 * 탭 간 로그인 상태 동기화 확인 (05-buyer-flow-complete.md §10).
 *
 *   node scripts/buyer-flow/verify-tab-sync.mjs [--base http://localhost:3100] [--email …] [--password …]
 *
 * 같은 브라우저의 탭 두 개(A·B)로:
 *   1. 둘 다 로그인 상태 → A 에서 로그아웃 → B 도 로그아웃(보호 화면이면 로그인으로)
 *   2. A 에서 다시 로그인 → B 가 **새로고침 없이** 로그인 상태가 되는가
 *   3. B 가 로그인 화면에 머물러 있었다면 → 로그인 화면을 벗어나는가(이미 로그인된 사람에게 로그인 폼을 보여 주지 않는다)
 * "로그인 유지"를 끈 경우(access 토큰이 탭마다 따로인 sessionStorage 모드)를 본다 — 켠 경우는 localStorage 를 공유해 쉬운 쪽이다.
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
const path = (page) => new URL(page.url()).pathname;
const loggedIn = async (page) => (await page.getByRole('button', { name: /님$/ }).count()) > 0;
const login = async (page) => {
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await resetLoginRateLimits();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const a = await context.newPage();
  await a.goto(`${BASE}/login`, { waitUntil: 'load' });
  await login(a);
  await a.waitForURL((u) => new URL(u).pathname === '/', { timeout: 60000 });

  // B: 새 탭 — 토큰은 탭마다 따로라, 열릴 때 A 에게 토큰을 받아 온다
  const b = await context.newPage();
  await b.goto(`${BASE}/my`, { waitUntil: 'load' });
  await b.getByRole('heading', { name: '프로필' }).waitFor({ timeout: 60000 });
  check('새 탭(B)은 열리자마자 로그인 상태(/my)', path(b) === '/my');

  // ── 1. A 로그아웃 → B ────────────────────────────────────────────────────
  await a.getByRole('button', { name: /님$/ }).click();
  await a.getByRole('button', { name: '로그아웃', exact: true }).click();
  await a.getByRole('button', { name: '로그아웃', exact: true }).last().click();
  await b.waitForURL((u) => new URL(u).pathname === '/login', { timeout: 30000 }).catch(() => undefined);
  check('A 로그아웃 → B(보호 화면)도 로그인으로 이동', path(b) === '/login', b.url().replace(BASE, ''));

  // ── 2·3. A 다시 로그인 → B(로그인 화면에 머물러 있음) ─────────────────────
  await a.goto(`${BASE}/login`, { waitUntil: 'load' });
  await login(a);
  await a.waitForURL((u) => new URL(u).pathname === '/', { timeout: 60000 });
  await b.waitForURL((u) => new URL(u).pathname !== '/login', { timeout: 15000 }).catch(() => undefined);
  check('A 로그인 → B 가 새로고침 없이 로그인 화면을 벗어난다', path(b) !== '/login', b.url().replace(BASE, ''));
  check('… 그리고 원래 가려던 곳(/my)으로 간다', path(b) === '/my', path(b));

  await b.goto(`${BASE}/login`, { waitUntil: 'load' });
  await b.waitForURL((u) => new URL(u).pathname !== '/login', { timeout: 15000 }).catch(() => undefined);
  check('로그인 상태에서 /login 을 직접 열면 로그인 폼에 머물지 않는다', path(b) !== '/login', path(b));

  // 공개 화면에 있던 탭은 헤더가 바뀌는가
  await b.goto(`${BASE}/products`, { waitUntil: 'load' });
  await b.getByRole('button', { name: /님$/ }).waitFor({ timeout: 30000 });
  await a.getByRole('button', { name: /님$/ }).click();
  await a.getByRole('button', { name: '로그아웃', exact: true }).click();
  await a.getByRole('button', { name: '로그아웃', exact: true }).last().click();
  await b.getByRole('button', { name: /님$/ }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => undefined);
  check('A 로그아웃 → B(공개 화면)의 헤더가 비로그인으로', !(await loggedIn(b)));
  await a.goto(`${BASE}/login`, { waitUntil: 'load' });
  await login(a);
  await a.waitForURL((u) => new URL(u).pathname === '/', { timeout: 60000 });
  await b.getByRole('button', { name: /님$/ }).waitFor({ timeout: 15000 }).catch(() => undefined);
  check('A 로그인 → B(공개 화면)의 헤더가 새로고침 없이 로그인 상태로', await loggedIn(b));
  await context.close();
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n').slice(0, 3).join(' / '));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
