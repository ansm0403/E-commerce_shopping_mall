#!/usr/bin/env node
/**
 * API 다운 프로브 — "백엔드가 죽었을 때 프론트 Sentry 가 무엇을 보내는가"를 센다.
 * 블로그 docs/blog/sentry-axios-silent-failure.md §4·§11 의 대조군 실험(B: /api 전부 차단)을 저장소에 옮긴 것.
 *
 * 하는 일: 헤드리스 Chrome 으로 첫 화면을 한 번 열되, 브라우저 안에서 `/api/**` 를 전부 connectionrefused 로 끊는다
 * (서버 무접촉 — 끊긴 요청은 Vercel·EC2 에 닿지 않는다). 그동안 Sentry 로 나가는 envelope 을 가로채
 * 아이템 종류(event/session/replay…)와 에러 이벤트의 내용(fingerprint · api.path 태그)을 기록한다.
 *
 * 모드:
 *  - 기본(차단): Sentry 요청을 **보내지 않고** 본문만 읽는다 → "SDK 가 보내려 한 이벤트 수". 쿼터 0.
 *  - --allow-sentry: 실제로 보낸다 → Sentry 가 받았는지(HTTP 상태)까지 기록. 쿼터를 쓴다(README 참고).
 *
 * 실행(저장소 루트):
 *   node scripts/probe/api-down.mjs                                   # 운영 첫 화면, 차단 모드, 1회
 *   node scripts/probe/api-down.mjs --runs 3 --allow-sentry --json probe-api-down.json
 *   node scripts/probe/api-down.mjs --control                         # 대조군 C: 아무것도 끊지 않음
 *
 * 주의:
 *  - 매 회 새 브라우저 컨텍스트 = 새 탭이다. reportApiError 의 억제 상태(60초·탭당 10건)는 탭 메모리라 회차끼리 섞이지 않는다.
 *  - 첫 화면의 일부 데이터는 Vercel 서버 컴포넌트가 미리 받아 온다 — 브라우저 차단과 무관하게 그려질 수 있다(학습 노트 7편 6-4).
 *  - playwright-core 는 브라우저를 내려받지 않는다 → 설치된 Google Chrome(channel:'chrome').
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const args = parseArgs(process.argv.slice(2));
const BASE = args.base.replace(/\/$/, '');
const SENTRY_RE = /\/monitoring(\?|$)|sentry\.io/;

function parseArgs(argv) {
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  return {
    base: get('--base', 'https://shopping-mall-frontend-dusky.vercel.app'),
    path: get('--path', '/'),
    runs: Number(get('--runs', '1')),
    waitMs: Number(get('--wait', '15000')),
    allowSentry: argv.includes('--allow-sentry'),
    control: argv.includes('--control'),
    headed: argv.includes('--headed'),
    json: get('--json', null),
  };
}

/**
 * Sentry envelope = 줄 단위. 1행 헤더, 이후 (아이템 헤더, 페이로드) 쌍. replay 페이로드는 바이너리라
 * JSON 으로 안 읽히는 줄은 건너뛴다 — 아이템 헤더의 type 만 있으면 종류는 셀 수 있다.
 */
function parseEnvelope(buf) {
  const lines = buf.toString('utf8').split('\n');
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    let h;
    try { h = JSON.parse(lines[i]); } catch { continue; }
    if (!h || typeof h.type !== 'string') continue;
    let payload = null;
    try { payload = JSON.parse(lines[i + 1] ?? ''); } catch { /* 바이너리 */ }
    items.push({ type: h.type, payload });
    i++;
  }
  return items;
}

function summarizeEvent(ev) {
  const ex = ev?.exception?.values?.[0];
  const tags = ev?.tags ?? {};
  return {
    eventId: ev?.event_id ?? null,
    timestamp: ev?.timestamp ? new Date(ev.timestamp * 1000).toISOString() : null,
    exception: ex ? `${ex.type}: ${ex.value}` : ev?.message ?? null,
    fingerprint: ev?.fingerprint ?? null,
    apiPath: tags['api.path'] ?? null,
    apiStatus: tags['api.status'] ?? null,
    fromReportApiError: Array.isArray(ev?.fingerprint) && ev.fingerprint[0] === 'api',
  };
}

async function runOnce(browser, n) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const itemCounts = {};
  const events = [];
  const sentryResponses = [];
  let apiBlocked = 0;
  const startedAt = new Date();

  await page.route(SENTRY_RE, async (route) => {
    const buf = route.request().postDataBuffer();
    if (buf) {
      for (const it of parseEnvelope(buf)) {
        itemCounts[it.type] = (itemCounts[it.type] ?? 0) + 1;
        if (it.type === 'event' && it.payload) events.push(summarizeEvent(it.payload));
      }
    }
    if (!args.allowSentry) return route.abort();
    const res = await route.fetch();
    sentryResponses.push(res.status());
    return route.fulfill({ response: res });
  });

  if (!args.control) {
    await page.route('**/api/**', (route) => {
      apiBlocked++;
      return route.abort('connectionrefused');
    });
  }

  await page.goto(`${BASE}${args.path}`, { waitUntil: 'load', timeout: 60_000 });
  // 재시도(TanStack Query 기본 3회, 지수 백오프)와 SDK 전송 지연이 끝날 때까지 기다린다
  await page.waitForTimeout(args.waitMs);
  await context.close();

  return {
    run: n,
    startedAt: startedAt.toISOString(),
    mode: args.control ? 'control(C)' : 'api-down(B)',
    apiBlocked,
    itemCounts,
    errorEvents: events.length,
    fromReportApiError: events.filter((e) => e.fromReportApiError).length,
    distinctFingerprints: [...new Set(events.map((e) => JSON.stringify(e.fingerprint)))].length,
    sentryHttp: args.allowSentry ? sentryResponses : 'blocked(not sent)',
    events,
  };
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: !args.headed });
  } catch (e) {
    throw new Error(`Chrome 을 못 열었다 — 설치된 Google Chrome 이 필요하다. ${e.message}`);
  }
  console.log(
    `\nAPI 다운 프로브 ${args.runs}회 → ${BASE}${args.path} · ${args.control ? '대조군(차단 없음)' : '/api 전부 차단'} · ` +
      `${args.allowSentry ? 'Sentry 실제 전송' : 'Sentry 차단(본문만 읽음, 쿼터 0)'} · 대기 ${args.waitMs}ms\n`,
  );
  const results = [];
  for (let i = 1; i <= args.runs; i++) {
    const r = await runOnce(browser, i);
    results.push(r);
    const kinds = Object.entries(r.itemCounts).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음';
    console.log(`  #${i} ${r.startedAt}  api 차단 ${r.apiBlocked}회  에러 이벤트 ${r.errorEvents}건(reportApiError ${r.fromReportApiError}) · 지문 ${r.distinctFingerprints}종  [${kinds}]`);
    for (const e of r.events) console.log(`       - ${e.apiPath ?? '-'} ${e.apiStatus ?? ''}  ${String(e.exception).slice(0, 70)}  ${e.eventId ?? ''}`);
    if (args.allowSentry) console.log(`       Sentry 응답: ${r.sentryHttp.join(', ') || '없음'}`);
  }
  await browser.close();
  const total = results.reduce((s, r) => s + r.errorEvents, 0);
  console.log(`\n  합계 에러 이벤트 ${total}건 / ${args.runs}회\n`);
  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ runAt: new Date().toISOString(), base: BASE, path: args.path, allowSentry: args.allowSentry, control: args.control, results }, null, 2));
    console.log(`  기록: ${args.json}\n`);
  }
}

main().catch((e) => {
  console.error(`\n실패: ${e.message}`);
  process.exit(1);
});
