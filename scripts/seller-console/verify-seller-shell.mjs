/**
 * 셀러 콘솔 셸 확인 — 셀러 화면이 쇼핑몰 헤더 밖(관리자와 같은 셸)에서 동작하는가.
 *
 *   node scripts/seller-console/verify-seller-shell.mjs [--base http://localhost:3100] [--shot <폴더>]
 *        [--email seller1@seed.com] [--password …] [--buyer-email a11y-buyer@test.local] [--buyer-password …]
 *
 * 보는 것:
 *   1. 비로그인으로 /seller/* 에 가면 미들웨어가 /login?redirect=<원래 주소> 로 보낸다
 *   2. 셀러로 로그인하면 5개 화면이 셸 안에서 열린다 — 쇼핑몰 헤더·푸터 없음, 사이드바 제목, 현재 메뉴 하나
 *   3. 각 화면에서 새로고침해도 로그인으로 튕기지 않는다
 *   4. 상점으로 돌아가는 길 — "쇼핑몰 홈으로"·"마이페이지"
 *   5. 모바일(390px) — 사이드바 대신 상단 바 + 칩 줄, 현재 칩 하나, 가로 넘침 없음
 *   6. 셀러가 아닌 계정(구매자)은 셸 안에서 "셀러 신청" 안내를 본다
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resetLoginRateLimits } from '../buyer-flow/lib.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const BASE = arg('--base', 'http://localhost:3100').replace(/\/$/, '');
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

const SCREENS = [
  ['상품 관리', '/seller/products'],
  ['상품 등록', '/seller/products/new'],
  ['주문/배송', '/seller/orders'],
  ['정산', '/seller/settlements'],
  ['문의', '/seller/inquiries'],
];
const pathOf = (url) => new URL(url).pathname;

async function newPage(browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, locale: 'ko-KR' });
  await context.route(SENTRY_RE, (route) => route.abort());
  return { context, page: await context.newPage() };
}

async function login(page, { email, password }, redirect) {
  await page.goto(`${BASE}/login?redirect=${encodeURIComponent(redirect)}`, { waitUntil: 'load' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => pathOf(u) === redirect, { timeout: 60000 });
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await resetLoginRateLimits();

  // ── 1. 비로그인 ──────────────────────────────────────────────────────────
  {
    const { context, page } = await newPage(browser);
    for (const path of ['/seller', '/seller/products', '/seller/orders']) {
      await page.goto(BASE + path, { waitUntil: 'load' });
      const url = new URL(page.url());
      check(
        `비로그인 ${path} → 로그인 화면(redirect=${path})`,
        url.pathname === '/login' && url.searchParams.get('redirect') === path,
        url.pathname + url.search,
      );
    }
    await context.close();
  }

  // ── 2~4. 셀러, 데스크톱 ──────────────────────────────────────────────────
  {
    const { context, page } = await newPage(browser);
    await login(page, SELLER, '/seller/products');
    const nav = page.getByRole('navigation', { name: '셀러 센터' });
    await nav.waitFor({ timeout: 30000 });

    for (const [label, path] of SCREENS) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await page.waitForURL((u) => pathOf(u) === path, { timeout: 60000 });
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 });
      const current = await nav.locator('a[aria-current="page"]').allInnerTexts();
      const mallChrome = await page.locator('#main-content, footer').count();
      const title = await page.locator('aside').getByText('셀러 센터').isVisible();
      check(
        `${path}: 셸 안(제목 보임 · 쇼핑몰 헤더/푸터 없음) · 현재 메뉴 "${label}" 하나`,
        title && mallChrome === 0 && current.length === 1 && current[0] === label,
        `현재: ${current.join(', ')} · 쇼핑몰 틀 ${mallChrome}개`,
      );
      if (SHOT) {
        // 세션 첫 화면은 스플래시(위·아래 패널)가 걷히는 중일 수 있어 잠깐 기다렸다 찍는다
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(SHOT, `seller-desktop${path.replace(/\//g, '-')}.png`), fullPage: true });
      }

      await page.reload({ waitUntil: 'load' });
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      check(`${path}: 새로고침해도 그 화면에 남는다`, pathOf(page.url()) === path, pathOf(page.url()));
    }

    const aside = page.locator('aside');
    const homeLinks = await aside.getByRole('link', { name: '← 쇼핑몰 홈으로' }).count();
    check('사이드바에 "쇼핑몰 홈으로"가 있다(위·아래)', homeLinks === 2, `${homeLinks}개`);
    const adminLink = await aside.getByRole('link', { name: /관리자 콘솔/ }).count();
    check('관리자가 아닌 셀러에게는 "관리자 콘솔" 링크가 없다', adminLink === 0, `${adminLink}개`);
    await aside.getByRole('link', { name: '마이페이지', exact: true }).click();
    await page.waitForURL((u) => pathOf(u) === '/my', { timeout: 60000 });
    await page.getByRole('navigation', { name: '마이페이지' }).waitFor({ timeout: 30000 });
    check('"마이페이지" → /my (쇼핑몰 화면으로 돌아온다)', (await page.locator('#main-content').count()) === 1);
    await context.close();
  }

  // ── 5. 셀러, 모바일 ──────────────────────────────────────────────────────
  {
    const { context, page } = await newPage(browser, { width: 390, height: 844 });
    await login(page, SELLER, '/seller/orders');
    const nav = page.getByRole('navigation', { name: '셀러 센터' });
    await nav.waitFor({ timeout: 30000 });
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 });
    const current = await nav.locator('a[aria-current="page"]').allInnerTexts();
    check('모바일: 칩 줄에서 현재 메뉴 "주문/배송" 하나', current.length === 1 && current[0] === '주문/배송', current.join(', '));
    check('모바일: 사이드바(aside)는 숨는다', !(await page.locator('aside').isVisible()));
    check('모바일: 상단 바에 "쇼핑몰 홈으로"·"마이페이지"', (await page.getByRole('link', { name: '← 쇼핑몰 홈으로' }).isVisible()) && (await page.getByRole('link', { name: '마이페이지', exact: true }).isVisible()));
    for (const [label, path] of SCREENS) {
      await nav.getByRole('link', { name: label, exact: true }).click();
      await page.waitForURL((u) => pathOf(u) === path, { timeout: 60000 });
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`모바일 ${path}: 페이지 가로 넘침 없음`, overflow <= 0, `${overflow}px`);
      // 넓은 표는 잘리지 않고 카드 안에서 좌우로 밀려야 한다(래퍼 없이 cardStyle 의 overflow:hidden 에 잘리던 적이 있다)
      const table = page.locator('table').first();
      if ((await table.count()) > 0) {
        const scroll = await table.evaluate((el) => {
          const wrap = el.parentElement;
          wrap.scrollLeft = 9999;
          return { moved: wrap.scrollLeft, hidden: el.offsetWidth - wrap.clientWidth, overflowX: getComputedStyle(wrap).overflowX };
        });
        check(
          `모바일 ${path}: 표가 좌우로 밀린다`,
          scroll.hidden <= 0 || (scroll.overflowX === 'auto' && scroll.moved > 0),
          `가려진 폭 ${scroll.hidden}px · overflow-x ${scroll.overflowX} · 밀린 거리 ${scroll.moved}px`,
        );
      }
      if (SHOT) await page.screenshot({ path: join(SHOT, `seller-mobile${path.replace(/\//g, '-')}.png`), fullPage: true });
    }
    await context.close();
  }

  // ── 6. 셀러가 아닌 계정 ──────────────────────────────────────────────────
  {
    const { context, page } = await newPage(browser);
    await login(page, BUYER, '/seller/products');
    await page.getByText('셀러 전용 페이지입니다.').waitFor({ timeout: 30000 });
    check('구매자: 셸 안에서 "셀러 전용 페이지" 안내 + 셀러 신청 링크', await page.getByRole('link', { name: '셀러 신청하러 가기' }).isVisible());
    if (SHOT) await page.screenshot({ path: join(SHOT, 'seller-desktop-non-seller.png') });
    await context.close();
  }
} catch (error) {
  check('스크립트가 끝까지 돈다', false, String(error?.message ?? error).split('\n').slice(0, 3).join(' / '));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
