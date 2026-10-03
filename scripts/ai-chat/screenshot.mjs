#!/usr/bin/env node
/**
 * 어시스턴트 화면 스크린샷 — 구조만 바꾼 단계에서 "화면이 그대로인지"를 눈으로 비교하기 위한 것(LLM 호출 없음).
 * 빈 화면 + 저장된 대화가 복원된 화면을 데스크톱·모바일 폭으로 찍는다.
 *
 * 실행: node scripts/ai-chat/screenshot.mjs --out <폴더> --prefix before [--conversation-id 15] [--base http://localhost:3000]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loginAsDemoAdmin } from '../a11y/lib.mjs';

const args = { base: 'http://localhost:3000', out: '.', prefix: 'shot', conversationId: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  args[argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
}
mkdirSync(args.out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport, locale: 'ko-KR' });
  await context.route(/\/monitoring(\?|$)|sentry\.io/, (route) => route.abort());
  const page = await context.newPage();
  await loginAsDemoAdmin(page, args.base);

  await page.evaluate(() => localStorage.removeItem('assistant_conversation_id'));
  await shoot(page, `${args.prefix}-${label}-empty.png`);

  if (args.conversationId) {
    await page.evaluate((id) => localStorage.setItem('assistant_conversation_id', id), args.conversationId);
    await shoot(page, `${args.prefix}-${label}-restored.png`);
  }
  await context.close();
}
await browser.close();

async function shoot(page, file) {
  await page.goto(`${args.base}/admin/assistant`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(args.out, file), animations: 'disabled' });
  console.log(file);
}
