/**
 * 셀러 대시보드(/seller) 확인 — 값이 있는 상태 · 0건 상태 · 일부 실패 상태.
 *
 *   node scripts/seller-console/verify-seller-dashboard.mjs [--base http://localhost:3100] [--api http://localhost:4000/v1]
 *        [--product-id 521] [--email seller1@seed.com] [--password …] [--buyer-email …] [--buyer-password …] [--shot <폴더>]
 *
 * 보는 것:
 *   1. 실제 값 — KPI 4장·그래프 3개(일별 매출·주문 상태 분포·상품별 매출 TOP 5)·정산·상품 표·최근 주문이 같은 계정으로 API 를 직접 부른 값과 같다
 *   2. 호출 — 대시보드가 부르는 목록 API 는 전부 page=1 을 싣는다(빼면 meta.total 이 없다)
 *   3. 문의 1건이 생기면 "미답변 문의"가 1 늘고 강조되며, 카드를 누르면 문의 화면으로 간다
 *   4. 0건 상태 — 응답을 빈 목록으로 바꿔 "0건"과 안내 문구를 본다(시드 셀러는 데이터가 있어 실제로는 만들 수 없다)
 *   5. 일부 실패 — 주문 API 만 500 이면 그 카드·표만 "불러오지 못함"이고 나머지는 그려진다
 *   6. 모바일(390px) 가로 넘침 없음
 *
 * 전제: 로컬 백엔드·프론트. --product-id 는 --email 셀러의 게시 상품(문의를 만들었다 지운다 — 미답변 문의는 구매자가 지울 수 있다).
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { apiAuth } from '../a11y/lib.mjs';
import { resetLoginRateLimits } from '../buyer-flow/lib.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const BASE = arg('--base', 'http://localhost:3100').replace(/\/$/, '');
const API = arg('--api', 'http://localhost:4000/v1').replace(/\/$/, '');
const PRODUCT_ID = Number(arg('--product-id', '521'));
const SHOT = arg('--shot', null);
const SELLER = { email: arg('--email', 'seller1@seed.com'), password: arg('--password', 'Seed1234!') };
const BUYER = { email: arg('--buyer-email', 'a11y-buyer@test.local'), password: arg('--buyer-password', 'A11yTest123!') };
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;
if (SHOT) mkdirSync(SHOT, { recursive: true });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
const emptyPage = { data: [], meta: { total: 0, page: 1, lastPage: 0, take: 1, hasNextPage: false, hasPreviousPage: false } };
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const CARDS = ['판매 중 상품', '승인 대기 상품', '출고 대기 주문', '미답변 문의'];
const card = (page, label) => page.getByRole('main').getByRole('link', { name: new RegExp(`^${label}`) });
async function cardCount(page, label) {
  const text = await card(page, label).innerText();
  const match = text.match(/([\d,]+)건/);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

async function openDashboard(browser, { viewport = { width: 1280, height: 900 }, routes = [] } = {}) {
  const context = await browser.newContext({ viewport, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  for (const [pattern, handler] of routes) await context.route(pattern, handler);
  const page = await context.newPage();
  const apiCalls = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (req.method() === 'GET' && /^\/api\/(products\/my|seller\/)/.test(url.pathname)) apiCalls.push(url);
  });
  await page.goto(`${BASE}/login?redirect=%2Fseller`, { waitUntil: 'load' });
  await page.fill('input[name="email"]', SELLER.email);
  await page.fill('input[name="password"]', SELLER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => new URL(u).pathname === '/seller', { timeout: 60000 });
  await page.getByRole('heading', { name: '대시보드', level: 1 }).waitFor({ timeout: 30000 });
  return { context, page, apiCalls };
}

/** KPI 4장이 로딩을 끝낼 때까지(숫자든 실패 문구든) */
async function waitForCards(page, timeout = 45000) {
  await page.waitForFunction(
    (labels) =>
      labels.every((label) => {
        const el = [...document.querySelectorAll('main a')].find((a) => a.textContent.trim().startsWith(label));
        return el && /\d건|불러오지 못함/.test(el.textContent);
      }),
    CARDS,
    { timeout },
  );
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let createdInquiryId = null;
let buyerAuth = null;
try {
  await resetLoginRateLimits();
  const sellerAuth = await apiAuth(API, SELLER.email, SELLER.password);
  const get = async (path) => (await fetch(`${API}${path}`, { headers: sellerAuth })).json();
  const expected = {
    live: await get('/products/my?page=1&take=10&approvalStatus=approved&status=published'),
    pending: await get('/products/my?page=1&take=1&approvalStatus=pending'),
    preparing: await get('/seller/orders?page=1&take=1&status=preparing'),
    waiting: await get('/seller/inquiries?page=1&take=1&status=waiting'),
    recent: await get('/seller/orders?page=1&take=100'), // 그래프(전부)와 최근 주문 표(앞 5건)가 같이 쓴다
    summary: await get('/seller/settlements/summary'),
  };
  const STATUS_LABELS = [
    ['paid', '결제 완료'],
    ['preparing', '출고 대기'],
    ['shipped', '배송 중'],
    ['delivered', '배송 완료'],
    ['completed', '구매 확정'],
    ['cancelled', '취소'],
  ];
  const statusTotals = {};
  for (const [status] of STATUS_LABELS) {
    statusTotals[status] = (await get(`/seller/orders?page=1&take=1&status=${status}`)).meta.total;
  }

  // ── 1·2. 실제 값 ─────────────────────────────────────────────────────────
  {
    const { context, page, apiCalls } = await openDashboard(browser);
    await waitForCards(page);
    const shown = {};
    for (const label of CARDS) shown[label] = await cardCount(page, label);
    const want = {
      '판매 중 상품': expected.live.meta.total,
      '승인 대기 상품': expected.pending.meta.total,
      '출고 대기 주문': expected.preparing.meta.total,
      '미답변 문의': expected.waiting.meta.total,
    };
    for (const label of CARDS) {
      check(`KPI "${label}" = API 의 meta.total`, shown[label] === want[label], `화면 ${shown[label]} · API ${want[label]}`);
    }

    const settlement = page.getByRole('region', { name: '정산 요약' });
    await settlement.getByText('누적 정산액').waitFor({ timeout: 30000 });
    const settlementText = await settlement.innerText();
    check(
      '정산: 누적 정산액·정산 대기 금액/건수·확정·지급 건수가 API 와 같다',
      settlementText.includes(won(expected.summary.totalSettlement)) &&
        settlementText.includes(won(expected.summary.pendingAmount)) &&
        settlementText.includes(`정산 대기 (${expected.summary.pendingCount.toLocaleString('ko-KR')}건)`) &&
        settlementText.includes(`${expected.summary.confirmedCount}건`) &&
        settlementText.includes(`${expected.summary.paidCount}건`),
      settlementText.replace(/\s+/g, ' ').slice(0, 140),
    );

    const productRows = page.getByRole('region', { name: '판매 중 상품' }).locator('tbody tr');
    const orderRows = page.getByRole('region', { name: '최근 주문' }).locator('tbody tr');
    if (expected.live.data.length > 0) await productRows.first().waitFor({ timeout: 30000 });
    if (expected.recent.data.length > 0) await orderRows.first().waitFor({ timeout: 30000 });
    check('판매 중 상품 표: 행 수 = API 행 수(최대 10)', (await productRows.count()) === expected.live.data.length, `${await productRows.count()}행`);
    if (expected.live.data.length > 0) {
      const firstName = expected.live.data[0].name;
      check('판매 중 상품 표: 첫 행이 API 첫 상품', (await productRows.first().innerText()).includes(firstName), firstName);
    }
    check('최근 주문 표: 행 수 = API 행 수(최대 5)', (await orderRows.count()) === Math.min(5, expected.recent.data.length), `${await orderRows.count()}행`);
    if (expected.recent.data.length > 0) {
      const firstNumber = expected.recent.data[0].orderNumber;
      check('최근 주문 표: 첫 행이 API 첫 주문', (await orderRows.first().innerText()).includes(firstNumber), firstNumber);
    }

    // 일별 매출 그래프 — 같은 주문 목록을 스크립트에서 다시 묶어 합계를 댄다(화면의 집계와 독립된 계산)
    const kstDate = (v) => new Date(v).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 10);
    const byDate = new Map();
    for (const o of expected.recent.data) {
      const d = kstDate(o.createdAt);
      const day = byDate.get(d) ?? { revenue: 0, orders: 0 };
      if (o.status !== 'cancelled' && o.status !== 'pending_payment') {
        day.orders += 1;
        day.revenue += o.items.reduce((sum, item) => sum + Number(item.subtotal), 0);
      }
      byDate.set(d, day);
    }
    let dates = [...byDate.keys()].sort();
    if (expected.recent.meta.total > expected.recent.data.length) dates = dates.slice(1); // 잘린 목록의 가장 오래된 날은 버린다
    dates = dates.slice(-14);
    const wantRevenue = dates.reduce((sum, d) => sum + byDate.get(d).revenue, 0);
    const wantOrders = dates.reduce((sum, d) => sum + byDate.get(d).orders, 0);
    const chart = page.getByRole('region', { name: '일별 매출' });
    if (dates.length > 0) {
      const figure = chart.getByRole('img');
      await figure.locator('canvas').waitFor({ timeout: 30000 });
      const label = await figure.getAttribute('aria-label');
      check(
        '일별 매출 그래프: 기간·합계가 주문 목록을 직접 묶은 값과 같다',
        label.includes(`${dates[0]} ~ ${dates.at(-1)}`) &&
          label.includes(`주문이 있던 ${dates.length}일`) &&
          label.includes(`매출 합계 ${won(wantRevenue)}`) &&
          label.includes(`주문 ${wantOrders}건`),
        label,
      );
      const canvas = await figure.locator('canvas').boundingBox();
      check(
        '일별 매출 그래프: 캔버스가 그려진다',
        canvas && canvas.width > 200 && canvas.height > 200,
        canvas ? `${Math.round(canvas.width)}×${Math.round(canvas.height)}` : '없음',
      );
      const note = await chart.innerText();
      const truncated = expected.recent.meta.total > expected.recent.data.length;
      check(
        '일별 매출 그래프: 목록이 잘렸으면 "최근 주문 100건 기준"을 밝힌다',
        note.includes('최근 주문 100건 기준') === truncated,
        `전체 ${expected.recent.meta.total}건 · 받은 ${expected.recent.data.length}건`,
      );
    }

    // 주문 상태 분포 — 상태별 건수를 API 로 직접 센 값과 댄다
    const statusSum = Object.values(statusTotals).reduce((a, b) => a + b, 0);
    if (statusSum > 0) {
      const donut = page.getByRole('region', { name: '주문 상태 분포' }).getByRole('img');
      await donut.locator('canvas').waitFor({ timeout: 30000 });
      const donutLabel = await donut.getAttribute('aria-label');
      check(
        '주문 상태 분포: 상태별 건수·합계가 API 와 같다',
        donutLabel.includes(`전체 ${statusSum}건`) && STATUS_LABELS.every(([status, label]) => donutLabel.includes(`${label} ${statusTotals[status]}건`)),
        donutLabel,
      );
    }

    // 상품별 매출 TOP 5 — 같은 주문 목록을 스크립트에서 다시 묶는다
    const byProduct = new Map();
    for (const o of expected.recent.data) {
      if (o.status === 'cancelled' || o.status === 'pending_payment') continue;
      for (const item of o.items) {
        const entry = byProduct.get(item.productId) ?? { id: item.productId, name: item.productName, revenue: 0 };
        entry.revenue += Number(item.subtotal);
        byProduct.set(item.productId, entry);
      }
    }
    const wantTop = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue || a.id - b.id).slice(0, 5);
    if (wantTop.length > 0) {
      const top = page.getByRole('region', { name: '상품별 매출' });
      const topFigure = top.getByRole('img');
      await topFigure.locator('canvas').waitFor({ timeout: 30000 });
      const topLabel = await topFigure.getAttribute('aria-label');
      check(
        '상품별 매출 TOP 5: 순위·금액이 주문 목록을 직접 묶은 값과 같다',
        wantTop.every((row, i) => topLabel.includes(`${i + 1}위 ${row.name} ${won(row.revenue)}`)),
        topLabel,
      );
      check(
        '상품별 매출 TOP 5: 목록이 잘렸으면 "최근 주문 100건 기준"을 밝힌다',
        (await top.innerText()).includes('최근 주문 100건 기준') === expected.recent.meta.total > expected.recent.data.length,
      );
    }

    const listCalls = apiCalls.filter((u) => !u.pathname.endsWith('/summary'));
    const withoutPage = listCalls.filter((u) => u.searchParams.get('page') !== '1');
    check('목록 호출은 전부 page=1 을 싣는다', listCalls.length >= 10 && withoutPage.length === 0, `${listCalls.length}건 중 누락 ${withoutPage.length}건`);
    const distinct = new Set(apiCalls.map((u) => u.pathname + u.search));
    check('대시보드 호출은 11종(상품 2·주문 7·문의 1·정산 요약 1)', distinct.size === 11, [...distinct].map((s) => s.replace('/api', '')).join(' | '));

    const current = await page.getByRole('navigation', { name: '셀러 센터' }).locator('a[aria-current="page"]').allInnerTexts();
    check('사이드바 현재 메뉴는 "대시보드" 하나', current.length === 1 && current[0] === '대시보드', current.join(', '));
    const hrefs = {};
    for (const label of CARDS) hrefs[label] = await card(page, label).getAttribute('href');
    check(
      'KPI 카드가 각 목록으로 이어진다',
      hrefs['판매 중 상품'] === '/seller/products?approvalStatus=approved' &&
        hrefs['승인 대기 상품'] === '/seller/products?approvalStatus=pending' &&
        hrefs['출고 대기 주문'] === '/seller/orders' &&
        hrefs['미답변 문의'] === '/seller/inquiries',
      Object.values(hrefs).join(' · '),
    );
    if (SHOT) {
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SHOT, 'dashboard-desktop.png'), fullPage: true });
    }

    // ── 3. 문의 1건 → 미답변 +1 ────────────────────────────────────────────
    buyerAuth = await apiAuth(API, BUYER.email, BUYER.password);
    const created = await fetch(`${API}/inquiries`, {
      method: 'POST',
      headers: buyerAuth,
      body: JSON.stringify({ productId: PRODUCT_ID, title: `[대시보드 확인] ${Date.now()}`, content: '대시보드 미답변 수 확인용' }),
    });
    if (!created.ok) throw new Error(`문의 작성 실패 ${created.status} ${await created.text()}`);
    createdInquiryId = (await created.json()).id;
    await page.reload({ waitUntil: 'load' });
    await waitForCards(page);
    const after = await cardCount(page, '미답변 문의');
    check('문의 1건 작성 뒤: "미답변 문의"가 1 늘어난다', after === want['미답변 문의'] + 1, `${want['미답변 문의']} → ${after}`);
    const emphasis = await card(page, '미답변 문의').evaluate((el) => getComputedStyle(el).borderLeftColor);
    const plain = await card(page, '판매 중 상품').evaluate((el) => getComputedStyle(el).borderLeftColor);
    check('… 할 일이 있는 카드는 강조된다(왼쪽 띠 색이 다르다)', emphasis !== plain, `${emphasis} vs ${plain}`);
    if (SHOT) await page.screenshot({ path: join(SHOT, 'dashboard-desktop-todo.png'), fullPage: true });
    await card(page, '미답변 문의').click();
    await page.waitForURL((u) => new URL(u).pathname === '/seller/inquiries', { timeout: 60000 });
    await page.getByRole('row').filter({ hasText: '[대시보드 확인]' }).first().waitFor({ timeout: 30000 });
    check('… 카드를 누르면 문의 화면(미답변 탭)에 그 문의가 있다', true);
    await context.close();
  }

  // ── 4. 0건 상태(응답 대체) ───────────────────────────────────────────────
  {
    const zeroSummary = { totalAmount: 0, totalSettlement: 0, totalCommission: 0, pendingCount: 0, pendingAmount: 0, confirmedCount: 0, paidCount: 0 };
    const { context, page } = await openDashboard(browser, {
      routes: [
        [/\/api\/seller\/settlements\/summary/, (route) => route.fulfill(json(zeroSummary))],
        [/\/api\/(products\/my|seller\/orders|seller\/inquiries)(\?|$)/, (route) => route.fulfill(json(emptyPage))],
      ],
    });
    await waitForCards(page);
    const counts = [];
    for (const label of CARDS) counts.push(await cardCount(page, label));
    check('0건 상태: KPI 4장이 모두 "0건"', counts.every((n) => n === 0), counts.join(', '));
    const borders = [];
    for (const label of CARDS) borders.push(await card(page, label).evaluate((el) => getComputedStyle(el).borderLeftColor));
    check('0건 상태: 강조된 카드가 없다', new Set(borders).size === 1, [...new Set(borders)].join(' / '));
    check('0건 상태: 상품 안내 + "상품 등록" 링크', await page.getByRole('region', { name: '판매 중 상품' }).getByRole('link', { name: '상품 등록' }).isVisible());
    check('0건 상태: 그래프 대신 안내 문구(캔버스 없음)', (await page.getByText('아직 매출이 잡힌 주문이 없습니다.').isVisible()) && (await page.getByRole('region', { name: '일별 매출' }).locator('canvas').count()) === 0);
    check('0건 상태: 도넛·상품별 그래프도 안내 문구(캔버스 없음)', (await page.getByRole('region', { name: '주문 상태 분포' }).getByText('아직 들어온 주문이 없습니다.').isVisible()) && (await page.getByText('아직 팔린 상품이 없습니다.').isVisible()) && (await page.getByRole('main').locator('canvas').count()) === 0);
    check('0건 상태: 주문 안내 문구', await page.getByRole('region', { name: '최근 주문' }).getByText('아직 들어온 주문이 없습니다.').isVisible());
    check('0건 상태: 정산은 0원', (await page.getByRole('region', { name: '정산 요약' }).innerText()).includes('0원'));
    check('0건 상태: 빈 표는 그리지 않는다', (await page.getByRole('main').locator('table').count()) === 0);
    if (SHOT) {
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SHOT, 'dashboard-desktop-empty.png'), fullPage: true });
    }
    await context.close();
  }

  // ── 5. 일부 실패(주문 API 만 500) ────────────────────────────────────────
  {
    const { context, page } = await openDashboard(browser, {
      routes: [[/\/api\/seller\/orders(\?|$)/, (route) => route.fulfill(json({ statusCode: 500, message: 'Internal server error' }, 500))]],
    });
    await waitForCards(page, 60000); // 실패는 재시도가 끝난 뒤에 확정된다
    check('일부 실패: "출고 대기 주문" 카드만 "불러오지 못함"', (await card(page, '출고 대기 주문').innerText()).includes('불러오지 못함'));
    check('일부 실패: 그래프 구역에 실패 문구', await page.getByText('매출 그래프를 불러오지 못했습니다.').isVisible());
    check('일부 실패: 도넛·상품별 그래프 구역에 실패 문구', (await page.getByText('주문 상태를 불러오지 못했습니다.').isVisible()) && (await page.getByText('상품별 매출을 불러오지 못했습니다.').isVisible()));
    check('일부 실패: 최근 주문 구역에 실패 문구', await page.getByText('주문 목록을 불러오지 못했습니다.').isVisible());
    check('일부 실패: 나머지 카드는 숫자를 보여 준다', (await cardCount(page, '판매 중 상품')) === expected.live.meta.total && (await cardCount(page, '미답변 문의')) !== null);
    if (SHOT) await page.screenshot({ path: join(SHOT, 'dashboard-desktop-partial-error.png'), fullPage: true });
    await context.close();
  }

  // ── 6. 모바일 ────────────────────────────────────────────────────────────
  {
    const { context, page } = await openDashboard(browser, { viewport: { width: 390, height: 844 } });
    await waitForCards(page);
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('모바일(390px): 페이지 가로 넘침 없음', overflow <= 0, `${overflow}px`);
    const boxes = [];
    for (const label of CARDS) boxes.push(await card(page, label).boundingBox());
    check('모바일: KPI 는 2열(2×2)', boxes[0].y === boxes[1].y && boxes[2].y === boxes[3].y && boxes[2].y > boxes[0].y, boxes.map((b) => `${Math.round(b.x)},${Math.round(b.y)}`).join(' '));
    if (SHOT) await page.screenshot({ path: join(SHOT, 'dashboard-mobile.png'), fullPage: true });
    await context.close();
  }
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n').slice(0, 3).join(' / '));
} finally {
  if (createdInquiryId && buyerAuth) {
    const del = await fetch(`${API}/inquiries/${createdInquiryId}`, { method: 'DELETE', headers: buyerAuth });
    check('정리: 확인용 문의 삭제', del.ok, `HTTP ${del.status}`);
  }
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
