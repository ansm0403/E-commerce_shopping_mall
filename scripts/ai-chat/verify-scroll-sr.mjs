#!/usr/bin/env node
/**
 * 스크롤 따라가기 + 스크린리더 알림 확인(04-ai-chat-ux ⑦). LLM 을 부르지 않는다(스트림만 가짜로 천천히 흘린다).
 *
 *  A) 바닥을 보고 있으면 긴 답변을 끝까지 따라간다 / 알림 영역(role=status)의 문구가 어떤 순서로 바뀌는가
 *  B) 스트리밍 중 위로 올리면 끌려가지 않고 "새 응답 ↓" 버튼이 뜬다 → 누르면 바닥으로 가고 다시 따라간다
 *  C) 키보드로 중지(Tab → Enter): 포커스가 입력창으로 돌아간 **뒤에** "응답을 중지했습니다." 를 알린다
 *     (동시에 넣으면 스크린리더가 포커스 안내를 읽느라 알림을 놓친다 — NVDA 청취로 발견)
 *  D) 마우스로 전송: 답변이 끝나도 포커스를 입력창으로 옮기지 않는다(입력창 안내가 "응답 완료" 를 덮지 않게)
 *  + 그 화면의 axe(WCAG 2.1 A/AA)
 *
 * 스크린리더가 실제로 무엇을 소리 내는지는 이 스크립트로 알 수 없다 — 알림 영역의 글자 변화만 본다(NVDA 청취는 사람이).
 *
 * 실행: node scripts/ai-chat/verify-scroll-sr.mjs [--base http://localhost:3000] [--out <폴더>] [--json out.json]
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loginAsDemoAdmin } from '../a11y/lib.mjs';

const args = { base: 'http://localhost:3000', out: null, json: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i].slice(2)] = argv[i + 1];
if (args.out) mkdirSync(args.out, { recursive: true });
const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
await context.route(/\/monitoring(\?|$)|sentry\.io/, (route) => route.abort());
await context.addInitScript(installMockStream);
const page = await context.newPage();
await loginAsDemoAdmin(page, args.base);

const paragraphs = Array.from({ length: 60 }, (_, i) => `${i + 1}번째 문단입니다. 긴 답변을 읽는 도중 화면이 끌려가지 않는지 확인합니다.\n\n`);
const longText = `## 긴 답변\n\n${paragraphs.join('')}마지막 문장.`;
const list = page.getByRole('region', { name: '대화 내용' });
const newReply = page.getByRole('button', { name: /새 응답/ });
const stopButton = page.getByRole('button', { name: '중지' });
const fromBottom = () => list.evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight));

// ── A) 따라가기 + 알림 순서 ───────────────────────────────────────────────────
await fresh();
await ask('긴 답변 A', chunk(longText, 20), 10);
const busyDuring = await list.getAttribute('aria-busy');
await stopButton.waitFor({ state: 'hidden', timeout: 60000 });
await page.waitForTimeout(1000); // 끝 알림은 포커스 이동 뒤로 조금 늦게 들어간다
const a = {
  ariaBusyWhileStreaming: busyDuring,
  ariaBusyAfter: await list.getAttribute('aria-busy'),
  fromBottomAtEnd: await fromBottom(),
  newReplyButtonShown: await newReply.count(),
  announcements: (await page.evaluate(() => window.__statusLog)).map((t) => (t.length > 70 ? `${t.slice(0, 70)}… (${t.length}자)` : t)),
  lastAnnouncementHasMarkdownSymbols: /[#*|`]/.test(await page.evaluate(() => window.__statusLog.at(-1) ?? '')),
  statusRegionVisibleSize: await page.locator('[role="status"]').first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return `${Math.round(r.width)}x${Math.round(r.height)}`; // sr-only 는 1x1
  }),
};

// ── B) 위로 올리면 끌려가지 않는다 ────────────────────────────────────────────
await fresh();
await ask('긴 답변 B', chunk(longText, 12), 25);
await page.waitForFunction(
  () => {
    const el = document.querySelector('[role="region"][aria-label="대화 내용"]');
    return el && el.scrollHeight - el.clientHeight > 600;
  },
  null,
  { timeout: 30000 },
);
const box = await list.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -5000); // 사용자가 위로 올려 읽는다
await page.waitForTimeout(600);
const top1 = await list.evaluate((el) => el.scrollTop);
const height1 = await list.evaluate((el) => el.scrollHeight);
await page.waitForTimeout(1200); // 그동안 답변은 계속 길어진다
const top2 = await list.evaluate((el) => el.scrollTop);
const height2 = await list.evaluate((el) => el.scrollHeight);
const b = {
  stillStreaming: await stopButton.isVisible(),
  scrollTopAfterWheelUp: Math.round(top1),
  scrollTopOneSecondLater: Math.round(top2),
  contentGrewMeanwhilePx: height2 - height1,
  dragged: Math.abs(top2 - top1) > 2,
  newReplyButtonShown: await newReply.count(),
};
if (args.out) await page.screenshot({ path: join(args.out, 'scrolled-up.png'), animations: 'disabled' });
await newReply.click();
await page.waitForTimeout(300);
b.fromBottomAfterClick = await fromBottom();
b.buttonHiddenAfterClick = (await newReply.count()) === 0;
await stopButton.waitFor({ state: 'hidden', timeout: 60000 });
await page.waitForTimeout(400);
b.fromBottomAtEnd = await fromBottom(); // 버튼을 누른 뒤에는 다시 따라간다

// 새 질문을 보내면 위로 올려 둔 상태여도 바닥으로 간다(내 질문이 보여야 한다)
await page.mouse.wheel(0, -5000);
await page.waitForTimeout(300);
await ask('짧은 질문', ['짧은 답변입니다.'], 10);
await stopButton.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(400);
b.fromBottomAfterNewQuestion = await fromBottom();

// axe — 대화가 길게 쌓인 화면(스크롤 영역·버튼 포함)
await page.addScriptTag({ path: AXE_PATH });
const axeViolations = await page.evaluate(async () => {
  // eslint-disable-next-line no-undef
  const res = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    resultTypes: ['violations'],
  });
  return res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.html.slice(0, 120)) }));
});

// ── C) 키보드로 중지 → 포커스 복귀 뒤에 알림 ─────────────────────────────────
await fresh();
await ask('중지 테스트', chunk(longText, 12), 25);
await page.waitForTimeout(800);
await page.keyboard.press('Tab'); // 입력창 → 중지 버튼
const focusedBeforeStop = await page.evaluate(() => document.activeElement?.textContent?.trim());
await page.keyboard.press('Enter');
await page.waitForTimeout(1000);
const c = await page.evaluate(() => {
  const focusBack = window.__eventLog.filter((e) => e.kind === 'focusin' && e.what === 'textarea').at(-1);
  const announced = window.__eventLog.filter((e) => e.kind === 'status' && e.what === '응답을 중지했습니다.').at(-1);
  return {
    last: window.__statusLog.at(-1),
    activeElement: document.activeElement?.tagName.toLowerCase(),
    focusReturnedAtMs: focusBack ? Math.round(focusBack.t) : null,
    announcedAtMs: announced ? Math.round(announced.t) : null,
  };
});
c.focusedBeforeStop = focusedBeforeStop;
c.announcedAfterFocusByMs = c.announcedAtMs !== null && c.focusReturnedAtMs !== null ? c.announcedAtMs - c.focusReturnedAtMs : null;

// ── D) 마우스로 전송 → 끝나도 포커스를 옮기지 않는다 ─────────────────────────
await fresh();
await page.evaluate(() => {
  window.__statusLog = [];
  window.__mockStream = {
    intervalMs: 20,
    frames: [
      { type: 'meta', conversationId: '999999' },
      { type: 'tool', name: 'get_sales_summary' },
      { type: 'text', delta: '지난달 매출은 **0원**입니다.' },
      { type: 'done' },
    ],
  };
});
await page.locator('textarea').fill('마우스로 전송');
await page.evaluate(() => (window.__eventLog = [])); // 입력할 때 생긴 포커스는 세지 않는다 — 전송 클릭 이후만
await page.getByRole('button', { name: '전송' }).click();
await page.waitForTimeout(1500);
const d = await page.evaluate(() => ({
  activeElementAtEnd: document.activeElement?.tagName.toLowerCase(),
  textareaFocusEvents: window.__eventLog.filter((e) => e.kind === 'focusin' && e.what === 'textarea').length,
  last: window.__statusLog.at(-1),
}));
const placeholder = await page.locator('textarea').getAttribute('placeholder');

await browser.close();

const result = {
  measuredAt: new Date().toISOString(),
  base: args.base,
  follow: a,
  scrollUp: b,
  keyboardStop: c,
  mouseSend: d,
  placeholder,
  axeViolations,
};
console.log(JSON.stringify(result, null, 2));
if (args.json) writeFileSync(args.json, JSON.stringify(result, null, 2));

const ok =
  a.fromBottomAtEnd <= 2 &&
  a.newReplyButtonShown === 0 &&
  a.announcements[0] === '응답 생성 중' &&
  a.announcements[1] === '매출 데이터 조회 중' &&
  a.announcements.length === 3 &&
  a.announcements[2].startsWith('응답 완료. ') &&
  !a.lastAnnouncementHasMarkdownSymbols &&
  !b.dragged &&
  b.contentGrewMeanwhilePx > 0 &&
  b.newReplyButtonShown === 1 &&
  b.fromBottomAfterClick <= 2 &&
  b.buttonHiddenAfterClick &&
  b.fromBottomAtEnd <= 2 &&
  b.fromBottomAfterNewQuestion <= 2 &&
  c.last === '응답을 중지했습니다.' &&
  c.focusedBeforeStop === '중지' &&
  c.activeElement === 'textarea' &&
  c.announcedAfterFocusByMs >= 300 &&
  d.activeElementAtEnd !== 'textarea' &&
  d.textareaFocusEvents === 0 &&
  d.last === '응답 완료. 지난달 매출은 0원입니다.' &&
  !/Enter/.test(placeholder ?? '') &&
  axeViolations.length === 0;
console.log(`\n결과: ${ok ? '통과' : '실패'}`);
process.exit(ok ? 0 : 1);

// ─────────────────────────────────────────────────────────────────────────────

async function fresh() {
  await page.evaluate(() => localStorage.removeItem('assistant_conversation_id'));
  await page.goto(`${args.base}/admin/assistant`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
}

/** 가짜 스트림을 걸고 질문을 보낸다(끝나기를 기다리지 않는다) */
async function ask(question, textDeltas, intervalMs) {
  await page.evaluate(
    ({ textDeltas, intervalMs }) => {
      window.__statusLog = [];
      window.__mockStream = {
        intervalMs,
        frames: [
          { type: 'meta', conversationId: '999999' },
          { type: 'tool', name: 'get_sales_summary' },
          { type: 'pause', ms: 300 }, // 도구가 도는 시간
          ...textDeltas.map((delta) => ({ type: 'text', delta })),
          { type: 'done' },
        ],
      };
    },
    { textDeltas, intervalMs },
  );
  const input = page.locator('textarea').first();
  await input.fill(question);
  await input.press('Enter');
  await page.getByRole('button', { name: '중지' }).waitFor({ state: 'visible', timeout: 10000 });
}

function chunk(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** 브라우저 안에서 실행 — 스트림을 가로채 프레임을 천천히 흘리고, 알림 영역의 글자 변화를 기록한다 */
function installMockStream() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (...a) => {
    const url = typeof a[0] === 'string' ? a[0] : a[0]?.url ?? '';
    const signal = a[1]?.signal;
    if (url.includes('/admin/assistant/stream/cancel')) return new Response(null, { status: 204 });
    if (!url.includes('/admin/assistant/stream') || !window.__mockStream) return realFetch(...a);
    const { frames, intervalMs } = window.__mockStream;
    const encoder = new TextEncoder();
    let i = 0;
    const body = new ReadableStream({
      async pull(controller) {
        if (signal?.aborted) return controller.error(new DOMException('aborted', 'AbortError'));
        if (i >= frames.length) return controller.close();
        const frame = frames[i++];
        await new Promise((r) => setTimeout(r, frame.type === 'pause' ? frame.ms : intervalMs));
        if (signal?.aborted) return controller.error(new DOMException('aborted', 'AbortError'));
        if (frame.type !== 'pause') controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        else controller.enqueue(encoder.encode(': pause\n\n'));
      },
    });
    return new Response(body, { status: 201, headers: { 'Content-Type': 'text/event-stream' } });
  };

  window.__statusLog = [];
  window.__eventLog = []; // 포커스 이동과 알림이 어떤 순서·간격으로 일어나는가
  document.addEventListener(
    'focusin',
    (e) => window.__eventLog.push({ t: performance.now(), kind: 'focusin', what: e.target.tagName.toLowerCase() }),
    true,
  );
  document.addEventListener('DOMContentLoaded', () => {
    let last = '';
    new MutationObserver(() => {
      const text = document.querySelector('[role="status"]')?.textContent?.trim() ?? '';
      if (text && text !== last) {
        window.__statusLog.push(text);
        window.__eventLog.push({ t: performance.now(), kind: 'status', what: text.slice(0, 40) });
      }
      last = text;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
