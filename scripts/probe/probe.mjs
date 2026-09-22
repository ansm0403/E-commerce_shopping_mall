#!/usr/bin/env node
/**
 * 프론트 프로브(probe) — 헤드리스 Chrome 으로 쇼핑몰 페이지를 열고, **특정 API 응답만 브라우저 안에서 깨뜨려**(page.route)
 * 컴포넌트가 던지는지 본다. 서버·DB 무접촉 — 가로챈 요청은 서버에 닿지 않는다(학습 노트 7편 3-2).
 *
 * 왜 저장소에 두나(Phase 8 B-2): Phase 6 의 프로브는 스크래치에만 있었다. 이번엔 같은 케이스 5개로 **수정 전 재현 → 수정 후 0건**을
 * 찍어야 하고, 그 전/후가 곧 증거다. 케이스 5개 = 앱이 찾고 사람이 승인한 프론트 버그 5건(Sentry 이슈 7747401267·7747419604·7747420327·
 * 7747419820·7747424036, 사실 메모는 backend/eval/ops-incident-notes.ts).
 *
 * 실행(저장소 루트):
 *   node scripts/probe/probe.mjs [--base http://localhost:3000] [--api http://localhost:4000/v1] [--case all|<이름>]
 *                                [--product-id 123] [--allow-sentry] [--headed] [--json out.json]
 *   운영: node scripts/probe/probe.mjs --base https://<vercel 도메인> --api https://<vercel 도메인>/api --allow-sentry
 *
 * 주의:
 *  - playwright-core 는 브라우저를 내려받지 않는다 → 설치된 Google Chrome(channel:'chrome')을 쓴다(7편 6-7). 없으면 에러 메시지대로 설치
 *  - Sentry 전송은 **기본 차단**(`/monitoring` 터널 · *.sentry.io) — 로컬 프로브가 운영 Sentry 에 이벤트를 만들지 않게. 운영에서 "새 이벤트가 안 생기는지"를
 *    볼 때만 --allow-sentry. 수정 전에는 운영에 돌리지 않는다(불필요한 이벤트)
 *  - Git Bash 는 `/` 로 시작하는 인자를 경로로 바꾼다(7편 6-6) → 인자 값은 전부 URL 이나 이름이다
 *  - apiHits 가 0 이면 그 페이지는 서버 컴포넌트가 미리 받은 것이라 아무것도 깨지지 않은 것이다(7편 6-4) — 판정 NO_HIT
 *  - Next 개발 서버(yarn nx dev frontend)에서도 pageerror 는 난다. 운영 빌드와 같은 줄이 던지는지는 스택으로 확인한다
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const args = parseArgs(process.argv.slice(2));
const BASE = args.base.replace(/\/$/, '');
const API = args.api.replace(/\/$/, '');
/** 프론트가 부르는 API 경로 — 로컬은 `http://localhost:4000/v1/...`, 운영은 Vercel rewrites `/api/...` */
const LIST_RE = /\/(api|v1)\/products\?/;
const CATEGORIES_RE = /\/(api|v1)\/categories(\?|$)/;
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;

const META = { total: 1, page: 1, lastPage: 1, take: 8, hasNextPage: false, hasPreviousPage: false };
const fakeProduct = (over = {}) => ({
  id: 990001, name: '프로브 상품', description: '', price: 1000, brand: '', stockQuantity: 1, status: 'published', approvalStatus: 'approved',
  salesType: 'normal', rejectionReason: null, approvedAt: null, salesCount: 0, viewCount: 0, isEvent: false, discountRate: null, rating: null,
  categoryId: null, sellerId: null, createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z', seller: null, category: null,
  images: [], tags: [], ...over,
});

/**
 * 케이스 = 페이지 + 깨뜨릴 응답 + 기대하는 에러(수정 전) + 수정 후의 정상 화면 확인.
 * body 를 문자열이 아닌 값으로 두는 이유: "배열이어야 할 자리에 객체/문자열/null 항목" 이 이번 버그들의 공통 모양이다.
 */
const CASES = [
  {
    name: 'categories-object',
    issue: '7747401267 t is not iterable',
    page: '/',
    route: CATEGORIES_RE,
    body: { phase6: 'probe-garbage' },
    expectError: /is not iterable/,
    afterFix: { selector: 'header, nav', describe: '홈 헤더가 그려진다(흰 화면 아님)' },
  },
  {
    name: 'products-null-item',
    issue: "7747419604 Cannot read properties of null (reading 'id')",
    page: '/',
    route: LIST_RE,
    body: { data: [null], meta: META },
    expectError: /reading 'id'|null/,
    afterFix: { text: '상품이 없습니다', describe: '빈 목록 문구' },
  },
  {
    name: 'products-string-data',
    issue: '7747420327 x.map is not a function',
    page: '/',
    route: LIST_RE,
    body: { data: 'oops', meta: META },
    expectError: /map is not a function/,
    afterFix: { text: '상품이 없습니다', describe: '빈 목록 문구' },
  },
  {
    name: 'images-string',
    issue: '7747419820 a.find is not a function',
    page: '/',
    route: LIST_RE,
    body: { data: [fakeProduct({ images: 'oops' })], meta: META },
    expectError: /find is not a function/,
    afterFix: { selector: 'img[src*="placeholder"]', describe: '기본 이미지 카드' },
  },
  {
    name: 'related-string',
    issue: '7747424036 (intermediate value).filter is not a function',
    page: (productId) => `/products/${productId}`,
    route: LIST_RE,
    body: { data: 'oops', meta: META },
    expectError: /filter is not a function/,
    afterFix: { textAbsent: '관련 상품', describe: '연관 상품 섹션이 조용히 빠진다' },
  },
];

function parseArgs(argv) {
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  return {
    base: get('--base', 'http://localhost:3000'),
    api: get('--api', 'http://localhost:4000/v1'),
    case: get('--case', 'all'),
    productId: get('--product-id', null),
    allowSentry: argv.includes('--allow-sentry'),
    headed: argv.includes('--headed'),
    json: get('--json', null),
  };
}

/** 연관 상품 케이스의 상세 페이지에 쓸 실제 상품 id — 가로채지 않은 진짜 API 에서 하나 받는다 */
async function pickProductId() {
  if (args.productId) return args.productId;
  const res = await fetch(`${API}/products?page=1&limit=1`);
  if (!res.ok) throw new Error(`상품 id 를 못 받았다: ${API}/products → ${res.status}`);
  const json = await res.json();
  const first = Array.isArray(json?.data) ? json.data[0] : null;
  if (!first?.id) throw new Error('상품 목록이 비어 있다 — --product-id 로 지정하라');
  return String(first.id);
}

async function runCase(browser, c, productId) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  let apiHits = 0;
  let sentryBlocked = 0;

  // 메시지 + 우리 파일의 첫 프레임 — "어느 줄이 던졌나"가 전/후 비교의 핵심이다(같은 메시지가 다른 컴포넌트에서 날 수 있다)
  page.on('pageerror', (e) => {
    const frame = String(e?.stack ?? '')
      .split('\n')
      .find((l) => /\/(src|app|components|hooks)\//.test(l) && !/node_modules|sentry|next\/dist/.test(l));
    pageErrors.push(`${e?.message ?? e}${frame ? `  @ ${frame.trim().replace(/^at\s+/, '').slice(0, 140)}` : ''}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  if (!args.allowSentry) {
    await page.route(SENTRY_RE, (route) => {
      sentryBlocked++;
      return route.abort();
    });
  }
  await page.route(c.route, (route) => {
    apiHits++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c.body) });
  });

  const path = typeof c.page === 'function' ? c.page(productId) : c.page;
  const url = `${BASE}${path}`;
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);

  const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
  const matched = [...pageErrors, ...consoleErrors].filter((t) => c.expectError.test(t));
  const verdict = apiHits === 0 ? 'NO_HIT' : matched.length > 0 ? 'BROKEN' : 'OK';

  // 수정 후 확인 — 에러가 없을 때만 의미가 있다
  let afterFixCheck = 'skipped';
  if (verdict === 'OK') {
    let pass = true;
    if (c.afterFix.text) pass = bodyText.includes(c.afterFix.text);
    if (c.afterFix.textAbsent) pass = pass && !bodyText.includes(c.afterFix.textAbsent);
    if (c.afterFix.selector) pass = pass && (await page.locator(c.afterFix.selector).count()) > 0;
    afterFixCheck = pass ? 'pass' : 'fail';
  }

  await context.close();
  return {
    case: c.name,
    issue: c.issue,
    url,
    apiHits,
    sentryBlocked,
    verdict,
    matchedErrors: matched.slice(0, 3),
    pageErrors: pageErrors.length,
    consoleErrors: consoleErrors.length,
    afterFixCheck,
    afterFixDescribe: c.afterFix.describe,
  };
}

async function main() {
  const selected = args.case === 'all' ? CASES : CASES.filter((c) => c.name === args.case);
  if (selected.length === 0) throw new Error(`모르는 케이스: ${args.case} (${CASES.map((c) => c.name).join(', ')})`);

  const needsProduct = selected.some((c) => typeof c.page === 'function');
  const productId = needsProduct ? await pickProductId() : null;

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
  } catch (e) {
    throw new Error(`Chrome 을 못 열었다 — 설치된 Google Chrome 이 필요하다(playwright-core 는 브라우저를 내려받지 않는다). ${e.message}`);
  }

  console.log(`\n프로브 ${selected.length}건 → ${BASE} (API ${API})${args.allowSentry ? ' · Sentry 전송 허용' : ' · Sentry 전송 차단'}\n`);
  const results = [];
  for (const c of selected) {
    const r = await runCase(browser, c, productId);
    results.push(r);
    const mark = r.verdict === 'BROKEN' ? '✗ BROKEN' : r.verdict === 'OK' ? '✓ OK    ' : '? NO_HIT';
    console.log(`  ${mark}  ${r.case.padEnd(22)} hits=${r.apiHits} pageerror=${r.pageErrors} console=${r.consoleErrors}  ${r.matchedErrors[0] ? r.matchedErrors[0].slice(0, 90) : ''}`);
    if (r.verdict === 'OK') console.log(`            수정 후 확인(${r.afterFixDescribe}): ${r.afterFixCheck}`);
  }
  await browser.close();

  const broken = results.filter((r) => r.verdict === 'BROKEN').length;
  const ok = results.filter((r) => r.verdict === 'OK').length;
  console.log(`\n  깨짐 ${broken} · 정상 ${ok} · 미적중 ${results.length - broken - ok} / ${results.length}\n`);
  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ runAt: new Date().toISOString(), base: BASE, api: API, allowSentry: args.allowSentry, results }, null, 2));
    console.log(`  기록: ${args.json}\n`);
  }
  process.exitCode = 0;
}

main().catch((e) => {
  console.error(`\n실패: ${e.message}`);
  process.exit(1);
});
