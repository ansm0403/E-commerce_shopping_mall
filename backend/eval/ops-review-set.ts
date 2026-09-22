/**
 * Ops Companion Phase 4 — 평가 세트 생성·집계 스크립트 (설계 §9 Phase 4 결정 ①②).
 *
 * "v1 vs v2 승인율"을 공정하게 재려면 **같은 인시던트 세트**를 두 프롬프트로 각각 분석하고, 평가자가
 * 버전을 모른 채 채점해야 한다. 이 스크립트가 그 세트를 만든다. 앱 화면은 손대지 않는다 — 분석은 서비스를
 * 직접 부르고(어시스턴트 eval 러너와 같은 Nest 컨텍스트 부팅), 채점은 앱의 평가 탭에서 사람이 한다.
 *
 * 실행 (cwd=backend/):
 *   TS_NODE_PROJECT=eval/tsconfig.eval.json node -r ts-node/register/transpile-only eval/ops-review-set.ts <명령> [옵션]
 *
 * 명령:
 *   list  [--period 30d] [--limit 40] [--readable]
 *                                          Sentry 이슈 후보를 출력한다(id · 프로젝트 · 횟수 · 제목). 여기서 seed/test id 를 고른다.
 *                                          --readable 은 이슈마다 최신 이벤트를 한 번 더 받아(이슈당 Sentry 1회, 60초 캐시) read_source 가
 *                                          읽을 수 있는 파일 수와 읽는 커밋을 열로 찍는다(Phase 6). 0 인 이슈로는 도구 효과를 잴 수 없다(6편 6-4)
 *   seed  --ids a,b,c                      각 id 를 v1(fewShot:false) 로 분석한다 → 앱에서 채점해 승인 풀을 만든다
 *   test  --ids d,e,f [--arms v1,v2] [--allow-empty-pool]
 *                                          각 id 를 --arms 의 버전으로 **각각** 분석한다(번갈아, 기본 v1,v2).
 *                                          v1 = 예시 없음·도구 없음 / v2 = 승인 예시 / v3 = 소스 코드 읽기 도구(Phase 5, 예시 없음).
 *                                          `.1` 접미(v1.1·v2.1·v3.1) = 서비스 지도(배포 구성 사실) 포함 — Phase 5 네 번째 시도 (a).
 *                                          v2 가 포함됐는데 승인 풀이 비어 있으면 중단 — v2 가 v1 과 같은 프롬프트가 돼 비교가 성립하지 않는다.
 *                                          Phase 4 의 test 세트를 `--arms v3` 로 다시 돌리면 같은 인시던트의 v1·v2·v3 가 나란히 생긴다
 *   stats [--after <analysisId>]           promptVersion 별 분석 수·구조화 실패율·승인율·평균 별점.
 *                                          --after 는 그 분석 id 이상만 센다 — v1.1·v3.1 은 Phase 5 에서도 쓴 이름표라 새 세트(Phase 6)만
 *                                          보려면 세트 첫 행의 id 로 자른다.
 *                                          Phase 7: 두 번째 표로 **안내 전(unguided) / 후(guided)** 를 나란히 내고, 확인 항목 4개의 통과/실패 수를 찍는다
 *   notes seed [--ids a,b] [--dry-run]     eval/ops-incident-notes.ts 의 사실 메모를 ops_incident_notes 에 upsert 한다(Phase 7).
 *                                          코드 조각은 서비스가 SourceReaderService.read 로 그 커밋에서 읽어 저장한다(GitHub 접근).
 *                                          같은 인시던트의 옛 분석 행에 project 가 없으면 메모의 project 로 채운다(relatedFiles 정규화 힌트)
 *   notes list                             DB 의 메모 목록(인시던트 · 코드 범위 · 커밋 · 글자 수)
 *   chips --ids 54,55 | --after 54         각 분석의 **조치 코드 이름 대조** 결과(Phase 8 A) — 대기 카드에 붙는 칩과 같은 계산(IdentifierCheckService).
 *                                          채점이 끝난 분석도 볼 수 있다(pending 은 안내 채점이 끝난 카드를 내려주지 않는다). 파일은 GitHub raw(커밋별 Redis 캐시)
 *
 * 옵션:
 *   --delay <ms>   호출 간 대기(기본 13000). 백엔드 상한은 분당 LLM 호출 12회(Phase 5) — v1/v2 는 2회, v3 는 5회를 예약하므로
 *                  v3 를 연달아 돌리면 분당 2건이 한계다. 넘치면 429 를 받고 61초 기다린다(아래 analyzeWithWait)
 *   --dry-run      LLM 을 부르지 않고 무엇을 할지 출력만
 *
 * 주의:
 *   - seed 와 test 의 id 는 **서로 겹치지 않게** 고른다. 겹치면 test 의 v2 가 자기 인시던트의 승인 분석을 예시로 받는다
 *     (서비스가 같은 incident_id 는 제외하지만, seed 에서 만든 v1 행이 곧 test 의 정답지가 되는 셈이다 — 결정 ④ 누수)
 *   - 로컬 백엔드(4000)가 떠 있어도 된다. Redis 의 상한·락을 둘이 공유하므로 합쳐서 분당 5건이다
 *   - 이 프로세스의 폴러(푸시)는 끈다(OPS_PUSH_ENABLED=false). 안 끄면 서버와 둘이 같은 이슈를 폴링해 알림이 두 번 온다
 *   - 실행 기록을 eval/results/ops-review-set-<시각>.json 에 남긴다(어떤 id 로 몇 번 행을 만들었는지 — 학습 노트의 재료)
 *   - Nest 컨텍스트 부팅에 1분 이상 걸린다. 출력을 `| tail` 로 받으면 끝날 때까지 아무것도 안 보인다 — 파일로 리다이렉트할 것
 */
import 'reflect-metadata';
// AppModule 을 import 하기 **전에** 둔다 — ConfigService 는 부팅 시점의 process.env 를 읽는다.
process.env.OPS_PUSH_ENABLED = 'false';

import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { HttpException } from '@nestjs/common';
import { AppModule } from '../src/app/app.module';
import { OpsAnalysisService } from '../src/ops/ops-analysis.service';
import { OpsReviewService } from '../src/ops/ops-review.service';
import { SentryApiClient } from '../src/ops/sentry-api.client';
import { OpsService } from '../src/ops/ops.service';
import { SourceReaderService } from '../src/ops/source-reader.service';
import { OpsNoteService } from '../src/ops/ops-note.service';
import { IdentifierCheckService } from '../src/ops/identifier-check.service';
import { OpsIncidentNoteEntity } from '../src/ops/entity/ops-incident-note.entity';
import { OpsAnalysisEntity } from '../src/ops/entity/ops-analysis.entity';
import { REVIEW_CHECK_KEYS } from '../src/ops/entity/ops-review.entity';
import type { AiAnalysis, AnalysisResponse, ToolCallRecord } from '../src/ops/dto/analysis.dto';
import type { ReviewRateStats } from '../src/ops/dto/review.dto';
import { scrubText } from '../src/common/utils/scrub-text';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { INCIDENT_NOTES } from './ops-incident-notes';
import { sleep } from './eval-utils';

type Command = 'list' | 'seed' | 'test' | 'stats' | 'notes' | 'chips';
type Arm = 'v1' | 'v2' | 'v3' | 'v1.1' | 'v2.1' | 'v3.1';
const ARMS: Arm[] = ['v1', 'v2', 'v3', 'v1.1', 'v2.1', 'v3.1'];
/** 팔 → 분석 옵션. 버전 이름표는 서비스가 프롬프트로 정하므로 여기선 켜고 끄기만 한다. `.1` = 서비스 지도(배포 구성 사실) 포함 */
const ARM_OPTIONS: Record<Arm, { fewShot: boolean; readSource: boolean; serviceMap: boolean }> = {
  v1: { fewShot: false, readSource: false, serviceMap: false },
  v2: { fewShot: true, readSource: false, serviceMap: false },
  v3: { fewShot: false, readSource: true, serviceMap: false },
  'v1.1': { fewShot: false, readSource: false, serviceMap: true },
  'v2.1': { fewShot: true, readSource: false, serviceMap: true },
  'v3.1': { fewShot: false, readSource: true, serviceMap: true },
};

interface Args {
  command: Command;
  ids: string[];
  period: string;
  limit: number;
  delayMs: number;
  dryRun: boolean;
  allowEmptyPool: boolean;
  arms: Arm[];
  /** list: 이슈마다 최신 이벤트를 한 번 더 불러(이슈당 Sentry 1회) read_source 가 읽을 수 있는 파일 수를 센다(Phase 6 결정 ②) */
  readable: boolean;
  /** stats: 이 분석 id 이상만 집계 — 같은 버전 이름표를 쓴 옛 행(Phase 5 의 v1.1·v3.1)과 새 세트를 가른다 */
  after?: number;
  /** notes: 하위 명령(seed | list) */
  sub?: string;
}

interface RunRecord {
  incidentId: string;
  arm: Arm;
  analysisId: number | null;
  status: string | null;
  promptVersion: string | null;
  fewShotIds: number[] | null;
  /** v3: 읽은 파일 기록(null = 도구 미제공). 학습 노트가 "무엇을 읽고 답했나"를 여기서 본다 */
  toolCalls: unknown[] | null;
  latencyMs: number | null;
  error?: string;
}

function parseArgs(argv: string[]): Args {
  const command = argv[0] as Command;
  if (!['list', 'seed', 'test', 'stats', 'notes', 'chips'].includes(command)) {
    console.error('사용법: ops-review-set.ts <list|seed|test|stats|notes seed|notes list|chips> [--ids a,b] [--arms v1,v2,v3] [--period 30d] [--limit 40] [--readable] [--after id] [--delay ms] [--dry-run] [--allow-empty-pool]');
    process.exit(2);
  }
  const sub = command === 'notes' ? argv[1] : undefined;
  if (command === 'notes' && !['seed', 'list'].includes(sub ?? '')) {
    console.error('사용법: ops-review-set.ts notes <seed|list> [--ids a,b] [--dry-run]');
    process.exit(2);
  }
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    command,
    ids: (get('--ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    period: get('--period') ?? '30d',
    limit: Number(get('--limit') ?? 40),
    delayMs: Number(get('--delay') ?? 13_000),
    dryRun: argv.includes('--dry-run'),
    allowEmptyPool: argv.includes('--allow-empty-pool'),
    readable: argv.includes('--readable'),
    after: get('--after') !== undefined ? Number(get('--after')) : undefined,
    sub,
    arms: (get('--arms') ?? 'v1,v2')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is Arm => (ARMS as string[]).includes(s)),
  };
}

/** Gemini 가 일시적으로 거절하는 응답(2026-09-22 실측: `"code":503 … high demand … UNAVAILABLE`). 잠시 뒤 다시 하면 된다 */
function isTransientLlmError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return /UNAVAILABLE|high demand|"code":\s*503|overloaded|RESOURCE_EXHAUSTED|\b429\b/i.test(msg);
}

/**
 * 백엔드 자체 상한(429)·이슈별 락(409)·LLM 의 일시 장애(503/UNAVAILABLE)는 기다렸다 다시 —
 * 그 밖의 에러는 기록만 하고 다음 id 로. 실패한 시도도 분당 상한 칸을 쓰므로 LLM 503 은 30초 뒤에 다시 한다.
 */
async function analyzeWithWait(
  service: OpsAnalysisService,
  incidentId: string,
  arm: Arm,
): Promise<AnalysisResponse> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { item } = await service.analyze(incidentId, { force: true, ...ARM_OPTIONS[arm] });
      return item;
    } catch (e) {
      const status = e instanceof HttpException ? e.getStatus() : null;
      let wait: number | null = null;
      if (status === 429) wait = 61_000;
      else if (status === 409) wait = 10_000;
      else if (status === null && isTransientLlmError(e)) wait = 30_000;
      if (wait !== null && attempt <= 3) {
        console.log(`    ⏳ ${status ?? 'LLM 일시 장애'} — ${Math.round(wait / 1000)}초 후 재시도 (${attempt}/3)`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

function fmtRow(r: RunRecord): string {
  if (r.error) return `  ✗ ${r.incidentId} [${r.arm}] ${r.error}`;
  const tools = r.toolCalls === null ? '' : ` tools=${r.toolCalls.length}`;
  return `  ✓ ${r.incidentId} [${r.arm}] → analysis #${r.analysisId} ${r.status} ${r.promptVersion} fewShot=${r.fewShotIds?.length ?? 0}${tools} ${r.latencyMs}ms`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const analysis = app.get(OpsAnalysisService);
    const review = app.get(OpsReviewService);
    const sentry = app.get(SentryApiClient);
    const ops = app.get(OpsService);

    if (args.command === 'list') {
      if (!sentry.isEnabled()) throw new Error('SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG 미설정');
      const issues = await sentry.listIssues(args.period, { limit: args.limit, sort: 'freq' });
      console.log(`\nSentry 이슈 후보 (${args.period}, 발생 많은 순, ${issues.length}건)\n`);
      console.log(`  id            project                횟수   level    ${args.readable ? '읽기  릴리즈    ' : ''}제목`);
      for (const i of issues) {
        // --readable: 최신 이벤트의 프레임을 normalizeFramePath 에 통과시켜 "읽을 수 있는 파일 수"를 센다.
        // 옛 세트 6건이 전부 0 이었던 것(6편 6-4)을 고를 때 미리 보기 위한 열이다. 0 인 이슈는 test 세트에서 뺀다.
        let extra = '';
        if (args.readable) {
          try {
            const { item } = await ops.getIncident(i.id);
            const seen = new Set<string>();
            for (const f of item.exception?.frames ?? []) {
              const p = SourceReaderService.normalizeFramePath(f.filename, item.project);
              if (p) seen.add(p);
            }
            const rel = item.release ?? '';
            const refLabel = SourceReaderService.COMMIT_REF.test(rel) ? rel.slice(0, 7) : rel ? 'HEAD' : '-';
            extra = `${String(seen.size).padStart(4)}  ${refLabel.padEnd(9)} `;
          } catch (e) {
            extra = `   ?  ${'err'.padEnd(9)} `;
            console.error(`  (상세 조회 실패 ${i.id}: ${(e as Error).message})`);
          }
        }
        console.log(
          `  ${i.id.padEnd(13)} ${(i.project?.slug ?? '-').padEnd(22)} ${String(i.count).padStart(5)}  ${(i.level ?? '-').padEnd(8)} ${extra}${(scrubText(i.title) ?? '').slice(0, 70)}`,
        );
      }
      console.log('\nseed 와 test 는 겹치지 않게 고른다. 예: seed --ids A,B,C / test --ids D,E,F,G,H,I');
      if (args.readable) console.log('읽기 = read_source 가 읽을 수 있는 파일 수(0 이면 도구 효과를 잴 수 없다) · 릴리즈 = 읽는 커밋(HEAD 는 릴리즈가 커밋 꼴이 아님)');
      return;
    }

    if (args.command === 'stats') {
      const { versions } = await review.getStats(args.after !== undefined ? { minAnalysisId: args.after } : {});
      const pct = (n: number | null) => (n === null ? '   -  ' : `${(n * 100).toFixed(1).padStart(5)}%`);
      const avg = (n: number | null) => (n === null ? '-' : n.toFixed(2)).padStart(8);
      console.log(`\npromptVersion 별 집계 (model=simulated 제외${args.after !== undefined ? `, 분석 id ≥ ${args.after}` : ''})\n`);
      console.log('  version  analyses  ok  parse_failed  실패율   reviews  approved  rejected  승인율   평균별점  도구호출');
      for (const v of versions) {
        console.log(
          `  ${v.promptVersion.padEnd(8)} ${String(v.analyses).padStart(8)}  ${String(v.ok).padStart(2)}  ${String(v.parseFailed).padStart(12)}  ${pct(v.parseFailedRate)}  ${String(v.reviews).padStart(7)}  ${String(v.approved).padStart(8)}  ${String(v.rejected).padStart(8)}  ${pct(v.approvalRate)}  ${avg(v.avgRating)}  ${String(v.toolCalled ?? 0).padStart(8)}`,
        );
      }

      // Phase 7 — 안내 전/후. 같은 분석에 두 판정이 나란히 있을 때(재채점) 승인율·별점이 어떻게 움직였나
      console.log('\n안내 전(unguided) / 후(guided) — Phase 7 DoD ②\n');
      console.log('  version  구분        reviews  approved  rejected  승인율   평균별점  메모있음');
      const rateRow = (label: string, r: ReviewRateStats, withNote?: number) =>
        `  ${''.padEnd(8)} ${label.padEnd(10)} ${String(r.reviews).padStart(8)}  ${String(r.approved).padStart(8)}  ${String(r.rejected).padStart(8)}  ${pct(r.approvalRate)}  ${avg(r.avgRating)}  ${withNote === undefined ? '' : String(withNote).padStart(8)}`;
      for (const v of versions) {
        console.log(`  ${v.promptVersion}`);
        console.log(rateRow('안내 전', v.unguided));
        console.log(rateRow('안내 후', v.guided, v.guided.withNote));
      }

      // 확인 항목 4개 — ②(지어낸 식별자) 실패가 어느 팔에서 나오는지가 DoD ③
      console.log('\n확인 항목별 통과/실패/미판단 (안내 채점만) — Phase 7 DoD ③\n');
      console.log(`  version  ${REVIEW_CHECK_KEYS.map((k) => k.padEnd(24)).join('')}`);
      for (const v of versions) {
        const cells = REVIEW_CHECK_KEYS.map((k) => {
          const c = v.guided.checks[k];
          return `✓${c.pass} ✗${c.fail} ?${c.unknown}`.padEnd(24);
        });
        console.log(`  ${v.promptVersion.padEnd(8)} ${cells.join('')}`);
      }
      console.log('\n  ① causeLocation=원인 위치 일치 · ② noInventedIdentifiers=지어낸 식별자 없음 · ③ applicableAsIs=그대로 적용 가능 · ④ confidenceFits=확신도 적정\n');
      return;
    }

    if (args.command === 'chips') {
      // Phase 8 A — DoD ①의 표. listPending 과 같은 입력(정규화된 relatedFiles · 메모 코드 경로/ref · tool_calls)으로 같은 서비스를 부른다.
      const checker = app.get(IdentifierCheckService);
      const analysisRepo = app.get<Repository<OpsAnalysisEntity>>(getRepositoryToken(OpsAnalysisEntity));
      const where = args.ids.length > 0 ? `a.id = ANY($1::int[])` : args.after !== undefined ? `a.id >= $1` : null;
      if (!where) throw new Error('chips 는 --ids 54,55 또는 --after 54 가 필요하다');
      const rows: Array<{
        id: number; incident_id: string; prompt_version: string; project: string | null; result_json: AiAnalysis;
        tool_calls: ToolCallRecord[] | null; code_path: string | null; code_ref: string | null;
      }> = await analysisRepo.query(
        `SELECT a.id, a.incident_id, a.prompt_version, COALESCE(a.project, n.project) AS project, a.result_json, a.tool_calls, n.code_path, n.code_ref
           FROM ops_analyses a LEFT JOIN ops_incident_notes n ON n.incident_id = a.incident_id
          WHERE a.status = 'ok' AND (a.model IS NULL OR a.model <> 'simulated') AND ${where}
          ORDER BY a.id`,
        [args.ids.length > 0 ? args.ids.map(Number) : args.after],
      );
      if (rows.length === 0) throw new Error('해당하는 ok 분석이 없다');
      const inputs = rows.map((r) => ({
        analysisId: r.id,
        incidentId: r.incident_id,
        suggestedFix: r.result_json?.suggestedFix ?? '',
        relatedFiles: OpsReviewService.blindResult(r.result_json, r.project).relatedFiles ?? [],
        toolCalls: Array.isArray(r.tool_calls) ? r.tool_calls : null,
        noteCodePath: r.code_path,
        noteCodeRef: r.code_ref,
      }));
      const started = Date.now();
      const results = await checker.checkMany(inputs);
      console.log(`\n조치 코드 이름 대조 — ${rows.length}장 (${Date.now() - started}ms, 파일은 커밋별 Redis 캐시)\n`);
      console.log('  id   version  incident      대조파일  이름수  실제 코드에 없는 이름                 라이브러리 꼴');
      let caught = 0;
      for (const r of rows) {
        const c = results.get(r.id);
        const cell = c === null || c === undefined ? '(대조할 코드 없음)' : c.checkedCount === 0 ? '(조치에 코드 이름 없음)' : c.unknown.length > 0 ? c.unknown.join(', ') : '✓ 모두 있음';
        if (c && c.unknown.length > 0) caught++;
        console.log(
          `  ${String(r.id).padStart(3)}  ${r.prompt_version.padEnd(8)} ${r.incident_id.padEnd(13)} ${String(c?.checkedFiles.length ?? 0).padStart(8)}  ${String(c?.checkedCount ?? 0).padStart(5)}  ${cell.padEnd(36)} ${(c?.maybeLibrary ?? []).join(', ')}`,
        );
      }
      const files = new Set<string>();
      for (const c of results.values()) for (const f of c?.checkedFiles ?? []) files.add(f);
      console.log(`\n  잡힌 카드 ${caught}/${rows.length} · 대조에 쓴 파일 ${files.size}개:`);
      for (const f of [...files].sort()) console.log(`    ${f}`);
      console.log('\n  ⚠ 같은 인시던트의 두 팔은 같은 파일 집합으로 대조된다(블라인드). 잡지 못하는 것: 다시 쓴 코드(#54) · 파일에 다른 뜻으로 있는 이름(#56 data)\n');
      return;
    }

    if (args.command === 'notes') {
      const noteService = app.get(OpsNoteService);
      const noteRepo = app.get<Repository<OpsIncidentNoteEntity>>(getRepositoryToken(OpsIncidentNoteEntity));
      const analysisRepo = app.get<Repository<OpsAnalysisEntity>>(getRepositoryToken(OpsAnalysisEntity));

      if (args.sub === 'list') {
        const rows = await noteRepo.find({ order: { incidentId: 'ASC' } });
        console.log(`\n사실 메모 ${rows.length}건 (ops_incident_notes)\n`);
        console.log('  incident      project                 코드                                                       글자수(증상/원인/조치/오답)');
        for (const n of rows) {
          const code = n.codePath ? `${n.codePath}:${n.codeStartLine}-${n.codeEndLine}@${(n.codeRef ?? '').slice(0, 7)}` : '(코드 없음)';
          console.log(
            `  ${n.incidentId.padEnd(13)} ${(n.project ?? '-').padEnd(22)}  ${code.padEnd(58)} ${n.symptom.length}/${n.causeLocation.length}/${n.fixDirection.length}/${n.commonMistakes?.length ?? 0}`,
          );
        }
        console.log('');
        return;
      }

      // notes seed — 파일의 메모를 upsert. 코드는 서비스가 읽는다(GitHub raw, 커밋별 Redis 캐시).
      const targets = INCIDENT_NOTES.filter((n) => args.ids.length === 0 || args.ids.includes(n.incidentId));
      if (targets.length === 0) throw new Error('--ids 에 해당하는 메모가 eval/ops-incident-notes.ts 에 없다');
      console.log(`\nnotes seed: ${targets.length}건${args.dryRun ? ' (dry-run)' : ''}\n`);
      let okCount = 0;
      for (const n of targets) {
        const { incidentId, label, ...dto } = n;
        if (args.dryRun) {
          console.log(`  · ${incidentId} ${label} — ${dto.code ? `${dto.code.path}:${dto.code.startLine}-${dto.code.endLine}@${dto.code.ref ?? 'main'}` : '코드 없음'}`);
          continue;
        }
        try {
          const { item, created } = await noteService.upsert(incidentId, dto, null);
          // 옛 분석 행(Phase 7 이전)엔 project 가 없다 → 메모의 project 로 채워 relatedFiles 정규화가 같은 힌트를 쓰게 한다
          const backfilled = dto.project
            ? await analysisRepo
                .createQueryBuilder()
                .update()
                .set({ project: dto.project })
                .where('incident_id = :id AND project IS NULL', { id: incidentId })
                .execute()
            : null;
          okCount++;
          console.log(
            `  ✓ ${incidentId} ${label} — ${created ? 'CREATED' : 'UPDATED'} ${item.code ? `${item.code.path}:${item.code.startLine}-${item.code.endLine}@${item.code.ref.slice(0, 7)} (${item.code.text.split('\n').length}줄)` : '코드 없음'}${
              backfilled?.affected ? ` · 분석 ${backfilled.affected}행 project 채움` : ''
            }`,
          );
        } catch (e) {
          console.log(`  ✗ ${incidentId} ${label} — ${(e as Error).message}`);
        }
      }
      if (!args.dryRun) console.log(`\n완료: ${okCount}/${targets.length}. 다음: 앱 "평가" 탭에서 카드에 "채점 안내"가 보이는지 확인 → 14장 재채점 → stats --after 54\n`);
      return;
    }

    // seed / test
    if (args.ids.length === 0) throw new Error('--ids 가 비어 있다');
    if (!analysis.isEnabled()) throw new Error('GEMINI_API_KEY 미설정 — LLM 을 부를 수 없다');

    const arms: Arm[] = args.command === 'seed' ? ['v1'] : args.arms;
    if (arms.length === 0) throw new Error('--arms 에 v1,v2,v3 중 하나 이상을 적어라');
    if (args.command === 'test' && (arms.includes('v2') || arms.includes('v2.1'))) {
      // 예시 선정은 대상 인시던트를 제외하므로 id 하나로 풀 크기를 가늠한다
      const pool = await review.selectFewShot(args.ids[0]);
      if (pool.length === 0 && !args.allowEmptyPool) {
        throw new Error('승인 풀이 비어 있다 — seed 를 먼저 채점하라. 그래도 진행하려면 --allow-empty-pool (v2 가 v1 과 같아진다)');
      }
      console.log(`승인 풀: ${pool.length}개 (예시 id ${pool.map((p) => p.analysisId).join(', ') || '-'})`);
    }

    const plan = args.ids.flatMap((id) => arms.map((arm) => ({ id, arm })));
    console.log(`\n${args.command}: ${args.ids.length}개 인시던트 × ${arms.join('·')} = ${plan.length}회 분석, 호출 간 ${args.delayMs / 1000}초${args.dryRun ? ' (dry-run)' : ''}\n`);

    const records: RunRecord[] = [];
    for (let i = 0; i < plan.length; i++) {
      const { id, arm } = plan[i];
      if (args.dryRun) {
        console.log(`  · ${id} [${arm}] force=true fewShot=${ARM_OPTIONS[arm].fewShot} readSource=${ARM_OPTIONS[arm].readSource} serviceMap=${ARM_OPTIONS[arm].serviceMap}`);
        continue;
      }
      let rec: RunRecord;
      try {
        const item = await analyzeWithWait(analysis, id, arm);
        rec = {
          incidentId: id,
          arm,
          analysisId: item.id,
          status: item.status,
          promptVersion: item.promptVersion,
          fewShotIds: item.fewShotIds,
          toolCalls: item.toolCalls ?? null,
          latencyMs: item.latencyMs,
        };
        if (item.promptVersion !== arm) {
          rec.error = `${arm} 팔인데 promptVersion=${item.promptVersion} — 승인 풀이 비었거나(v2) 리더가 비활성(v3)이거나 서비스 지도 설정이 다르다`;
        }
      } catch (e) {
        rec = { incidentId: id, arm, analysisId: null, status: null, promptVersion: null, fewShotIds: null, toolCalls: null, latencyMs: null, error: (e as Error).message };
      }
      records.push(rec);
      console.log(fmtRow(rec));
      if (i < plan.length - 1) await sleep(args.delayMs);
    }

    if (!args.dryRun) {
      const dir = path.join(__dirname, 'results');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `ops-review-set-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(
        file,
        JSON.stringify({ runAt: new Date().toISOString(), command: args.command, ids: args.ids, arms, delayMs: args.delayMs, records }, null, 2),
      );
      const okCount = records.filter((r) => !r.error).length;
      console.log(`\n완료: ${okCount}/${records.length} 성공 · 기록 ${path.relative(process.cwd(), file)}`);
      console.log('다음: 앱 "평가" 탭에서 채점 → stats 로 승인율 확인');
    }
  } finally {
    // ⚠ app.close() 가 돌아오지 않는다(스케줄러·Redis 핸들이 남는다 — 2026-09-22 실측: stats 표를 찍고도 프로세스가 안 끝났다).
    // 5초만 기다리고 강제 종료한다. DB 쓰기는 이미 await 로 끝난 뒤라 잃는 것이 없다.
    await Promise.race([app.close(), sleep(5_000)]);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n실패: ${(e as Error).message}`);
    process.exit(1);
  });
