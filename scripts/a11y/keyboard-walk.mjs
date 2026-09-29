#!/usr/bin/env node
/**
 * 키보드 측정 — axe 가 못 잡는 것(포커스 순서·포커스 표시·마우스 전용 요소)을 Tab 을 눌러 가며 센다.
 * axe-audit.mjs 와 같은 흐름·같은 계정. 수정 전/후에 같은 스크립트로 비교한다.
 *
 * 실행(저장소 루트): node scripts/a11y/keyboard-walk.mjs [--base http://localhost:3000] [--max-tabs 80] [--json out.json] [--verbose]
 *
 * 페이지마다 세는 것
 *  - tabStops      : Tab 으로 도달한 요소 수(첫 요소로 돌아오거나 max-tabs 에서 멈춤)
 *  - noFocusRing   : 포커스를 받았는데 outline·box-shadow 가 둘 다 없는 요소(눈으로 어디 있는지 모름)
 *  - noName        : 포커스를 받았는데 접근 가능한 이름이 비어 있는 요소(스크린리더가 "버튼"만 읽음)
 *  - pointerOnly   : cursor:pointer 인데 Tab 으로 갈 수 없는 요소(마우스로만 누를 수 있음) — 휴리스틱
 * 그리고 모달 1개(상품 상세 "리뷰"가 아니라 공용 Modal 이 뜨는 곳이 흐름에 없으면 건너뜀)의 포커스 이동·가두기·복귀.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { apiAuth, ensureCartItem } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const BASE = args.base.replace(/\/$/, '');
const MAX_TABS = Number(args.maxTabs);
const API = args.api.replace(/\/$/, '');

const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
await context.route(/\/monitoring(\?|$)|sentry\.io/, (r) => r.fulfill({ status: 200, body: '{}' }));
const page = await context.newPage();

const PUBLIC_PAGES = [
  { name: '홈', path: '/' },
  { name: '상품 목록', path: '/products' },
  { name: '상품 상세', path: `/products/${args.productId}` },
  { name: '로그인', path: '/login' },
];
const AUTH_PAGES = [
  {
    name: '장바구니',
    path: '/cart',
    via: () => page.locator('header').locator('a[href="/cart"], button').filter({ hasText: /장바구니|담음/ }).first().click(),
  },
  { name: '주문서', path: '/checkout', via: () => page.getByRole('button', { name: '구매하기' }).click() },
];

// 장바구니는 브라우저가 캐시하기 전에 API 로 채워 둔다(로그인 후에 채우면 HomeCart 가 캐시한 빈 장바구니가 보인다)
await ensureCartItem(API, await apiAuth(API, args.email, args.password), args.productId);
const results = [];
for (const p of PUBLIC_PAGES) results.push(await walk(p));
await login();
for (const p of AUTH_PAGES) results.push(await walk(p));
await browser.close();

print(results);
if (args.json) writeFileSync(args.json, JSON.stringify(results, null, 2));

// ─────────────────────────────────────────────────────────────────────────────

async function walk({ name, path, via }) {
  if (via) {
    await via();
    await page.waitForURL((u) => new URL(u).pathname === path, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
  } else {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(1500);
  // 포커스를 문서 맨 앞으로
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  await page.mouse.click(1, 1).catch(() => {});

  const stops = [];
  const seen = new Set();
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(describeActive);
    if (!info || info.tag === 'body') break;
    if (seen.has(info.key)) break; // 한 바퀴 돌았다
    seen.add(info.key);
    info.ring = await focusVisibleOnScreen();
    stops.push(info);
  }

  const pointerOnly = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.cursor !== 'pointer' || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('a[href],button,input,select,textarea,label,summary,[tabindex]')) continue;
      // 부모가 이미 pointer 면 자식은 세지 않는다(같은 클릭 대상)
      const parent = el.parentElement;
      if (parent && getComputedStyle(parent).cursor === 'pointer') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push(`${el.tagName.toLowerCase()} "${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`);
    }
    return out;
  });

  return {
    name,
    path,
    tabStops: stops.length,
    noFocusRing: stops.filter((s) => s.ring === false),
    noName: stops.filter((s) => !s.name),
    pointerOnly,
    stops,
  };
}

/**
 * 포커스 표시가 "눈에 보이는가" — 계산 스타일이 아니라 화면으로 판정한다.
 * (계산 스타일은 transition 도중 값을 돌려주고, 부모의 focus-within 표시를 못 본다 — 1차 측정에서 둘 다 오판)
 * 포커스 있는 상태 / blur 한 상태의 요소 주변(+6px)을 찍어 픽셀이 다르면 표시가 있는 것. 끝나면 포커스를 되돌린다.
 */
async function focusVisibleOnScreen() {
  await page.waitForTimeout(250); // transition(150ms) 끝까지
  const clip = await page.evaluate(() => {
    const el = document.activeElement;
    // 포커스 표시를 부모(focus-within)가 그리는 경우까지 담도록 한 단계 위 상자와 합친다
    const r = el.getBoundingClientRect();
    const pr = el.parentElement?.getBoundingClientRect() ?? r;
    const pad = 6;
    const x = Math.max(0, Math.min(r.left, pr.left) - pad);
    const y = Math.max(0, Math.min(r.top, pr.top) - pad);
    const right = Math.min(window.innerWidth, Math.max(r.right, pr.right) + pad);
    const bottom = Math.min(window.innerHeight, Math.max(r.bottom, pr.bottom) + pad);
    window.__a11yLast = el;
    return { x, y, width: right - x, height: bottom - y };
  });
  if (clip.width <= 0 || clip.height <= 0) return null; // 화면 밖(판정 불가)
  const focused = await page.screenshot({ clip, animations: 'disabled' });
  await page.evaluate(() => window.__a11yLast.blur());
  await page.waitForTimeout(250);
  const blurred = await page.screenshot({ clip, animations: 'disabled' });
  await page.evaluate(() => window.__a11yLast.focus());
  await page.waitForTimeout(50);
  return !focused.equals(blurred);
}

/** 브라우저 안에서 실행 — 현재 포커스 요소 요약 */
function describeActive() {
  const el = document.activeElement;
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  const cs = getComputedStyle(el);
  const labelledby = el.getAttribute('aria-labelledby');
  const byIds = labelledby
    ? labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
    : '';
  const labelEl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
  const name = (
    el.getAttribute('aria-label') ||
    byIds ||
    labelEl?.textContent ||
    el.closest('label')?.textContent ||
    (tag === 'input' || tag === 'select' || tag === 'textarea' ? '' : el.textContent) ||
    el.getAttribute('title') ||
    el.getAttribute('placeholder') ||
    el.querySelector?.('img[alt]')?.getAttribute('alt') ||
    ''
  )
    .trim()
    .replace(/\s+/g, ' ');
  const r = el.getBoundingClientRect();
  const key = `${tag}|${name}|${Math.round(r.x + window.scrollX)}|${Math.round(r.y + window.scrollY)}`;
  return { key, tag, role: el.getAttribute('role'), name: name.slice(0, 40), href: el.getAttribute('href') };
}

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', args.email);
  await page.fill('input[name="password"]', args.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });
}

function print(rs) {
  console.log('\n=== 키보드 측정 ===');
  console.log('페이지'.padEnd(10), 'Tab정지', '포커스표시없음', '이름없음', '마우스전용');
  for (const r of rs) {
    console.log(
      r.name.padEnd(10),
      String(r.tabStops).padStart(6),
      String(r.noFocusRing.length).padStart(12),
      String(r.noName.length).padStart(8),
      String(r.pointerOnly.length).padStart(8),
    );
  }
  if (!args.verbose) return;
  for (const r of rs) {
    console.log(`\n[${r.name}]`);
    for (const s of r.noFocusRing) console.log(`  포커스표시없음  ${s.tag}${s.role ? `[${s.role}]` : ''} "${s.name}" ${s.href ?? ''}`);
    for (const s of r.noName) console.log(`  이름없음        ${s.tag}${s.role ? `[${s.role}]` : ''} ${s.href ?? ''}`);
    for (const p of r.pointerOnly) console.log(`  마우스전용      ${p}`);
  }
}

function parseArgs(argv) {
  const out = {
    base: 'http://localhost:3000',
    api: 'http://localhost:4000/v1',
    email: 'a11y-buyer@test.local',
    password: 'A11yTest123!',
    productId: '349',
    maxTabs: '80',
    json: null,
    headed: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headed') out.headed = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a.startsWith('--')) out[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return out;
}
