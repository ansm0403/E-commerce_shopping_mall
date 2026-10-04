#!/usr/bin/env node
/**
 * 관리자 AI 어시스턴트 채팅 측정 — 수정 전/후에 같은 스크립트로 돌려 비교한다(docs/roadmap/04-ai-chat-ux.md §5).
 * 화면 구조에 기대지 않는다: 입력은 `textarea` + 키보드, 진행 여부는 "중지" 버튼, 내용은 본문 텍스트로만 본다.
 *
 * 실행(저장소 루트, 로컬 백엔드 4000 + 프론트 운영 빌드 3000, 백엔드 DEMO_LOGIN_ENABLED=true):
 *   node scripts/ai-chat/chat-probe.mjs first-response [--question "지난달 매출 알려줘"] [--runs 5] [--gap 20]
 *   node scripts/ai-chat/chat-probe.mjs stop --backend-log <백엔드 로그 파일> [--question "…"] [--settle 40]
 *   node scripts/ai-chat/chat-probe.mjs bad-token [--question "…"]
 *   공통: [--base http://localhost:3000] [--json out.json] [--headed]
 *
 * first-response : Enter → ① SSE 프레임 종류별 첫 도착 시각(fetch 응답을 복제해 읽음) ② 화면 글자가 처음 바뀐 시각. runs 회 중앙값.
 *                  ⚠ 질문 1회 = LLM 호출 2회 이상(도구 라운드). Gemini 무료 티어 분당 15회 → --gap 초만큼 쉰다.
 * stop           : 키보드만으로 전송 → Tab 으로 "중지" 도달 → 백엔드 로그에 첫 도구 실행이 찍힌 직후 중지(수정 전/후 같은 시점).
 *                  그 뒤 서버가 계속 돌았는지(로그) · DB 에 무엇이 저장됐는지(API) · 새로고침 후 무엇이 복원되는지 · 포커스 위치를 기록.
 * bad-token      : 저장된 access 토큰을 망가뜨린 뒤 전송 → 요청 상태 코드와 화면 결과(G4 재현).
 *
 * 주의: Sentry 전송 차단(로컬 측정이 운영 Sentry 에 이벤트를 만들지 않게). 데모 관리자의 대화가 로컬 DB 에 쌓인다.
 */
import { chromium } from 'playwright-core';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { loginAsDemoAdmin } from '../a11y/lib.mjs';

const [mode, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const BASE = args.base.replace(/\/$/, '');
const PAGE_PATH = '/admin/assistant';
const CONVERSATION_ID_KEY = 'assistant_conversation_id';

if (!['first-response', 'stop', 'bad-token'].includes(mode)) {
  console.error('모드: first-response | stop | bad-token');
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
await context.route(/\/monitoring(\?|$)|sentry\.io/, (route) => route.abort());
await context.addInitScript(installProbe);
const page = await context.newPage();

const apiResponses = [];
page.on('response', (res) => {
  const u = new URL(res.url());
  if (u.pathname.startsWith('/api/')) {
    apiResponses.push({ method: res.request().method(), path: u.pathname, status: res.status() });
  }
});

await loginAsDemoAdmin(page, BASE);

let result;
if (mode === 'first-response') result = await firstResponse();
else if (mode === 'stop') result = await stopProbe();
else result = await badToken();

await browser.close();

const out = { mode, measuredAt: new Date().toISOString(), base: BASE, question: args.question, ...result };
if (args.json) {
  writeFileSync(args.json, JSON.stringify(out, null, 2));
  console.log(`\nJSON → ${args.json}`);
}

// ─────────────────────────────────────────────────────────────────────────────

async function firstResponse() {
  // LLM 이 실패한 회차(Gemini 503 등)는 중앙값에서 빼고 따로 남긴다 — 성공 runs 회가 찰 때까지, 최대 2배까지 시도
  const runs = [];
  const failed = [];
  const want = Number(args.runs);
  for (let i = 0; runs.length < want && i < want * 2; i++) {
    if (i > 0) await page.waitForTimeout(Number(args.gap) * 1000);
    await openFreshChat();
    await send(args.question);
    await waitStreamEnd();
    const run = summarize(await readProbe());
    const ok = run.wire.done !== null && run.wire.text !== null;
    (ok ? runs : failed).push(run);
    console.log(
      `#${i + 1} ${ok ? '성공' : '실패'} status=${run.status} meta=${ms(run.wire.meta)} tool=${ms(run.wire.tool)} ` +
        `text=${ms(run.wire.text)} done=${ms(run.wire.done)} | 화면 첫 변화=${ms(run.firstDomChange)} "${run.firstDomChangeText}"`,
    );
  }
  const median = {
    wireMeta: med(runs.map((r) => r.wire.meta)),
    wireFirstTool: med(runs.map((r) => r.wire.tool)),
    wireFirstText: med(runs.map((r) => r.wire.text)),
    wireDone: med(runs.map((r) => r.wire.done)),
    firstDomChange: med(runs.map((r) => r.firstDomChange)),
  };
  console.log(`\n성공 ${runs.length}회 · 실패 ${failed.length}회 — 중앙값(ms, 성공만):`, JSON.stringify(median));
  return { median, successes: runs.length, failures: failed.length, runs, failed };
}

async function stopProbe() {
  if (!args.backendLog) throw new Error('--backend-log 가 필요합니다(첫 도구 실행 시점을 로그로 잡는다)');
  await openFreshChat();
  const logOffset = statSync(args.backendLog).size;

  await send(args.question);
  const focusAfterSend = await describeFocus();

  // 키보드만으로 "중지" 까지 — 못 가면 클릭으로 대신하고 그 사실을 기록한다
  let tabsToStop = null;
  for (let i = 0; i <= 15; i++) {
    if ((await describeFocus()).name === '중지') {
      tabsToStop = i;
      break;
    }
    await page.keyboard.press('Tab');
  }

  // 백엔드 로그에 첫 도구 실행이 찍힐 때까지(= 1라운드가 끝나고 2라운드가 아직 안 열린 시점)
  const deadline = Date.now() + 30000;
  let sawTool = false;
  while (Date.now() < deadline) {
    if (/tool 실행:/.test(logSince(logOffset))) {
      sawTool = true;
      break;
    }
    await page.waitForTimeout(25);
  }
  const stillStreaming = await page.getByRole('button', { name: '중지' }).isVisible();
  if (tabsToStop !== null) await page.keyboard.press('Enter');
  else await page.getByRole('button', { name: '중지' }).click();
  await page.waitForTimeout(400);

  const shownAtStop = await chatText();
  const probe = summarize(await readProbe()); // 새로고침하면 기록이 사라지므로 여기서 읽는다
  const focusAfterStop = await describeFocus();
  // 중지 직후 클릭 없이 바로 타자가 되는가
  await page.keyboard.type('x');
  const typedWithoutClick = (await page.locator('textarea').first().inputValue()).includes('x');
  await page.locator('textarea').first().fill('');

  // 서버가 남은 라운드를 끝낼 시간을 준다
  await page.waitForTimeout(Number(args.settle) * 1000);
  const serverLog = logSince(logOffset)
    .split('\n')
    .filter((l) => /tool 실행:|usage round=|\[usage\]|스트리밍 실패/.test(l))
    .map((l) => l.replace(/^.*?(DEBUG|LOG|ERROR)\s*/, '$1 ').trim());
  const saved = await savedMessages();

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const shownAfterReload = await chatText();

  const result = {
    stopTrigger: sawTool ? '백엔드 로그의 첫 "tool 실행:" 직후' : '30초 안에 도구 실행 로그 없음',
    stillStreamingAtStop: stillStreaming,
    keyboard: { focusAfterSend, tabsToStop, focusAfterStop, typedWithoutClick },
    shownAtStop,
    server: {
      toolRuns: serverLog.filter((l) => /tool 실행:/.test(l)).length,
      llmRounds: serverLog.filter((l) => /usage round=/.test(l)).length,
      finishedNormally: serverLog.some((l) => /\[usage\]/.test(l)),
      log: serverLog,
    },
    saved,
    shownAfterReload,
    wireBeforeStop: probe.wire,
    // 명시적 중지 요청(stream/cancel)이 나갔는가 — 없으면 [](연결 끊김에만 기대는 옛 화면)
    cancelRequests: apiResponses.filter((r) => r.path.endsWith('/stream/cancel')).map((r) => r.status),
  };
  const assistant = saved.messages?.filter((m) => m.role === 'assistant') ?? [];
  console.log(`중지 시점: ${result.stopTrigger}`);
  console.log(`키보드: 전송 후 포커스=${focusAfterSend.tag}"${focusAfterSend.name}" · 중지까지 Tab ${tabsToStop} · 중지 후 포커스=${focusAfterStop.tag}"${focusAfterStop.name}" · 클릭 없이 입력=${typedWithoutClick}`);
  console.log(`중지 요청(stream/cancel) 응답: ${result.cancelRequests.join(', ') || '보내지 않음'}`);
  console.log(`중지 때 화면: "${shownAtStop.slice(0, 120)}"`);
  console.log(`서버: 도구 실행 ${result.server.toolRuns}회 · LLM 라운드 ${result.server.llmRounds}회 · 끝까지 돎=${result.server.finishedNormally}`);
  console.log(`DB 저장: assistant ${assistant.length}건, 길이 ${assistant.map((m) => m.content.length).join(',') || '-'}자`);
  console.log(`새로고침 후 화면: "${shownAfterReload.slice(0, 160)}"`);
  return result;
}

async function badToken() {
  await openFreshChat();
  const before = await page.evaluate(() => {
    const where = sessionStorage.getItem('accessToken') ? 'sessionStorage' : 'localStorage';
    const store = where === 'sessionStorage' ? sessionStorage : localStorage;
    const token = store.getItem('accessToken');
    // 서명 부분 끝을 바꿔 서버 검증만 실패하게 한다(형식은 JWT 그대로)
    store.setItem('accessToken', token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA'));
    return { where, token };
  });
  apiResponses.length = 0;

  await send(args.question);
  // 수정 전: 곧바로 오류 문구. 수정 후: 갱신 → 재시도 → 스트림이 끝날 때까지.
  await page.waitForTimeout(1500);
  await waitStreamEnd().catch(() => {});
  const probe = summarize(await readProbe());
  const tokenAfter = await page.evaluate(() => sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken'));
  const shown = await chatText();
  const stream = apiResponses.filter((r) => r.path.endsWith('/admin/assistant/stream'));
  const result = {
    tokenStorage: before.where,
    requests: [...apiResponses],
    streamStatuses: stream.map((r) => r.status),
    refreshCalled: apiResponses.some((r) => r.path.endsWith('/auth/refresh')),
    tokenReplaced: tokenAfter !== null && tokenAfter !== before.token && !/(AAAA|BBBB)$/.test(tokenAfter),
    gotAnswer: probe.wire.text !== null,
    shown,
  };
  console.log(`stream 응답 코드: ${result.streamStatuses.join(' → ') || '-'} · refresh 호출=${result.refreshCalled} · 답변 수신=${result.gotAnswer}`);
  console.log(`화면: "${shown.slice(0, 200)}"`);
  return result;
}

// ── 공용 ────────────────────────────────────────────────────────────────────

/** 저장된 대화 id 를 지우고 빈 화면으로 연다(매 측정이 history 없는 첫 턴이 되게) */
async function openFreshChat() {
  await page.evaluate((key) => localStorage.removeItem(key), CONVERSATION_ID_KEY);
  await page.goto(BASE + PAGE_PATH, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
}

async function send(question) {
  const input = page.locator('textarea').first();
  await input.focus();
  await input.fill(question);
  await page.evaluate(() => window.__chatProbe.reset());
  await input.press('Enter');
}

async function waitStreamEnd() {
  const stop = page.getByRole('button', { name: '중지' });
  await stop.waitFor({ state: 'visible', timeout: 10000 });
  await stop.waitFor({ state: 'hidden', timeout: 90000 });
  await page.waitForTimeout(300);
}

function readProbe() {
  return page.evaluate(() => window.__chatProbe.read());
}

function chatText() {
  return page.evaluate(() => window.__chatProbe.text());
}

async function describeFocus() {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: 'body', name: '' }; // body = 포커스를 잃은 상태
    const name = (el.getAttribute('aria-label') || (el.tagName === 'TEXTAREA' ? '' : el.textContent) || '').trim();
    return { tag: el.tagName.toLowerCase(), name: name.slice(0, 40) };
  });
}

/** 저장된 대화를 API 로 직접 읽는다(화면 복원 로직과 무관하게 DB 내용을 본다) */
async function savedMessages() {
  return page.evaluate(async (key) => {
    const id = localStorage.getItem(key);
    if (!id) return { conversationId: null, messages: [] };
    const token = sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken');
    const res = await fetch(`/api/admin/assistant/conversations/${id}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = res.ok ? await res.json() : { messages: [] };
    return {
      conversationId: id,
      status: res.status,
      messages: (data.messages ?? []).map((m) => ({ role: m.role, content: m.content })),
    };
  }, CONVERSATION_ID_KEY);
}

function logSince(offset) {
  // eslint-disable-next-line no-control-regex
  return readFileSync(args.backendLog).subarray(offset).toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
}

/** 원시 기록 → Enter 기준 ms. 화면 첫 변화 = 질문이 화면에 올라간 뒤 본문 글자가 처음 달라진 시각 */
function summarize(p) {
  if (!p) return null;
  const rel = (t) => (t == null ? null : Math.round(t - p.t0));
  const first = (type) => rel(p.frames.find((f) => f.type === type)?.t);
  const snaps = p.snapshots.filter((s) => s.t >= p.t0);
  const asked = snaps.findIndex((s) => s.text.includes(p.question));
  const changed = asked === -1 ? undefined : snaps.slice(asked + 1).find((s) => s.text !== snaps[asked].text);
  return {
    status: p.status,
    wire: { meta: first('meta'), tool: first('tool'), text: first('text'), done: first('done'), error: first('error') },
    frameCounts: p.frames.reduce((acc, f) => ((acc[f.type] = (acc[f.type] ?? 0) + 1), acc), {}),
    toolNames: p.frames.filter((f) => f.type === 'tool').map((f) => f.name),
    firstDomChange: rel(changed?.t),
    firstDomChangeText: changed ? changed.text.split(p.question).pop().trim().slice(0, 60) : null,
    domTimeline: snaps.slice(0, 12).map((s) => ({ t: rel(s.t), text: s.text.slice(0, 120) })),
  };
}

function med(xs) {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

function ms(v) {
  return v == null ? '-' : `${v}ms`;
}

function parseArgs(argv) {
  const out = {
    base: 'http://localhost:3000',
    question: '지난달 매출 알려줘',
    runs: '5',
    gap: '20',
    settle: '40',
    backendLog: null,
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

/**
 * 브라우저 안에서 실행(페이지 스크립트보다 먼저) — 세 가지를 기록한다.
 *  - t0       : textarea 에서 Enter(Shift 없이)를 누른 시각
 *  - frames   : 스트림 응답을 복제해 읽은 SSE 프레임의 종류·도착 시각(화면 코드가 그 프레임을 쓰는지와 무관)
 *  - snapshots: 채팅 본문 글자가 바뀔 때마다의 시각·내용(버튼·입력창·스크린리더 전용 영역 제외)
 */
function installProbe() {
  const state = { t0: null, question: '', status: null, frames: [], snapshots: [] };
  let lastText = null;

  const chatText = () => {
    const input = document.querySelector('textarea');
    const root = input?.closest('main') ?? document.body;
    const clone = root.cloneNode(true);
    clone
      .querySelectorAll('button, textarea, label, nav, aside, h1, script, style, [role="status"], [aria-live], .sr-only')
      .forEach((el) => el.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  };

  const snapshot = () => {
    const text = chatText();
    if (text === lastText) return;
    lastText = text;
    if (state.snapshots.length < 400) state.snapshots.push({ t: performance.now(), text });
  };

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey && e.target instanceof HTMLTextAreaElement && state.t0 === null) {
        state.t0 = performance.now();
        state.question = e.target.value.trim();
      }
    },
    true,
  );

  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(snapshot).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  const realFetch = window.fetch.bind(window);
  window.fetch = async (...a) => {
    const res = await realFetch(...a);
    const url = typeof a[0] === 'string' ? a[0] : a[0]?.url ?? '';
    if (!url.includes('/admin/assistant/stream')) return res;
    state.status = res.status;
    if (!res.ok || !res.body) return res;
    const reader = res.clone().body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const t = performance.now();
          buffer += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const line = buffer.slice(0, sep).split('\n').find((l) => l.startsWith('data:'));
            buffer = buffer.slice(sep + 2);
            if (!line) continue;
            try {
              const ev = JSON.parse(line.slice(5));
              state.frames.push({ t, type: ev.type, ...(ev.name ? { name: ev.name } : {}) });
            } catch {
              state.frames.push({ t, type: 'unparsable' });
            }
          }
        }
      } catch {
        /* 중지(abort) — 그때까지의 프레임만 남는다 */
      }
    })();
    return res;
  };

  window.__chatProbe = {
    reset() {
      state.t0 = null;
      state.status = null;
      state.frames = [];
      state.snapshots = [];
      lastText = null;
    },
    read: () => JSON.parse(JSON.stringify(state)),
    text: chatText,
  };
}
