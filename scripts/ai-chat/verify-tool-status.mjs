#!/usr/bin/env node
/**
 * 도구 진행 표시·추천 질문 칩 확인(04-ai-chat-ux ⑤) — 화면에 실제로 무엇이 보이는지 글자와 스크린샷으로 남긴다.
 *
 *  1) 빈 화면: 추천 질문 칩 4개
 *  2) 칩 클릭(실제 백엔드·LLM): "… 조회 중" 이 뜨는지 → 답변이 시작되면 "… 조회 완료" 로 바뀌는지
 *  3) 도구 실행 중 중지: "… 조회 중단" + "중지됨"
 *  4) 모르는 도구 이름(스트림 응답을 가짜로 바꿔서): 기본 문구 "데이터 조회 완료"
 *
 * 실행: node scripts/ai-chat/verify-tool-status.mjs --out <폴더> [--base http://localhost:3000]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loginAsDemoAdmin } from '../a11y/lib.mjs';

const args = { base: 'http://localhost:3000', out: '.' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i].slice(2)] = argv[i + 1];
mkdirSync(args.out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
await context.route(/\/monitoring(\?|$)|sentry\.io/, (route) => route.abort());
const page = await context.newPage();
await loginAsDemoAdmin(page, args.base);

const status = (text) => page.locator('li', { hasText: text }).first();
const stopButton = page.getByRole('button', { name: '중지' });
const results = {};

// 1) 빈 화면
await fresh();
const chips = await page.getByRole('list', { name: '추천 질문' }).getByRole('button').allTextContents();
results.chips = chips;
await shot('1-empty.png');

// 2) 칩 클릭 → 조회 중 → 조회 완료
await page.getByRole('button', { name: chips[0] }).click();
await status('조회 중').waitFor({ timeout: 60000 });
results.running = await toolLines();
results.pendingDotsWhileTool = await page.getByText('…', { exact: true }).count(); // 도구 표시가 있으면 `…` 말풍선은 없어야 한다
await shot('2-running.png');
await stopButton.waitFor({ state: 'hidden', timeout: 90000 });
results.afterAnswer = await toolLines();
await shot('3-done.png');

// 3) 도구 실행 중 중지
await page.waitForTimeout(15000); // Gemini 분당 한도
await fresh();
await page.locator('textarea').fill('2026년 6월 매출이랑 주문 상태 분포를 같이 정리해줘');
await page.locator('textarea').press('Enter');
await status('조회 중').waitFor({ timeout: 60000 });
await stopButton.click();
await page.waitForTimeout(500);
results.afterStop = { tools: await toolLines(), stoppedMark: await page.getByText('중지됨', { exact: true }).count() };
await shot('4-stopped.png');

// 4) 모르는 도구 이름 — 스트림 응답만 가짜로
await page.waitForTimeout(3000);
await fresh();
await page.route('**/api/admin/assistant/stream', (route) =>
  route.fulfill({
    status: 201,
    contentType: 'text/event-stream; charset=utf-8',
    body: [
      { type: 'meta', conversationId: '999999' },
      { type: 'tool', name: 'some_future_tool' },
      { type: 'text', delta: '새 도구의 결과입니다.' },
      { type: 'done' },
    ]
      .map((ev) => `data: ${JSON.stringify(ev)}\n\n`)
      .join(''),
  }),
);
await page.locator('textarea').fill('모르는 도구 테스트');
await page.locator('textarea').press('Enter');
await page.getByText('새 도구의 결과입니다.').waitFor({ timeout: 10000 });
results.unknownTool = await toolLines();
await shot('5-unknown-tool.png');

await browser.close();
console.log(JSON.stringify(results, null, 2));

async function fresh() {
  await page.evaluate(() => localStorage.removeItem('assistant_conversation_id'));
  await page.goto(`${args.base}/admin/assistant`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
}

async function toolLines() {
  return page.locator('li', { hasText: /조회 (중|완료|중단)/ }).allTextContents();
}

async function shot(file) {
  await page.screenshot({ path: join(args.out, file), animations: 'disabled' });
}
