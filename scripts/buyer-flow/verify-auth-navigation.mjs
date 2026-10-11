import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const site = process.env.TEST_SITE_URL || 'http://localhost:3000';
const api = process.env.TEST_API_URL || 'http://localhost:4000/v1';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext();
await context.route(
  (url) =>
    url.pathname.startsWith('/api/') ||
    (url.port === '4000' && url.pathname.startsWith('/v1/')),
  async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.replace(/^\/(api|v1)/, '');
    await route.fulfill({
      response: await route.fetch({ url: `${api}${endpoint}${url.search}` }),
    });
  }
);
const page = await context.newPage();
let otherTab;

async function assertLoggedIn(tab, nickName) {
  await tab
    .getByRole('button', { name: `${nickName}님`, exact: true })
    .waitFor();
  assert.equal(
    await tab
      .getByRole('link', { name: '로그인/회원가입', exact: true })
      .count(),
    0
  );
}

try {
  await page.goto(`${site}/login`);
  await page.getByRole('button', { name: /^구매자 체험/ }).waitFor();
  // Let the initial 300 ms tab-token handshake finish and cache anonymous state.
  // Clicking immediately can hide the detached AuthProvider observer regression.
  await page.waitForTimeout(600);
  const marker = await page.evaluate(() => {
    window.__authNavigationCheck = crypto.randomUUID();
    return window.__authNavigationCheck;
  });

  for (const [role, label, destination] of [
    ['buyer', '구매자 체험', '/my/orders'],
    ['seller', '셀러 체험', '/seller'],
    ['admin', '관리자 체험', '/admin/dashboard'],
  ]) {
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/auth/demo-login') &&
        response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const response = await loginResponse;
    assert.equal(response.status(), 200);
    const { user } = await response.json();
    await page.waitForURL(`${site}${destination}`, { timeout: 30000 });
    await page.getByRole('complementary', { name: '체험 계정 안내' }).waitFor();
    assert.equal(
      await page.evaluate(() => window.__authNavigationCheck),
      marker
    );

    await page.locator('a[href="/"]').first().click();
    await page.waitForURL(`${site}/`);
    await assertLoggedIn(page, user.nickName);
    assert.equal(
      await page.evaluate(() => window.__authNavigationCheck),
      marker
    );

    if (!otherTab) {
      otherTab = await context.newPage();
      await otherTab.goto(site);
    }
    await assertLoggedIn(otherTab, user.nickName);
    const banner = await otherTab
      .getByRole('complementary', { name: '체험 계정 안내' })
      .innerText();
    assert(banner.includes(label), 'Other tab must show the current role');

    await page
      .getByRole('button', { name: '다른 역할 체험', exact: true })
      .click();
    await page.waitForURL(/\/login#demo-choice$/);
    await page.getByRole('button', { name: /^구매자 체험/ }).waitFor();
    await otherTab
      .getByRole('link', { name: '로그인/회원가입', exact: true })
      .waitFor();
    assert.equal(
      await otherTab
        .getByRole('complementary', { name: '체험 계정 안내' })
        .count(),
      0
    );
    console.log(
      `PASS ${role}: role destination, home menu, tab sync and logout without reload`
    );
  }
  console.log(
    'Auth navigation: 3 role flows passed; no order or payment requests made.'
  );
} finally {
  await browser.close();
}
