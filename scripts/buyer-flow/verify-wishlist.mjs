/**
 * 위시리스트 + 찜 초기 상태 확인 (05-buyer-flow-complete.md §6 ⑥ · F3).
 *
 *   node scripts/buyer-flow/verify-wishlist.mjs [--base http://localhost:3100] [--api http://localhost:4000/v1]
 *        [--product-id 521] [--other-product-id 127] [--email …] [--password …] [--json out.json] [--shot dir]
 *
 * 보는 것:
 *   1. 낙관적 갱신: 토글 응답을 1.5초 늦춰도 하트가 **응답 전에** 채워진다
 *   2. F3: 찜한 상품을 새로고침해도 하트가 채워져 있다
 *   3. 롤백: 토글이 500 으로 실패하면 하트가 원래대로 돌아온다
 *   4. 위시리스트 화면: 찜한 상품이 보인다 · 장바구니 담기 · 빼기 → 사라짐 → 상품 상세 하트가 빈 상태
 *   5. 전체 비우기: 확인 모달 → 빈 화면
 *   6. 카드 사진: 셀러가 올린 사진(/uploads)과 시드 상품의 외부 링크가 둘 다 실제로 그려진다
 *   7. axe(WCAG 2.1 A/AA) · 모바일 390px 가로 넘침
 *
 * 전제: 로컬 백엔드·프론트, 측정 계정(로컬 DB). 시작·끝에 그 계정의 찜과 장바구니를 비운다.
 */
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { apiAuth } from '../a11y/lib.mjs';
import { makePng } from './lib.mjs';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;
// 개발 서버는 API 를 백엔드로 직접 부르고(http://localhost:4000/v1/…), 운영 빌드는 /api/… 프록시를 쓴다 — 둘 다 잡는다
const TOGGLE_RE = /\/wishlist\/toggle$/;

const args = parseArgs(process.argv.slice(2));
const BASE = args.base.replace(/\/$/, '');
const API = args.api.replace(/\/$/, '');
const PRODUCT = `/products/${args.productId}`;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

if (args.shot) mkdirSync(args.shot, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
let axeViolations = null;
let auth = null;

const resetAccount = async () => {
  await fetch(`${API}/wishlist`, { method: 'DELETE', headers: auth });
  await fetch(`${API}/cart`, { method: 'DELETE', headers: auth });
};
const serverIds = async () => (await (await fetch(`${API}/wishlist/ids`, { headers: auth })).json()).productIds;

try {
  auth = await apiAuth(API, args.email, args.password);
  await resetAccount();

  // 셀러가 **실제로 올린 사진**이 위시리스트에 뜨는지 보려면 /uploads 사진이 있는 상품이 필요하다 — 없으면 셀러 계정으로 한 장 올린다
  const detail = await (await fetch(`${API}/products/${args.productId}`)).json();
  if (!(detail.images ?? []).some((img) => String(img.url).startsWith('/uploads/'))) {
    const sellerAuth = await apiAuth(API, args.sellerEmail, args.sellerPassword);
    const form = new FormData();
    form.append('file', new Blob([makePng()], { type: 'image/png' }), 'verify-wishlist.png');
    const upload = await fetch(`${API}/products/${args.productId}/images`, {
      method: 'POST',
      headers: { Authorization: sellerAuth.Authorization },
      body: form,
    });
    if (!upload.ok) throw new Error(`사진 업로드 실패 ${upload.status} ${await upload.text()}`);
    console.log('준비: 확인용 상품에 사진 1장 업로드');
  }
  /** 카드 안의 사진이 실제로 그려졌는지 — 주소와 디코딩된 가로 크기 */
  const cardImage = (card) =>
    card
      .locator('img')
      .first()
      .evaluate(async (img) => {
        if (!img.complete) {
          await new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        }
        return { src: img.getAttribute('src'), width: img.naturalWidth };
      })
      .catch(() => ({ src: null, width: 0 }));

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  const page = await context.newPage();
  const alerts = [];
  page.on('dialog', async (d) => {
    alerts.push(d.message());
    await d.accept();
  });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', args.email);
  await page.fill('input[name="password"]', args.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 20000 });

  const heartOn = page.getByRole('button', { name: '찜 해제' });
  const heartOff = page.getByRole('button', { name: '찜하기' });
  const openProduct = async () => {
    await page.goto(BASE + PRODUCT, { waitUntil: 'networkidle' });
    // 내 찜 목록을 받는 동안에는 하트가 비활성이다 — 풀릴 때까지
    await page.locator('button[aria-pressed]:not([disabled])').first().waitFor({ timeout: 15000 });
  };

  // ── 1. 낙관적 갱신 ───────────────────────────────────────────────────────
  await openProduct();
  check('처음엔 빈 하트', await heartOff.isVisible());
  await page.route(TOGGLE_RE, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  let toggleDoneAt = 0;
  page.on('response', (res) => {
    if (TOGGLE_RE.test(res.url()) && !toggleDoneAt) toggleDoneAt = Date.now();
  });
  const t0 = Date.now();
  await heartOff.click();
  await heartOn.waitFor({ timeout: 1000 });
  const flipMs = Date.now() - t0;
  check('낙관적 갱신: 응답(1.5초 지연) 전에 하트가 채워진다', flipMs < 1000 && !toggleDoneAt, `하트 ${flipMs}ms`);
  await page.locator('button[aria-pressed="true"]:not([disabled])').waitFor({ timeout: 10000 });
  check('주입한 지연이 실제로 걸렸다(응답이 1.5초 뒤)', toggleDoneAt - t0 >= 1400, `응답 ${toggleDoneAt - t0}ms`);
  await page.unroute(TOGGLE_RE);
  check('서버에도 찜이 들어갔다', (await serverIds()).includes(Number(args.productId)));

  // ── 2. F3 — 새로고침 후에도 하트 ──────────────────────────────────────────
  await openProduct();
  check('새로고침해도 하트가 채워져 있다(F3)', await heartOn.isVisible());

  // ── 3. 실패 시 롤백 ──────────────────────────────────────────────────────
  await page.route(TOGGLE_RE, async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '일부러 낸 오류' }) });
  });
  await heartOn.click();
  await heartOff.waitFor({ timeout: 700 });
  check('실패 주입: 누르자마자 하트가 비워진다(낙관적)', true);
  await heartOn.waitFor({ timeout: 10000 });
  check('실패 주입: 오류 응답 뒤 하트가 원래대로(채워짐) 돌아온다', true);
  check('실패 주입: 오류 안내가 뜬다', alerts.some((m) => m.includes('일부러 낸 오류')), alerts.join(' | '));
  await page.unroute(TOGGLE_RE);
  check('실패 주입 뒤에도 서버의 찜은 그대로', (await serverIds()).includes(Number(args.productId)));

  // ── 4. 위시리스트 화면 ───────────────────────────────────────────────────
  await page.goto(`${BASE}/my`, { waitUntil: 'networkidle' });
  await page.getByRole('navigation', { name: '마이페이지' }).getByRole('link', { name: '위시리스트' }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/my/wishlist', { timeout: 60000 });
  const card = page.getByRole('listitem').filter({ hasText: '문의 테스트 상품' });
  await card.waitFor({ timeout: 15000 });
  check('위시리스트에 찜한 상품이 보인다', true);
  const uploaded = await cardImage(card);
  check(
    '셀러가 올린 사진(/uploads)이 카드에 그려진다',
    String(uploaded.src).startsWith('/uploads/') && uploaded.width > 0,
    `${uploaded.src} · ${uploaded.width}px`,
  );

  await page.locator('#nprogress').waitFor({ state: 'detached', timeout: 10000 }).catch(() => undefined);
  axeViolations = await runAxe(page);
  check('axe: 위시리스트 위반 0', axeViolations.length === 0, `${axeViolations.length}건`);
  if (args.shot) await page.screenshot({ path: `${args.shot}/my-wishlist.png`, fullPage: true });

  await card.getByRole('button', { name: /장바구니 담기/ }).click();
  await card.getByText('✓ 담았습니다').waitFor({ timeout: 10000 });
  const cart = await (await fetch(`${API}/cart`, { headers: auth })).json();
  const cartList = cart.items ?? cart.data?.items ?? [];
  check('장바구니 담기: 서버 장바구니에 들어갔다', cartList.some((i) => i.productId === Number(args.productId)));

  await card.getByRole('button', { name: /위시리스트에서 빼기/ }).click();
  await card.waitFor({ state: 'hidden', timeout: 10000 });
  check('빼기: 목록에서 사라진다', true);
  await page.getByText('찜한 상품이 없습니다.').waitFor({ timeout: 10000 });
  check('빼기: 빈 화면 안내', true);
  await openProduct();
  check('빼기 후 상품 상세 하트가 빈 상태', await heartOff.isVisible());

  // ── 5. 전체 비우기 ───────────────────────────────────────────────────────
  for (const id of [args.productId, args.otherProductId]) {
    await fetch(`${API}/wishlist/toggle`, { method: 'POST', headers: auth, body: JSON.stringify({ productId: Number(id) }) });
  }
  await page.goto(`${BASE}/my/wishlist`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '전체 비우기' }).waitFor({ timeout: 15000 });
  // 시드 상품의 사진은 외부 링크다
  const otherCard = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /빼기/ }) })
    .filter({ hasNotText: '문의 테스트 상품' });
  const external = await cardImage(otherCard);
  check(
    '외부 링크 사진(시드 상품)도 카드에 그려진다',
    /^https?:/.test(String(external.src)) && external.width > 0,
    `${String(external.src).slice(0, 60)} · ${external.width}px`,
  );
  check('두 건 찜 → 목록 2건', (await page.getByRole('main').getByRole('listitem').filter({ has: page.getByRole('button', { name: /빼기/ }) }).count()) === 2);
  await page.getByRole('button', { name: '전체 비우기' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 5000 });
  await dialog.getByRole('button', { name: '모두 빼기' }).click();
  await page.getByText('위시리스트를 비웠습니다.').waitFor({ timeout: 10000 });
  await page.getByText('찜한 상품이 없습니다.').waitFor({ timeout: 10000 });
  check('전체 비우기: 완료 문구 + 빈 화면', true);
  check('전체 비우기: 서버 찜 0건', (await serverIds()).length === 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('모바일(390px): 가로 넘침 없음', overflow <= 0, `${overflow}px`);
  await context.close();
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n')[0]);
} finally {
  await browser.close();
  if (auth) await resetAccount();
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
    productId: '521',
    otherProductId: '127',
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
    '--other-product-id': 'otherProductId',
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
