#!/usr/bin/env node
/**
 * 공용 Modal 포커스 측정 — 주문 상세의 "주문 취소" 모달(결제 전 주문)을 키보드로 열고 닫으며 4가지를 본다.
 *  ① 열리면 포커스가 모달 안으로 들어가는가
 *  ② Tab 을 계속 눌러도 모달 밖(뒤 페이지)으로 새지 않는가
 *  ③ Esc 로 닫히는가
 *  ④ 닫힌 뒤 포커스가 연 버튼으로 돌아오는가
 * + 대화상자의 접근 가능한 이름(제목과 연결됐는가)
 *
 * 전제: 측정 계정에 pending_payment 주문이 없으면 API 로 1건 만든다(로컬 DB 에만, 결제하지 않음).
 * 실행(저장소 루트): node scripts/a11y/modal-focus.mjs [--base http://localhost:3000] [--api http://localhost:4000/v1] [--json out.json]
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { apiAuth, cartItems, ensureCartItem } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const BASE = args.base.replace(/\/$/, '');
const API = args.api.replace(/\/$/, '');

const orderNumber = await ensurePendingOrder();

const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
await context.route(/\/monitoring(\?|$)|sentry\.io/, (r) => r.fulfill({ status: 200, body: '{}' }));
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="email"]', args.email);
await page.fill('input[name="password"]', args.password);
await page.click('button[type="submit"]');
await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 15000 });
// 로그인 상태에서 주소로 직접 열면 /auth/me 응답 전에 로그인으로 튕긴다(별도 버그) → 사람처럼 메뉴로 이동
await page.getByRole('button', { name: /님$/ }).click();
await page.getByRole('button', { name: '주문 목록' }).click();
await page.waitForURL((u) => new URL(u).pathname === '/my/orders', { timeout: 15000 });
await page.getByText(orderNumber, { exact: true }).click();
await page.waitForURL((u) => new URL(u).pathname === `/my/orders/${orderNumber}`, { timeout: 15000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);
if (new URL(page.url()).pathname !== `/my/orders/${orderNumber}`) {
  throw new Error(`주문 상세로 가지 못함: ${page.url()}`);
}

const trigger = page.getByRole('button', { name: '주문 취소', exact: true });
await trigger.focus();
await page.keyboard.press('Enter');
await page.waitForSelector('[role="dialog"]');
await page.waitForTimeout(300);

const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
const activeDesc = () =>
  page.evaluate(() => {
    const e = document.activeElement;
    return `${e?.tagName.toLowerCase()} "${(e?.getAttribute('aria-label') || e?.textContent || '').trim().slice(0, 20)}"`;
  });

const r = {};
r.dialogName = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  const lb = d.getAttribute('aria-labelledby');
  return { ariaLabel: d.getAttribute('aria-label'), labelledby: lb ? document.getElementById(lb)?.textContent : null };
});
r.focusAfterOpen = await activeDesc();
r.focusMovedIn = await inDialog();

const tabs = [];
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab');
  tabs.push({ el: await activeDesc(), inDialog: await inDialog() });
}
r.tabSequence = tabs;
r.tabEscapes = tabs.filter((t) => !t.inDialog).length;

// Shift+Tab 도 한 번(뒤로 새는지)
await page.keyboard.press('Shift+Tab');
r.shiftTabInDialog = await inDialog();

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
r.closedByEsc = (await page.locator('[role="dialog"]').count()) === 0;
r.focusAfterClose = await activeDesc();
r.focusReturned = await trigger.evaluate((el) => el === document.activeElement);

await browser.close();

console.log('\n=== 공용 Modal 포커스 측정 (주문 취소 모달) ===');
console.log(`대화상자 이름      aria-label=${JSON.stringify(r.dialogName.ariaLabel)} labelledby=${JSON.stringify(r.dialogName.labelledby)}`);
console.log(`① 열린 직후 포커스 ${r.focusMovedIn ? '✓ 모달 안' : '✗ 모달 밖'} — ${r.focusAfterOpen}`);
console.log(`② Tab 8회 중 밖으로 샌 횟수 ${r.tabEscapes}  (Shift+Tab 후 ${r.shiftTabInDialog ? '안' : '밖'})`);
for (const t of r.tabSequence) console.log(`     ${t.inDialog ? '안' : '밖'}  ${t.el}`);
console.log(`③ Esc 로 닫힘      ${r.closedByEsc ? '✓' : '✗'}`);
console.log(`④ 포커스 복귀      ${r.focusReturned ? '✓ 주문 취소 버튼' : '✗'} — ${r.focusAfterClose}`);
if (args.json) writeFileSync(args.json, JSON.stringify(r, null, 2));

// ─────────────────────────────────────────────────────────────────────────────

async function ensurePendingOrder() {
  const auth = await apiAuth(API, args.email, args.password);
  const list = await (await fetch(`${API}/orders?take=50`, { headers: auth })).json();
  const orders = list.data ?? list.items ?? list;
  const pending = Array.isArray(orders) ? orders.find((o) => o.status === 'pending_payment') : null;
  if (pending) return pending.orderNumber;

  await ensureCartItem(API, auth, args.productId);
  const items = await cartItems(API, auth);
  const created = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      cartItemIds: items.map((i) => i.id),
      shippingAddress: '서울시 테스트구 접근성로 1',
      recipientName: '측정용',
      recipientPhone: '01000000000',
    }),
  });
  if (!created.ok) throw new Error(`주문 생성 실패 ${created.status} ${await created.text()}`);
  const body = await created.json();
  return (body.data ?? body).orderNumber;
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
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headed') out.headed = true;
    else if (a.startsWith('--')) out[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return out;
}
