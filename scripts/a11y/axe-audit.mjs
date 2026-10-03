#!/usr/bin/env node
/**
 * 접근성 자동 측정 — 헤드리스 Chrome 으로 구매 흐름 페이지를 열고 axe-core 를 주입해 WCAG 2.1 A/AA 위반을 모은다.
 * 같은 스크립트를 수정 전/후에 돌려 before/after 를 비교한다(docs/roadmap/ex-a11y-bundle.md §2).
 *
 * 실행(저장소 루트, 로컬 백엔드 4000 + 프론트 3000 이 떠 있어야 함):
 *   node scripts/a11y/axe-audit.mjs [--base http://localhost:3000] [--api http://localhost:4000/v1]
 *                                   [--email a11y-buyer@test.local] [--password ...] [--product-id 349]
 *                                   [--json out.json] [--headed]
 *   node scripts/a11y/axe-audit.mjs --admin [--ask "지난달 매출 알려줘"] [--json out.json]
 *     관리자 모드 — 데모 관리자로 로그인해 /admin/assistant 만 잰다(장바구니 준비 없음).
 *     --ask 를 주면 빈 화면을 잰 뒤 그 질문을 보내고, 응답이 끝난 화면(말풍선 있음)을 한 번 더 잰다(LLM 호출 발생).
 *
 * 흐름: 비로그인(홈·상품 목록·상품 상세·로그인) → 로그인 폼으로 실제 로그인 → API 로 장바구니에 1개 담기 → 장바구니·주문서.
 * 주의:
 *  - playwright-core 는 브라우저를 내려받지 않는다 → 설치된 Google Chrome(channel:'chrome')
 *  - Sentry 전송은 차단한다(로컬 측정이 운영 Sentry 에 이벤트를 만들지 않게)
 *  - 측정 계정은 로컬 DB 에만 만든다(운영 DB 무접촉)
 */
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { ADMIN_PAGES, apiAuth, ensureCartItem, loginAsDemoAdmin } from './lib.mjs';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');

const args = parseArgs(process.argv.slice(2));
const BASE = args.base.replace(/\/$/, '');
const API = args.api.replace(/\/$/, '');
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;
/** WCAG 2.1 A/AA 만 — best-practice 는 참고로만 따로 센다 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const PUBLIC_PAGES = [
  { name: '홈', path: '/' },
  { name: '상품 목록', path: '/products' },
  { name: '상품 상세', path: `/products/${args.productId}` },
  { name: '로그인', path: '/login' },
];
/**
 * 로그인 후 페이지는 주소로 직접 열지 않고 **클릭으로 이동**한다 — 직접 열면 /auth/me 응답 전에 user 가 비어
 * 로그인으로 튕긴다(별도 버그, ex-a11y-bundle.md §3). 사람이 가는 길 그대로: 헤더 장바구니 → "구매하기".
 */
const AUTH_PAGES = [
  {
    name: '장바구니',
    path: '/cart',
    via: () => page.locator('header').locator('a[href="/cart"], button').filter({ hasText: /장바구니|담음/ }).first().click(),
  },
  { name: '주문서', path: '/checkout', via: () => page.getByRole('button', { name: '구매하기' }).click() },
];

const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
await context.route(SENTRY_RE, (route) => route.abort());
const page = await context.newPage();

const results = [];
if (args.admin) {
  await loginAsDemoAdmin(page, BASE);
  for (const p of ADMIN_PAGES) results.push(await audit(p));
  if (args.ask) results.push(await auditAfterAsk(args.ask));
} else {
  // 장바구니는 브라우저가 캐시하기 전에 API 로 채워 둔다(로그인 후에 채우면 HomeCart 가 캐시한 빈 장바구니가 보인다)
  await ensureCartItem(API, await apiAuth(API, args.email, args.password), args.productId);
  for (const p of PUBLIC_PAGES) results.push(await audit(p));

  await login();
  for (const p of AUTH_PAGES) results.push(await audit(p));
}

await browser.close();

printSummary(results);
if (args.json) {
  writeFileSync(args.json, JSON.stringify(results, null, 2));
  console.log(`\nJSON → ${args.json}`);
}

// ─────────────────────────────────────────────────────────────────────────────

async function audit({ name, path, via }) {
  if (via) {
    await via();
    await page.waitForURL((u) => new URL(u).pathname === path, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  } else {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
  }
  // 클라이언트 렌더·리다이렉트 안정화
  await page.waitForTimeout(1500);
  return runAxe({ name, path });
}

/** 어시스턴트에 질문을 보내고 응답이 끝난 화면을 잰다 — 입력은 키보드로만(화면 구조가 바뀌어도 같은 스크립트가 돌게) */
async function auditAfterAsk(question) {
  const input = page.locator('textarea').first();
  await input.fill(question);
  await input.press('Enter');
  const stop = page.getByRole('button', { name: '중지' });
  await stop.waitFor({ state: 'visible', timeout: 10000 });
  await stop.waitFor({ state: 'hidden', timeout: 90000 });
  await page.waitForTimeout(500);
  return runAxe({ name: 'AI 어시스턴트(응답 후)', path: new URL(page.url()).pathname });
}

async function runAxe({ name, path }) {
  const finalPath = new URL(page.url()).pathname;
  await page.addScriptTag({ path: AXE_PATH });
  const r = await page.evaluate(async (tags) => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return res.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160), summary: n.failureSummary })),
    }));
  }, TAGS);
  return { name, path, finalPath, violations: r };
}

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', args.email);
  await page.fill('input[name="password"]', args.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });
}

function printSummary(rs) {
  const W = { critical: 4, serious: 3, moderate: 2, minor: 1 };
  console.log('\n=== axe WCAG 2.1 A/AA 위반 요약 ===');
  for (const r of rs) {
    const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    let nodes = 0;
    for (const v of r.violations) {
      byImpact[v.impact] += 1;
      nodes += v.nodes.length;
    }
    const moved = r.finalPath !== r.path ? ` (→ ${r.finalPath})` : '';
    console.log(
      `\n[${r.name}] ${r.path}${moved} — 규칙 ${r.violations.length}개 / 요소 ${nodes}개 ` +
        `(critical ${byImpact.critical} · serious ${byImpact.serious} · moderate ${byImpact.moderate} · minor ${byImpact.minor})`,
    );
    for (const v of [...r.violations].sort((a, b) => W[b.impact] - W[a.impact])) {
      console.log(`  - ${v.impact.padEnd(8)} ${v.id} ×${v.nodes.length} — ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target}  ${n.html.replace(/\s+/g, ' ')}`);
    }
  }
}

function parseArgs(argv) {
  const out = {
    base: 'http://localhost:3000',
    api: 'http://localhost:4000/v1',
    email: 'a11y-buyer@test.local',
    password: 'A11yTest123!',
    productId: '349',
    json: null,
    headed: false,
    admin: false,
    ask: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headed') out.headed = true;
    else if (a === '--admin') out.admin = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[key] = argv[++i];
    }
  }
  return out;
}
