/**
 * 내 문의 화면 확인 (05-buyer-flow-complete.md §6 ⑤).
 *
 *   node scripts/buyer-flow/verify-my-inquiries.mjs [--base http://localhost:3100] [--api http://localhost:4000/v1]
 *        [--product-id 521] [--email …] [--password …] [--seller-email …] [--seller-password …] [--json out.json] [--shot dir]
 *
 * 준비(API): 구매자가 문의 2건 작성 → 셀러가 그중 1건에 답변.
 * 보는 것:
 *   1. 마이페이지 네비 "내 문의" → 목록에 두 건 · 상품 링크
 *   2. 답변된 문의: "판매자 답변" 본문이 보이고 **삭제 버튼이 없다**
 *   3. 답변 대기 문의: 삭제 버튼 → 확인 모달(취소하면 그대로) → 삭제 → 목록에서 사라짐
 *   4. axe(WCAG 2.1 A/AA, 목록·모달) · 모바일 390px 가로 넘침
 *
 * ⚠ 답변된 문의는 API 로 지울 수 없다 — 실행마다 로컬 DB 에 1건이 남는다(제목 "확인용 내문의-답변 <시각>").
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
const ANSWERED_TITLE = `확인용 내문의-답변 ${stamp}`;
const WAITING_TITLE = `확인용 내문의-대기 ${stamp}`;
const ANSWER = `재입고는 다음 주입니다. (${stamp})`;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

if (args.shot) mkdirSync(args.shot, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
const axe = {};
let buyerAuth = null;

try {
  buyerAuth = await apiAuth(API, args.email, args.password);
  const sellerAuth = await apiAuth(API, args.sellerEmail, args.sellerPassword);
  const create = async (title) => {
    const res = await fetch(`${API}/inquiries`, {
      method: 'POST',
      headers: buyerAuth,
      body: JSON.stringify({ productId: Number(args.productId), title, content: '재입고 예정이 있나요?' }),
    });
    if (!res.ok) throw new Error(`문의 작성 실패 ${res.status} ${await res.text()}`);
    return res.json();
  };
  const answered = await create(ANSWERED_TITLE);
  await create(WAITING_TITLE);
  const ans = await fetch(`${API}/seller/inquiries/${answered.id}/answer`, {
    method: 'PATCH',
    headers: sellerAuth,
    body: JSON.stringify({ answer: ANSWER }),
  });
  if (!ans.ok) throw new Error(`답변 실패 ${ans.status} ${await ans.text()}`);

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${BASE}/login?redirect=%2Fmy`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', args.email);
  await page.fill('input[name="password"]', args.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/my', { timeout: 20000 });

  // ── 1. 진입 ──────────────────────────────────────────────────────────────
  await page.getByRole('navigation', { name: '마이페이지' }).getByRole('link', { name: '내 문의' }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/my/inquiries', { timeout: 15000 });
  await page.getByText(WAITING_TITLE).waitFor({ timeout: 15000 });
  check('네비 "내 문의" → 목록에 방금 쓴 두 건', await page.getByText(ANSWERED_TITLE).isVisible());
  const productLink = page.getByRole('link', { name: /문의 테스트 상품|상품 #/ }).first();
  check('상품 링크가 상품 상세로 간다', (await productLink.getAttribute('href')) === `/products/${args.productId}`, await productLink.innerText());

  // ── 2. 답변된 문의 ───────────────────────────────────────────────────────
  // 문의 한 건 = 제목을 품은 가장 가까운 항목(div.py-4)
  const itemOf = (title) => page.locator('div.py-4').filter({ hasText: title });
  check('답변된 문의: 답변 본문이 보인다', await itemOf(ANSWERED_TITLE).getByText(ANSWER).isVisible());
  check('답변된 문의: "답변 완료" 배지', await itemOf(ANSWERED_TITLE).getByText('답변 완료', { exact: true }).isVisible());
  check('답변된 문의: 삭제 버튼이 없다', (await itemOf(ANSWERED_TITLE).getByRole('button', { name: '삭제' }).count()) === 0);

  // 페이지 이동 표시(NProgress)가 사라진 뒤에 잰다 — 그 라이브러리의 role="bar"·"spinner" 는 유효하지 않은 ARIA 역할이라
  // 이동 직후에 재면 이 화면과 무관한 위반 1건이 잡힌다(전역 기존 문제, 화면에 머무는 시간은 이동 중 잠깐).
  await page.locator('#nprogress').waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
  axe.list = await runAxe(page);
  check('axe: 목록 화면 위반 0', axe.list.length === 0, `${axe.list.length}건`);
  if (args.shot) await page.screenshot({ path: `${args.shot}/my-inquiries.png`, fullPage: true });

  // ── 3. 답변 대기 문의 삭제 ───────────────────────────────────────────────
  check('답변 대기 문의: "답변 대기" 배지', await itemOf(WAITING_TITLE).getByText('답변 대기', { exact: true }).isVisible());
  await itemOf(WAITING_TITLE).getByRole('button', { name: '삭제' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 5000 });
  check('삭제: 확인 모달에 문의 제목이 보인다', await dialog.getByText(WAITING_TITLE).isVisible());
  // 모달이 나타나는 애니메이션이 끝난 뒤에 잰다(도중에 재면 반투명 상태의 색이 대비 위반으로 잡힌다)
  await page.waitForTimeout(600);
  axe.modal = await runAxe(page);
  check('axe: 모달이 열린 화면 위반 0', axe.modal.length === 0, `${axe.modal.length}건`);

  await dialog.getByRole('button', { name: '취소' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 5000 });
  check('삭제: 취소하면 문의가 그대로', await page.getByText(WAITING_TITLE).isVisible());

  await itemOf(WAITING_TITLE).getByRole('button', { name: '삭제' }).click();
  await dialog.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByText('문의가 삭제되었습니다.').waitFor({ timeout: 10000 });
  await page.getByText(WAITING_TITLE).waitFor({ state: 'hidden', timeout: 10000 });
  check('삭제: 완료 문구가 뜨고 목록에서 사라진다', true);
  check('삭제 후에도 답변된 문의는 남아 있다', await page.getByText(ANSWERED_TITLE).isVisible());

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(ANSWERED_TITLE).waitFor({ timeout: 15000 });
  check('새로고침해도 /my/inquiries 그대로', new URL(page.url()).pathname === '/my/inquiries');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('모바일(390px): 가로 넘침 없음', overflow <= 0, `${overflow}px`);
  if (args.shot) await page.screenshot({ path: `${args.shot}/my-inquiries-mobile.png`, fullPage: true });
  await context.close();
  console.log(`남은 문의: id=${answered.id} (로컬 DB — 답변 완료라 API 로 지울 수 없다)`);
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n')[0]);
} finally {
  await browser.close();
  // 실패로 남았을 수 있는 대기 문의 정리
  if (buyerAuth) {
    const my = await (await fetch(`${API}/inquiries/my?page=1&take=100`, { headers: buyerAuth })).json();
    for (const i of (my.data ?? []).filter((x) => x.title === WAITING_TITLE)) {
      await fetch(`${API}/inquiries/${i.id}`, { method: 'DELETE', headers: buyerAuth });
    }
  }
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
if (args.json) {
  writeFileSync(args.json, JSON.stringify({ base: BASE, checks, axe }, null, 2));
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
    productId: '521',
    email: 'a11y-buyer@test.local',
    password: 'A11yTest123!',
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
    '--email': 'email',
    '--password': 'password',
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
