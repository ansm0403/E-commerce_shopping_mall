/**
 * 상품 상세 "문의" 탭 확인 (05-buyer-flow-complete.md §6 ②).
 *
 *   node scripts/buyer-flow/verify-inquiry-tab.mjs [--base http://localhost:3100] [--api http://localhost:4000/v1]
 *                                                   [--email a11y-buyer@test.local] [--password ...] [--product-id 521] [--no-seller-product-id 127]
 *                                                   [--json out.json] [--shot dir] [--headed]
 *
 * 보는 것:
 *   1. 비로그인: 폼 대신 로그인 링크(돌아올 경로 포함) · 목록은 보인다
 *   2. 구매자: 빈 제출 → 검증 문구 · 일반 문의 등록 → 목록에 즉시 · 폼 초기화 · 비밀글 등록 → 본인에게는 본문이 보인다
 *   3. 다시 비로그인: 방금 쓴 비밀글이 "비밀 문의입니다." 로 가려진다
 *   4. axe(WCAG 2.1 A/AA) — 문의 탭이 열린 화면(로그인 상태)
 *
 * 전제: 로컬 백엔드·프론트가 떠 있고, --product-id 상품에 셀러가 있다(시드 상품은 전부 셀러가 없다 — 로컬에 따로 만든다). 계정은 로컬 DB 의 측정 계정(운영 무접촉).
 * 만든 문의는 끝에서 API 로 지운다(실패해도 지운다).
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
const PRODUCT_PATH = `/products/${args.productId}`;
const stamp = Date.now();
const NORMAL_TITLE = `확인용 일반 문의 ${stamp}`;
const SECRET_TITLE = `확인용 비밀 문의 ${stamp}`;
const SECRET_BODY = `비밀 본문 ${stamp}`;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

if (args.shot) mkdirSync(args.shot, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
let axeViolations = null;

try {
  // ── 1. 비로그인 ──────────────────────────────────────────────────────────
  const anon = await newPage();
  await openInquiryTab(anon);
  const loginLink = anon.getByRole('link', { name: '로그인' }).last();
  check('비로그인: 로그인 링크가 보인다', await loginLink.isVisible());
  check(
    '비로그인: 링크에 돌아올 경로가 실린다',
    (await loginLink.getAttribute('href')) === `/login?redirect=${encodeURIComponent(PRODUCT_PATH)}`,
    await loginLink.getAttribute('href'),
  );
  check('비로그인: 작성 폼이 없다', (await anon.getByRole('button', { name: '문의 등록' }).count()) === 0);

  // 셀러 없는 상품(시드 상품)은 서버가 문의를 받지 않는다 — 폼·로그인 링크 대신 안내
  if (args.noSellerProductId) {
    await openInquiryTab(anon, `/products/${args.noSellerProductId}`);
    check(
      '셀러 없는 상품: 문의 불가 안내가 보인다',
      await anon.getByText('판매자가 등록되지 않은 상품이라 문의를 받을 수 없습니다.').isVisible(),
    );
  }
  await anon.context().close();

  // ── 2. 구매자 ────────────────────────────────────────────────────────────
  const buyer = await newPage();
  await login(buyer);
  await openInquiryTab(buyer);
  const submit = buyer.getByRole('button', { name: '문의 등록' });
  check('구매자: 작성 폼이 보인다', await submit.isVisible());

  await submit.click();
  check('빈 제출: 제목 검증 문구', await buyer.getByText('제목은 2자 이상 입력해주세요.').isVisible());
  check('빈 제출: 내용 검증 문구', await buyer.getByText('문의 내용을 입력해주세요.').isVisible());

  await buyer.getByLabel('제목', { exact: true }).fill(NORMAL_TITLE);
  await buyer.getByLabel('내용', { exact: true }).fill('배송은 며칠 걸리나요?');
  await submit.click();
  await buyer.getByText('문의가 등록되었습니다.').waitFor({ timeout: 10000 });
  await buyer.getByText(NORMAL_TITLE).waitFor({ timeout: 10000 });
  check('일반 문의: 새로고침 없이 목록에 나타난다', true);
  check('일반 문의: 폼이 비워진다', (await buyer.getByLabel('제목', { exact: true }).inputValue()) === '');

  await buyer.getByLabel('제목', { exact: true }).fill(SECRET_TITLE);
  await buyer.getByLabel('내용', { exact: true }).fill(SECRET_BODY);
  await buyer.getByLabel(/비밀글로 작성/).check();
  await submit.click();
  await buyer.getByText(SECRET_TITLE).waitFor({ timeout: 10000 });
  check('비밀글: 작성자 본인에게는 제목이 보인다', true);
  check('비밀글: 작성자 본인에게는 본문이 보인다', await buyer.getByText(SECRET_BODY).isVisible());

  // 새로고침해도 본인 비밀글이 풀려 있는지(토큰을 실어 조회하는지)
  await openInquiryTab(buyer);
  await buyer.getByText(NORMAL_TITLE).waitFor({ timeout: 10000 });
  check('비밀글: 새로고침 뒤에도 본인에게 본문이 보인다', await buyer.getByText(SECRET_BODY).isVisible());

  axeViolations = await runAxe(buyer);
  check('axe(WCAG 2.1 A/AA): 문의 탭 위반 0', axeViolations.length === 0, `${axeViolations.length}건`);
  if (args.shot) await buyer.screenshot({ path: `${args.shot}/inquiry-tab-buyer.png`, fullPage: true });
  await buyer.context().close();

  // ── 3. 다시 비로그인 — 비밀글 마스킹 ──────────────────────────────────────
  const anon2 = await newPage();
  await openInquiryTab(anon2);
  await anon2.getByText(NORMAL_TITLE).waitFor({ timeout: 10000 });
  check('타인(비로그인): 일반 문의는 보인다', true);
  check('타인(비로그인): 비밀글 제목이 보이지 않는다', (await anon2.getByText(SECRET_TITLE).count()) === 0);
  check('타인(비로그인): 비밀글 본문이 보이지 않는다', (await anon2.getByText(SECRET_BODY).count()) === 0);
  check('타인(비로그인): "비밀 문의입니다." 로 표시', (await anon2.getByText('비밀 문의입니다.').count()) > 0);
  if (args.shot) await anon2.screenshot({ path: `${args.shot}/inquiry-tab-anonymous.png`, fullPage: true });

  // 모바일 폭
  await anon2.setViewportSize({ width: 390, height: 844 });
  await anon2.waitForTimeout(300);
  const overflow = await anon2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('모바일(390px): 가로 넘침 없음', overflow <= 0, `${overflow}px`);
  if (args.shot) await anon2.screenshot({ path: `${args.shot}/inquiry-tab-mobile.png`, fullPage: true });
  await anon2.context().close();
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n')[0]);
} finally {
  await browser.close();
  await cleanup();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
if (args.json) {
  writeFileSync(args.json, JSON.stringify({ base: BASE, productId: args.productId, checks, axeViolations }, null, 2));
  console.log(`JSON → ${args.json}`);
}
process.exit(failed.length ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────────

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  return context.newPage();
}

async function openInquiryTab(page, path = PRODUCT_PATH) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '문의', exact: true }).click();
  await page.getByRole('heading', { name: /상품 문의/ }).waitFor({ timeout: 15000 });
  // 목록 조회가 끝날 때까지
  await page.getByText('문의를 불러오는 중...').waitFor({ state: 'hidden', timeout: 15000 });
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', args.email);
  await page.fill('input[name="password"]', args.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });
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

/** 이 실행이 만든 문의만 지운다(제목에 실행 시각이 들어 있다) */
async function cleanup() {
  try {
    const auth = await apiAuth(API, args.email, args.password);
    const my = await (await fetch(`${API}/inquiries/my?page=1&take=100`, { headers: auth })).json();
    const mine = (my.data ?? []).filter((i) => i.title.includes(String(stamp)));
    for (const inquiry of mine) {
      await fetch(`${API}/inquiries/${inquiry.id}`, { method: 'DELETE', headers: auth });
    }
    console.log(`정리: 문의 ${mine.length}건 삭제`);
  } catch (error) {
    console.log(`정리 실패: ${error?.message ?? error}`);
  }
}

function parseArgs(argv) {
  const out = {
    base: 'http://localhost:3100',
    api: 'http://localhost:4000/v1',
    email: 'a11y-buyer@test.local',
    password: 'A11yTest123!',
    productId: '521',
    noSellerProductId: '127',
    json: null,
    shot: null,
    headed: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headed') out.headed = true;
    else if (a === '--base') out.base = argv[++i];
    else if (a === '--api') out.api = argv[++i];
    else if (a === '--email') out.email = argv[++i];
    else if (a === '--password') out.password = argv[++i];
    else if (a === '--product-id') out.productId = argv[++i];
    else if (a === '--no-seller-product-id') out.noSellerProductId = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--shot') out.shot = argv[++i];
  }
  return out;
}
