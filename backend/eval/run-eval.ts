/**
 * Phase 7-2 — eval 러너.
 * 골든셋(golden-set.json)의 질문을 AssistantService.chatWithTrace 로 실행해
 * "맞는 도구를 맞는 인자로 불렀는가"를 규칙 기반으로 자동 채점하고,
 * 점수표 출력 + results/<타임스탬프>.json 저장(변경 전/후 비교 = 회귀 감지 근거).
 *
 * 실행(cwd 는 반드시 backend/ — .env·ConfigModule envFilePath 가 cwd 상대):
 *   TS_NODE_PROJECT=eval/tsconfig.eval.json \
 *     node -r ts-node/register/transpile-only eval/run-eval.ts [옵션]
 *
 * 옵션:
 *   --only <id,id,...>          지정 id 만 실행
 *   --difficulty <easy,trap,..> 지정 난이도만 실행
 *   --delay <ms>                케이스 간 대기(기본 5000) — 무료티어 RPM(15/분) 보호
 *
 * 채점 규칙의 SoT 는 golden-set.json 의 _readme(7-1 확정). 여기 구현은 그 규칙을 옮긴 것.
 * behavior_only 케이스의 응답 "태도"(refuse-pii 등)는 채점하지 않고 기록만 — 7-3(LLM-judge) 몫.
 */
import 'reflect-metadata';
import { gradeCase, GoldenCase, GoldenExpect, Difficulty } from './golden-grading';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app/app.module';
import {
  AssistantService,
} from '../src/admin/assistant/assistant.service';
import { ASSISTANT_TOOLS } from '../src/admin/assistant/assistant-tools';
import { LlmUsage } from '../src/intrastructure/ai/llm-client.interface';
import { scrubText } from '../src/common/utils/scrub-text';
import { sleep, callWithRetry429 } from './eval-utils';
import { evaluationToolContext } from '../src/search/tool-execution-context';

// ─────────────────────────────────────────────────────────────
// 골든셋 타입 (golden-set.json 형식 — 7-1)
// ─────────────────────────────────────────────────────────────

interface GoldenSet {
  version: number;
  cases: GoldenCase[];
}

// ─────────────────────────────────────────────────────────────
// 결과 타입 (results/<ts>.json 스키마 — 7-3 judge 의 입력 재료를 겸한다)
// ─────────────────────────────────────────────────────────────

interface CaseResult {
  id: string;
  difficulty: Difficulty;
  behavior: string;
  question: string;
  /** pass/fail = 규칙 채점 결과. error = API 실패(재시도 소진)로 채점 불가. */
  status: 'pass' | 'fail' | 'error';
  violations: string[];
  /** behavior !== 'answer' — 응답 태도는 7-3(LLM-judge)이 판정해야 함을 표시. */
  judgePending: boolean;
  expected: GoldenExpect;
  /** reply 전문 + 도구 결과까지 저장 → 7-3 이 API 재실행 없이 채점 가능. */
  actual?: {
    toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[];
    reply: string;
    usage: LlmUsage | null;
  };
  /** SDK 요청 지점에서 측정. 실패 요청 포함, 도구 건수와 별개. */
  apiRoundTrips?: number;
  error?: string;
}

interface RunReport {
  runAt: string;
  model: string;
  goldenSetVersion: number;
  filter: { only: string[] | null; difficulty: string[] | null };
  /** RPD 소진 추정(연속 3케이스 API 에러)으로 도중 중단됐는지. */
  aborted: boolean;
  summary: {
    planned: number;
    unexecuted: number;
    executed: number;
    toolAccuracy: { pass: number; total: number; pct: number | null };
    /** trap 5종의 "규칙 기준" 통과율 — 태도(거절/안내) 판정은 7-3 몫(결정 C). */
    trapRulePass: { pass: number; total: number };
    byDifficulty: Record<string, string>;
    apiRoundTrips: number;
    usageTotal: { inputTokens: number; outputTokens: number; cachedTokens: number };
    errors: number;
  };
  cases: CaseResult[];
}

// ─────────────────────────────────────────────────────────────
// CLI 파싱
// ─────────────────────────────────────────────────────────────

interface CliOptions {
  only: string[] | null;
  difficulty: string[] | null;
  delayMs: number;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'trap'];

function parseArgs(argv: string[]): CliOptions {
  // 기본 5초 — RPM 15/분에서 케이스당 왕복 2~3회를 지속 가능한 페이스로.
  const opts: CliOptions = { only: null, difficulty: null, delayMs: 5000 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--only':
        if (!value) fail(`--only 뒤에 케이스 id 목록(쉼표 구분)이 필요합니다.`);
        opts.only = value.split(',').map((s) => s.trim()).filter(Boolean);
        i += 1;
        break;
      case '--difficulty': {
        if (!value) fail(`--difficulty 뒤에 난이도 목록(쉼표 구분)이 필요합니다.`);
        const list = value.split(',').map((s) => s.trim()).filter(Boolean);
        const bad = list.filter((d) => !DIFFICULTIES.includes(d as Difficulty));
        if (bad.length) fail(`알 수 없는 난이도: ${bad.join(', ')} (가능: ${DIFFICULTIES.join(', ')})`);
        opts.difficulty = list;
        i += 1;
        break;
      }
      case '--delay': {
        const ms = Number(value);
        if (!Number.isFinite(ms) || ms < 0) fail(`--delay 는 0 이상의 밀리초 숫자여야 합니다: ${value}`);
        opts.delayMs = ms;
        i += 1;
        break;
      }
      default:
        fail(`알 수 없는 옵션: ${flag} (가능: --only, --difficulty, --delay)`);
    }
  }
  return opts;
}

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// 골든셋 로드 + 형식 검증
// ─────────────────────────────────────────────────────────────

function loadGoldenSet(): GoldenSet {
  const file = path.join(__dirname, 'golden-set.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as GoldenSet;
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) fail('골든셋 cases 가 비었습니다.');

  const knownTools = new Set(ASSISTANT_TOOLS.map((t) => t.name));
  const seenIds = new Set<string>();
  for (const c of raw.cases) {
    if (seenIds.has(c.id)) fail(`골든셋 id 중복: ${c.id}`);
    seenIds.add(c.id);
    if (!DIFFICULTIES.includes(c.difficulty)) fail(`[${c.id}] 알 수 없는 difficulty: ${c.difficulty}`);
    if (c.expect.type !== 'tool_call' && c.expect.type !== 'behavior_only')
      fail(`[${c.id}] 알 수 없는 expect.type: ${c.expect.type}`);
    if (c.expect.type === 'tool_call' && (!c.expect.tools || c.expect.tools.length === 0))
      fail(`[${c.id}] tool_call 인데 tools(허용 집합)가 비었습니다.`);
    // 도구 이름 오타를 실행 전에 잡는다(실제 도구 레지스트리와 대조).
    const referenced = [
      ...(c.expect.tools ?? []),
      ...(c.expect.alsoAllowed ?? []),
      ...(c.expect.forbiddenTools ?? []),
    ];
    for (const name of referenced) {
      if (!knownTools.has(name)) fail(`[${c.id}] ASSISTANT_TOOLS 에 없는 도구 이름: ${name}`);
    }
  }
  return raw;
}

// ─────────────────────────────────────────────────────────────
// 전역 불변식 — 비마스킹 PII 검출기 (scrub-text.ts 재활용)
// scrubText 가 바꿀 게 있었다 = 마스킹 안 된 이메일/전화가 있었다.
// ─────────────────────────────────────────────────────────────

function hasUnmaskedPii(text: string): boolean {
  return scrubText(text) !== text;
}

/**
 * §8-10(B) 교훈: 정규식은 "잡을 형식/건드리면 안 될 형식" 샘플로 실측 검증 후 사용.
 * 러너 기동 시마다 돌려, scrub-text 패턴이 바뀌어 검출기가 무뎌지면 즉시 눈치채게 한다.
 */
function selfTestPiiDetector(): void {
  const mustDetect = [
    'kim@example.com',
    '연락처는 010-1234-5678 입니다',
    '01012345678',
    '+82 10-1234-5678',
  ];
  const mustPass = [
    't***@***',            // 마스킹된 이메일
    '전화는 *** 로 마스킹됨', // 마스킹된 전화
    '2026-06-01 ~ 2026-06-30 매출 16,948,800원(142건)', // 날짜·금액
    '주문번호 ORD-20260605-A1B2C3D4',
  ];
  for (const s of mustDetect) {
    if (!hasUnmaskedPii(s)) fail(`PII 검출기 자기검증 실패 — 잡아야 할 형식을 놓침: "${s}"`);
  }
  for (const s of mustPass) {
    if (hasUnmaskedPii(s)) fail(`PII 검출기 자기검증 실패 — 통과해야 할 형식을 오검출: "${s}"`);
  }
}

// ─────────────────────────────────────────────────────────────
// 채점 (순수 함수 — golden-set.json _readme 규칙의 구현)
// ─────────────────────────────────────────────────────────────



// ─────────────────────────────────────────────────────────────
// 실행 — 429 백오프는 eval-utils.ts(7-3 judge 와 공유)로 추출.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// 리포트 (콘솔 점수표 + JSON 저장)
// ─────────────────────────────────────────────────────────────

function buildSummary(results: CaseResult[], planned: GoldenCase[]): RunReport['summary'] {
  const graded = results.filter((r) => r.status !== 'error');
  const toolCases = planned.filter((r) => r.expect.type === 'tool_call');
  const trapCases = planned.filter((r) => r.difficulty === 'trap');
  const toolPass = results.filter((r) => r.expected.type === 'tool_call' && r.status === 'pass').length;

  const byDifficulty: Record<string, string> = {};
  for (const d of DIFFICULTIES) {
    const all = planned.filter((r) => r.difficulty === d);
    if (all.length) byDifficulty[d] = `${results.filter((r) => r.difficulty === d && r.status === 'pass').length}/${all.length}`;
  }

  const usageTotal = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  for (const r of graded) {
    if (r.actual?.usage) {
      usageTotal.inputTokens += r.actual.usage.inputTokens;
      usageTotal.outputTokens += r.actual.usage.outputTokens;
      usageTotal.cachedTokens += r.actual.usage.cachedTokens;
    }
  }

  return {
    planned: planned.length,
    unexecuted: planned.length - results.length,
    executed: results.length,
    toolAccuracy: {
      pass: toolPass,
      total: toolCases.length,
      pct: toolCases.length ? Math.round((toolPass / toolCases.length) * 1000) / 10 : null,
    },
    trapRulePass: {
      pass: results.filter((r) => r.difficulty === 'trap' && r.status === 'pass').length,
      total: trapCases.length,
    },
    byDifficulty,
    apiRoundTrips: results.reduce((sum, r) => sum + (r.apiRoundTrips ?? 0), 0),
    usageTotal,
    errors: results.filter((r) => r.status === 'error').length,
  };
}

function printScoreboard(report: RunReport, savedTo: string): void {
  const s = report.summary;
  const line = '═'.repeat(64);
  console.log(`\n${line}`);
  console.log(`eval 결과 — ${report.runAt} · model=${report.model} · ${s.executed}문항 실행`);
  console.log(line);
  console.log(
    `도구 선택 정확도    ${s.toolAccuracy.pass}/${s.toolAccuracy.total}` +
      (s.toolAccuracy.pct != null ? ` (${s.toolAccuracy.pct}%)` : '') +
      `   ← tool_call 타입만`,
  );
  console.log(
    `trap 통과율(규칙)   ${s.trapRulePass.pass}/${s.trapRulePass.total}   ← 규칙 기준 — 응답 태도 판정은 7-3(LLM-judge) 몫`,
  );
  console.log(
    `난이도별            ${Object.entries(s.byDifficulty)
      .map(([d, v]) => `${d} ${v}`)
      .join(' · ') || '(없음)'}`,
  );
  console.log(
    `API 요청(실측)      ${s.apiRoundTrips}회 · 토큰 input ${s.usageTotal.inputTokens.toLocaleString()}` +
      ` / output ${s.usageTotal.outputTokens.toLocaleString()} / cached ${s.usageTotal.cachedTokens.toLocaleString()}`,
  );
  if (s.errors) console.log(`API 에러(실패 포함)  ${s.errors}건`);
  if (report.aborted) console.log(`⚠ 연속 API 에러로 도중 중단 — 부분 결과입니다.`);

  const failures = report.cases.filter((r) => r.status === 'fail');
  if (failures.length) {
    console.log(`\n실패 케이스 (${failures.length}건):`);
    for (const f of failures) {
      const calledNames = f.actual?.toolCalls.map((t) => t.name).join(', ') || '호출 없음';
      console.log(`  ✗ ${f.id} — 실제 호출 [${calledNames}]`);
      for (const v of f.violations) console.log(`      · ${v}`);
    }
  }
  const errors = report.cases.filter((r) => r.status === 'error');
  for (const e of errors) console.log(`  ⚠ ${e.id} — API 에러: ${e.error}`);

  console.log(`\n결과 저장: ${savedTo}`);
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const golden = loadGoldenSet();
  selfTestPiiDetector();

  // 필터 — 파일 순서 유지(결과 비교 안정성).
  let cases = golden.cases;
  if (opts.only) {
    const unknown = opts.only.filter((id) => !golden.cases.some((c) => c.id === id));
    if (unknown.length) fail(`골든셋에 없는 id: ${unknown.join(', ')}`);
    cases = cases.filter((c) => opts.only!.includes(c.id));
  }
  if (opts.difficulty) cases = cases.filter((c) => opts.difficulty!.includes(c.difficulty));
  if (cases.length === 0) fail('필터 결과 실행할 케이스가 없습니다.');

  console.log(
    `골든셋 v${golden.version} — ${cases.length}/${golden.cases.length}문항 실행` +
      ` (delay=${opts.delayMs}ms${opts.only ? `, only=${opts.only.join(',')}` : ''}${
        opts.difficulty ? `, difficulty=${opts.difficulty.join(',')}` : ''
      })`,
  );
  console.log('NestJS 부팅 중... (postgres/redis 로컬 인프라 필요)');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const svc = app.get(AssistantService);

  const results: CaseResult[] = [];
  let consecutiveErrors = 0;
  let aborted = false;

  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i];
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.id} ... `);
    try {
      const trace = await callWithRetry429(() => svc.chatWithTrace(c.question, evaluationToolContext(`golden:${c.id}`)));
      const { status, violations } = gradeCase(c, trace);
      consecutiveErrors = 0;
      results.push({
        id: c.id,
        difficulty: c.difficulty,
        behavior: c.behavior,
        question: c.question,
        status,
        violations,
        judgePending: c.behavior !== 'answer',
        expected: c.expect,
        actual: { toolCalls: trace.toolCalls, reply: trace.reply, usage: trace.usage },
        apiRoundTrips: trace.llmRequests,
      });
      const calledNames = trace.toolCalls.map((t) => t.name).join(', ') || '호출 없음';
      console.log(`${status === 'pass' ? '✓' : '✗'} [${calledNames}]`);
    } catch (e) {
      consecutiveErrors += 1;
      results.push({
        id: c.id,
        difficulty: c.difficulty,
        behavior: c.behavior,
        question: c.question,
        status: 'error',
        violations: [],
        judgePending: c.behavior !== 'answer',
        expected: c.expect,
        error: 'ASSISTANT_UNAVAILABLE',
        apiRoundTrips: Number((e as { llmRequests?: number }).llmRequests ?? 0),
      });
      console.log('⚠ ASSISTANT_UNAVAILABLE');
      // 백오프로도 3케이스 연속 실패면 일일 한도(RPD) 소진으로 보고 중단 — 남은 콜 낭비 방지.
      if (consecutiveErrors >= 3) {
        console.log('⚠ 연속 3케이스 API 에러 — RPD 소진 추정, 실행을 중단하고 부분 결과를 저장합니다.');
        aborted = true;
        break;
      }
    }
    if (i < cases.length - 1) await sleep(opts.delayMs);
  }

  const report: RunReport = {
    runAt: new Date().toISOString(),
    model: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite',
    goldenSetVersion: golden.version,
    filter: { only: opts.only, difficulty: opts.difficulty },
    aborted,
    summary: buildSummary(results, cases),
    cases: results,
  };

  const resultsDir = path.join(__dirname, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  // Windows 파일명에 ':' 불가 → '-' 치환. (예: 2026-07-22T05-30-00.json)
  const fileName = `${report.runAt.slice(0, 19).replace(/:/g, '-')}.json`;
  const outPath = path.join(resultsDir, fileName);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

  printScoreboard(report, path.relative(process.cwd(), outPath));

  await app.close();
  process.exit(aborted ? 2 : 0);
}

if (require.main === module) main().catch(() => {
  console.error('EVAL_RUNNER_FAILED');
  process.exit(1);
});
