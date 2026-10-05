/**
 * 비밀번호 변경 뒤 "다른 기기" 화면이 실제로 로그아웃되는지 확인 (05-buyer-flow-complete.md §10 ⑦).
 *
 *   node scripts/buyer-flow/verify-session-revoke.mjs [--base http://localhost:3100] [--api http://localhost:4000/v1]
 *
 * 서버는 비밀번호 변경 시 "그 이전에 발급된 access 토큰"을 거절한다 — B 는 토큰이 만료되기 전이라도 바로 끊겨야 한다.
 * 대조로, 변경 전에는 B 의 access 토큰을 깨뜨려(만료 흉내) 갱신(refresh)으로 복구되는 것을 먼저 본다.
 * (변경 뒤에도 갱신이 통과하면 B 는 로그인 상태로 남는다 = 세션 폐기가 안 된 것)
 *
 * 순서: B 브라우저 로그인 → (대조) 변경 전에는 토큰을 깨뜨려도 갱신으로 복구된다
 *       → 다른 세션(API)이 비밀번호 변경
 *       → B(토큰 그대로) 가 보호 화면을 열면 바로 로그인으로 이동 · 헤더가 비로그인
 * 끝에서 측정 계정 비밀번호를 원래대로 되돌린다.
 */
import { chromium } from 'playwright-core';
import { resetLoginRateLimits } from './lib.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const BASE = arg('--base', 'http://localhost:3100').replace(/\/$/, '');
const API = arg('--api', 'http://localhost:4000/v1').replace(/\/$/, '');
const EMAIL = arg('--email', 'a11y-buyer@test.local');
const PASSWORD = arg('--password', 'A11yTest123!');
const TEMP_PASSWORD = 'Temp-Revoke-789!';
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiLogin(password) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password }),
    });
    if (res.status !== 429 || attempt >= 5) return res;
    await resetLoginRateLimits().catch(() => undefined);
    await sleep(15000);
  }
}
async function apiChangePassword(from, to) {
  const login = await apiLogin(from);
  if (login.status !== 201) return login.status;
  const { accessToken } = await login.json();
  const res = await fetch(`${API}/users/me/password`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: from, newPassword: to }),
  });
  return res.status;
}

/** access 토큰 만료 흉내 — 저장된 토큰을 서명이 틀린 값으로 바꾼다(다음 요청이 401) */
const breakAccessToken = (page) =>
  page.evaluate(() => {
    for (const store of [sessionStorage, localStorage]) {
      if (store.getItem('accessToken')) store.setItem('accessToken', `${store.getItem('accessToken')}x`);
    }
  });
const headerShowsUser = async (page) => (await page.getByRole('button', { name: /님$/ }).count()) > 0;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let changed = false;
try {
  await resetLoginRateLimits();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${BASE}/login?redirect=%2Fmy`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/my', { timeout: 60000 });
  await page.getByRole('heading', { name: '프로필' }).waitFor({ timeout: 30000 });

  // 대조: 비밀번호를 바꾸기 전에는 토큰이 만료돼도 갱신으로 조용히 복구된다
  await breakAccessToken(page);
  await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  check(
    '대조(변경 전): 토큰 만료를 흉내 내도 갱신돼 /my 그대로',
    new URL(page.url()).pathname === '/my' && (await headerShowsUser(page)),
    new URL(page.url()).pathname,
  );

  // 다른 세션이 비밀번호를 바꾼다
  const status = await apiChangePassword(PASSWORD, TEMP_PASSWORD);
  changed = status === 200;
  check('다른 세션에서 비밀번호 변경', changed, `HTTP ${status}`);

  // B 의 access 토큰은 **건드리지 않는다**(아직 만료 전). 그래도 서버가 "변경 이전 발급분"을 거절하므로
  // 다음 요청에서 바로 401 → 갱신도 거절 → 로그인으로 가야 한다(15분을 기다리지 않는다).
  await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await page.waitForURL((u) => new URL(u).pathname === '/login', { timeout: 30000 }).catch(() => undefined);
  check('변경 직후(토큰 만료 전): 보호 화면이 바로 로그인으로 보낸다', new URL(page.url()).pathname === '/login', page.url().replace(BASE, ''));
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  check('변경 직후: 홈의 헤더가 비로그인 상태', !(await headerShowsUser(page)));
  await context.close();
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n')[0]);
} finally {
  await browser.close();
  if (changed) {
    const restore = await apiChangePassword(TEMP_PASSWORD, PASSWORD);
    const verify = await apiLogin(PASSWORD);
    console.log(`정리: 비밀번호 복원 HTTP ${restore}, 원래 비밀번호 로그인 HTTP ${verify.status}`);
    check('정리: 측정 계정 비밀번호가 원래대로 돌아왔다', verify.status === 201);
  }
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
