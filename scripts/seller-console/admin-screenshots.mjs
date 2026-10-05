#!/usr/bin/env node
/**
 * 관리자 9개 화면 스크린샷 — 셸을 공용 부품으로 빼낸 뒤 "관리자 화면이 그대로인지"를 **바이트 단위로** 비교하기 위한 것.
 *
 *   node scripts/seller-console/admin-screenshots.mjs --mode record --out <폴더> --prefix before1 --har <폴더>
 *   node scripts/seller-console/admin-screenshots.mjs --mode replay --out <폴더> --prefix before2 --har <폴더>
 *   node scripts/seller-console/compare-screenshots.mjs <폴더> before1 before2
 *
 * 같은 코드라도 화면이 매번 달라지는 원인 두 가지를 없앤다:
 *   1. 데이터 — 데모 로그인 한 번마다 감사 로그·보안 지표가 늘어난다. record 가 API 응답을 HAR 로 남기고
 *      replay 는 그 응답만 돌려준다(HAR 에 없는 요청은 끊는다 → 새 요청이 생기면 화면이 비어 차이로 드러난다).
 *      `/api/auth/*` 는 녹화하지 않는다 — 로그인은 매번 진짜로 해서 미들웨어가 보는 쿠키를 받는다.
 *   2. 시각 — 기본 조회 기간·"n분 전" 표기가 지금 시각에서 나온다. 브라우저 시계를 정해진 시각에서 시작시킨다.
 *
 * 전제: 로컬 백엔드(DEMO_LOGIN_ENABLED=true) + 프론트 운영 빌드(next start). 폭마다 HAR 를 따로 둔다.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAsDemoAdmin } from '../a11y/lib.mjs';
import { resetLoginRateLimits } from '../buyer-flow/lib.mjs';

const args = { base: 'http://localhost:3100', out: '.', prefix: 'shot', har: '.', mode: 'replay' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i].slice(2)] = argv[i + 1];
if (!['record', 'replay'].includes(args.mode)) throw new Error('--mode 는 record 또는 replay');
mkdirSync(args.out, { recursive: true });
mkdirSync(args.har, { recursive: true });

const FIXED_NOW = new Date('2026-10-05T12:00:00+09:00');
const PAGES = [
  ['dashboard', '/admin/dashboard'],
  ['assistant', '/admin/assistant'],
  ['orders', '/admin/orders'],
  ['products', '/admin/products'],
  ['sellers', '/admin/sellers'],
  ['settlements', '/admin/settlements'],
  ['categories', '/admin/categories'],
  ['audit-logs', '/admin/audit-logs'],
  ['ops-app', '/admin/ops-app'],
];
const VIEWPORTS = [
  ['desktop', { width: 1280, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
];

await resetLoginRateLimits();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [label, viewport] of VIEWPORTS) {
    const context = await browser.newContext({ viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    // 멈춘 시계(setFixedTime)가 아니라 **정해진 시각에서 흐르는** 시계 — 멈추면 차트 등장 애니메이션(Date 기반)도 멈춰 빈 차트가 찍힌다
    await context.clock.install({ time: FIXED_NOW });
    await context.route(/\/monitoring(\?|$)|sentry\.io/, (route) => route.abort());
    await context.routeFromHAR(join(args.har, `admin-${label}.har`), {
      url: /\/api\/(?!auth\/)/,
      update: args.mode === 'record',
      updateContent: 'embed',
      notFound: 'abort',
    });
    const page = await context.newPage();
    await loginAsDemoAdmin(page, args.base);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => localStorage.removeItem('assistant_conversation_id'));

    for (const [name, path] of PAGES) {
      await page.goto(args.base + path, { waitUntil: 'networkidle' });
      await page.locator('#nprogress').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
      // 차트(캔버스) 등장 애니메이션이 끝난 뒤에 찍는다 — animations:'disabled' 는 CSS 애니메이션만 멈춘다
      await page.waitForTimeout(3000);
      const file = `${args.prefix}-${label}-${name}.png`;
      await page.screenshot({ path: join(args.out, file), fullPage: true, animations: 'disabled' });
      console.log(file);
    }
    await context.close(); // record 모드의 HAR 는 여기서 저장된다
    if (args.mode === 'record') dropUnansweredEntries(join(args.har, `admin-${label}.har`));
  }
} finally {
  await browser.close();
}

/**
 * 응답을 받지 못한 요청을 HAR 에서 뺀다.
 * 로그인 직후 대시보드가 보낸 요청이 다음 이동에 끊기면 응답 없는 항목(status -1)으로 남고,
 * replay 는 같은 주소의 첫 항목인 그것을 돌려줘 화면이 로딩 상태로 찍힌다.
 */
function dropUnansweredEntries(file) {
  const har = JSON.parse(readFileSync(file, 'utf8'));
  har.log.entries = har.log.entries.filter((entry) => entry.response.status > 0);
  writeFileSync(file, JSON.stringify(har));
}
