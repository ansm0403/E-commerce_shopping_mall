/**
 * 셀러 문의 답변 화면 확인 (05-buyer-flow-complete.md §6 ③).
 *
 *   node scripts/buyer-flow/verify-seller-inquiry.mjs [--base http://localhost:3100] [--api http://localhost:4000/v1]
 *        [--product-id 521] [--buyer-email …] [--buyer-password …] [--seller-email seller1@seed.com] [--seller-password …]
 *        [--json out.json] [--shot dir] [--headed]
 *
 * 보는 것:
 *   1. 헤더 "셀러 센터" → /seller 가 빈 화면이 아니라 상품 관리로 간다 · 사이드바에 "문의"
 *   2. 미답변 탭에 방금 구매자가 쓴 문의(상품명 포함) → "답변하기" → 모달(공백만이면 등록 버튼 비활성)
 *   3. 답변 등록 → 미답변 탭에서 사라지고 답변 완료 탭에 나타난다 · "답변 보기" 는 읽기 전용
 *   4. 관리자 감사 로그에 INQUIRY_ANSWERED · 구매자의 상품 문의 탭에 "판매자 답변"
 *   5. axe(WCAG 2.1 A/AA) — 목록 화면과 모달이 열린 화면 · 모바일 390px 가로 넘침
 *
 * 전제: 로컬 백엔드·프론트, --product-id 는 --seller-email 셀러의 게시 상품. 문의는 구매자 API 로 만든다.
 * ⚠ 답변된 문의는 API 로 지울 수 없다(서버가 400) — 실행마다 로컬 DB 에 문의 1건이 남는다(제목 "확인용 셀러답변 <시각>").
 */
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { apiAuth } from '../a11y/lib.mjs';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;

const args = parseArgs(process.argv.slice(2));
const BASE = args.base.replace(/\/$/, '');
const API = args.api.replace(/\/$/, '');
const stamp = Date.now();
const TITLE = `확인용 셀러답변 ${stamp}`;
const ANSWER = `보통 2~3일 걸립니다. (${stamp})`;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

if (args.shot) mkdirSync(args.shot, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
const axe = {};

try {
  // 구매자가 문의 1건 작성(API)
  const buyerAuth = await apiAuth(API, args.buyerEmail, args.buyerPassword);
  const created = await fetch(`${API}/inquiries`, {
    method: 'POST',
    headers: buyerAuth,
    body: JSON.stringify({ productId: Number(args.productId), title: TITLE, content: '배송은 며칠 걸리나요?' }),
  });
  if (!created.ok) throw new Error(`문의 작성 실패 ${created.status} ${await created.text()}`);
  const inquiry = await created.json();

  // ── 1. 셀러 진입 ─────────────────────────────────────────────────────────
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();
  await login(page, args.sellerEmail, args.sellerPassword);

  await page.getByRole('button', { name: /님$/ }).click();
  await page.getByRole('button', { name: '셀러 센터' }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/seller/products', { timeout: 20000 });
  check('헤더 "셀러 센터" → /seller 가 상품 관리로 간다', true);

  const nav = page.getByRole('link', { name: '문의', exact: true });
  check('셀러 사이드바에 "문의" 가 있다', await nav.isVisible());
  await nav.click();
  await page.waitForURL((u) => new URL(u).pathname === '/seller/inquiries', { timeout: 20000 });

  // ── 2. 미답변 탭 → 모달 ──────────────────────────────────────────────────
  const row = page.getByRole('row').filter({ hasText: TITLE });
  await row.waitFor({ timeout: 15000 });
  check('미답변 탭(기본)에 방금 쓴 문의가 보인다', true);
  check('행에 상품명이 보인다', (await row.getByRole('link').count()) === 1, await row.getByRole('link').innerText());
  check('행 상태가 "미답변"', await row.getByText('미답변', { exact: true }).isVisible());

  // 페이지 이동 표시(NProgress)가 사라진 뒤에 잰다 — 그 라이브러리의 role="bar" 는 유효하지 않은 ARIA 역할이라 이동 직후엔 이 화면과 무관한 위반이 잡힌다
  const progressGone = await page.locator('#nprogress').waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false);
  check('페이지 이동 표시가 사라진다(멈춰 있지 않다)', progressGone);
  axe.list = await runAxe(page);
  check('axe: 목록 화면 위반 0', axe.list.length === 0, `${axe.list.length}건`);

  await row.getByRole('button', { name: '답변하기' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 5000 });
  const submit = dialog.getByRole('button', { name: '답변 등록' });
  check('모달: 열리면 포커스가 답변 입력칸', await dialog.getByLabel('답변').evaluate((el) => el === document.activeElement));
  check('모달: 비어 있으면 등록 버튼 비활성', await submit.isDisabled());
  await dialog.getByLabel('답변').fill('   ');
  check('모달: 공백만이면 등록 버튼 비활성', await submit.isDisabled());

  axe.modal = await runAxe(page);
  check('axe: 모달이 열린 화면 위반 0', axe.modal.length === 0, `${axe.modal.length}건`);
  if (args.shot) await page.screenshot({ path: `${args.shot}/seller-inquiry-modal.png` });

  // ── 3. 답변 등록 → 탭 이동 ───────────────────────────────────────────────
  await dialog.getByLabel('답변').fill(ANSWER);
  await submit.click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
  check('답변 등록: 모달이 닫히고 완료 문구', await page.getByText('답변이 등록되었습니다.').isVisible());
  await row.waitFor({ state: 'hidden', timeout: 10000 });
  check('답변 등록: 미답변 탭에서 사라진다', true);

  await page.getByRole('button', { name: '답변 완료', exact: true }).click();
  await page.waitForURL((u) => new URL(u).searchParams.get('status') === 'answered', { timeout: 10000 });
  await row.waitFor({ timeout: 10000 });
  check('답변 완료 탭에 나타난다', true);
  await row.getByRole('button', { name: '답변 보기' }).click();
  await dialog.waitFor({ timeout: 5000 });
  check('답변 보기: 등록한 답변이 보인다', await dialog.getByText(ANSWER).isVisible());
  check('답변 보기: 읽기 전용(입력칸·등록 버튼 없음)', (await dialog.getByRole('textbox').count()) === 0 && (await submit.count()) === 0);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5000 });
  check('모달: Esc 로 닫힌다', true);
  if (args.shot) await page.screenshot({ path: `${args.shot}/seller-inquiry-answered.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('모바일(390px): 페이지 가로 넘침 없음(표는 카드 안에서 스크롤)', overflow <= 0, `${overflow}px`);
  if (args.shot) await page.screenshot({ path: `${args.shot}/seller-inquiry-mobile.png`, fullPage: true });
  await context.close();

  // ── 4. 다른 쪽에서 보이는가 ──────────────────────────────────────────────
  const demo = await (await fetch(`${API}/auth/demo-login`, { method: 'POST' })).json();
  const logsRes = await fetch(`${API}/admin/audit-logs?page=1&take=20&action=INQUIRY_ANSWERED`, {
    headers: { Authorization: `Bearer ${demo.accessToken}` },
  });
  const logs = await logsRes.json();
  const logRows = logs.data ?? logs.items ?? [];
  const hit = logRows.find((l) => String(l.action).toUpperCase() === 'INQUIRY_ANSWERED');
  check('감사 로그에 INQUIRY_ANSWERED 가 남는다', logsRes.ok && !!hit, `HTTP ${logsRes.status}, ${logRows.length}행`);

  const buyerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await buyerCtx.route(SENTRY_RE, (route) => route.abort());
  const buyerPage = await buyerCtx.newPage();
  await buyerPage.goto(`${BASE}/products/${args.productId}`, { waitUntil: 'networkidle' });
  await buyerPage.getByRole('button', { name: '문의', exact: true }).click();
  await buyerPage.getByText(TITLE).waitFor({ timeout: 15000 });
  check('상품 문의 탭: "판매자 답변" 과 답변 본문이 보인다', await buyerPage.getByText(ANSWER).isVisible());
  await buyerCtx.close();

  const del = await fetch(`${API}/inquiries/${inquiry.id}`, { method: 'DELETE', headers: buyerAuth });
  check('답변된 문의는 구매자가 삭제할 수 없다(400)', del.status === 400, `HTTP ${del.status}`);
  console.log(`남은 문의: id=${inquiry.id} (로컬 DB — 답변 완료라 API 로 지울 수 없다)`);
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n')[0]);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
if (args.json) {
  writeFileSync(args.json, JSON.stringify({ base: BASE, productId: args.productId, checks, axe }, null, 2));
  console.log(`JSON → ${args.json}`);
}
process.exit(failed.length ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────────

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 20000 });
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
    productId: '521',
    buyerEmail: 'a11y-buyer@test.local',
    buyerPassword: 'A11yTest123!',
    sellerEmail: 'seller1@seed.com',
    sellerPassword: 'Seed1234!',
    json: null,
    shot: null,
    headed: false,
  };
  const map = {
    '--base': 'base',
    '--api': 'api',
    '--product-id': 'productId',
    '--buyer-email': 'buyerEmail',
    '--buyer-password': 'buyerPassword',
    '--seller-email': 'sellerEmail',
    '--seller-password': 'sellerPassword',
    '--json': 'json',
    '--shot': 'shot',
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--headed') out.headed = true;
    else if (map[argv[i]]) out[map[argv[i]]] = argv[++i];
  }
  return out;
}
