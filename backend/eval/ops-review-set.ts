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
 *   list  [--period 30d] [--limit 40]      Sentry 이슈 후보를 출력한다(id · 프로젝트 · 횟수 · 제목). 여기서 seed/test id 를 고른다
 *   seed  --ids a,b,c                      각 id 를 v1(fewShot:false) 로 분석한다 → 앱에서 채점해 승인 풀을 만든다
 *   test  --ids d,e,f [--arms v1,v2] [--allow-empty-pool]
 *                                          각 id 를 --arms 의 버전으로 **각각** 분석한다(번갈아, 기본 v1,v2).
 *                                          v1 = 예시 없음·도구 없음 / v2 = 승인 예시 / v3 = 소스 코드 읽기 도구(Phase 5, 예시 없음).
 *                                          v2 가 포함됐는데 승인 풀이 비어 있으면 중단 — v2 가 v1 과 같은 프롬프트가 돼 비교가 성립하지 않는다.
 *                                          Phase 4 의 test 세트를 `--arms v3` 로 다시 돌리면 같은 인시던트의 v1·v2·v3 가 나란히 생긴다
 *   stats                                  promptVersion 별 분석 수·구조화 실패율·승인율·평균 별점
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
import type { AnalysisResponse } from '../src/ops/dto/analysis.dto';
import { scrubText } from '../src/common/utils/scrub-text';
import { sleep } from './eval-utils';

type Command = 'list' | 'seed' | 'test' | 'stats';
type Arm = 'v1' | 'v2' | 'v3';
const ARMS: Arm[] = ['v1', 'v2', 'v3'];
/** 팔 → 분석 옵션. 버전 이름표는 서비스가 프롬프트로 정하므로 여기선 켜고 끄기만 한다 */
const ARM_OPTIONS: Record<Arm, { fewShot: boolean; readSource: boolean }> = {
  v1: { fewShot: false, readSource: false },
  v2: { fewShot: true, readSource: false },
  v3: { fewShot: false, readSource: true },
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
  if (!['list', 'seed', 'test', 'stats'].includes(command)) {
    console.error('사용법: ops-review-set.ts <list|seed|test|stats> [--ids a,b] [--arms v1,v2,v3] [--period 30d] [--limit 40] [--delay ms] [--dry-run] [--allow-empty-pool]');
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

    if (args.command === 'list') {
      if (!sentry.isEnabled()) throw new Error('SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG 미설정');
      const issues = await sentry.listIssues(args.period, { limit: args.limit, sort: 'freq' });
      console.log(`\nSentry 이슈 후보 (${args.period}, 발생 많은 순, ${issues.length}건)\n`);
      console.log('  id            project                횟수   level    제목');
      for (const i of issues) {
        console.log(
          `  ${i.id.padEnd(13)} ${(i.project?.slug ?? '-').padEnd(22)} ${String(i.count).padStart(5)}  ${(i.level ?? '-').padEnd(8)} ${(scrubText(i.title) ?? '').slice(0, 70)}`,
        );
      }
      console.log('\nseed 와 test 는 겹치지 않게 고른다. 예: seed --ids A,B,C / test --ids D,E,F,G,H,I');
      return;
    }

    if (args.command === 'stats') {
      const { versions } = await review.getStats();
      console.log('\npromptVersion 별 집계 (model=simulated 제외)\n');
      console.log('  version  analyses  ok  parse_failed  실패율   reviews  approved  rejected  승인율   평균별점  도구호출');
      for (const v of versions) {
        const pct = (n: number | null) => (n === null ? '   -  ' : `${(n * 100).toFixed(1).padStart(5)}%`);
        console.log(
          `  ${v.promptVersion.padEnd(8)} ${String(v.analyses).padStart(8)}  ${String(v.ok).padStart(2)}  ${String(v.parseFailed).padStart(12)}  ${pct(v.parseFailedRate)}  ${String(v.reviews).padStart(7)}  ${String(v.approved).padStart(8)}  ${String(v.rejected).padStart(8)}  ${pct(v.approvalRate)}  ${(v.avgRating === null ? '-' : v.avgRating.toFixed(2)).padStart(8)}  ${String(v.toolCalled ?? 0).padStart(8)}`,
        );
      }
      console.log('');
      return;
    }

    // seed / test
    if (args.ids.length === 0) throw new Error('--ids 가 비어 있다');
    if (!analysis.isEnabled()) throw new Error('GEMINI_API_KEY 미설정 — LLM 을 부를 수 없다');

    const arms: Arm[] = args.command === 'seed' ? ['v1'] : args.arms;
    if (arms.length === 0) throw new Error('--arms 에 v1,v2,v3 중 하나 이상을 적어라');
    if (args.command === 'test' && arms.includes('v2')) {
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
        console.log(`  · ${id} [${arm}] force=true fewShot=${ARM_OPTIONS[arm].fewShot} readSource=${ARM_OPTIONS[arm].readSource}`);
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
        if (arm === 'v2' && item.promptVersion !== 'v2') {
          rec.error = `v2 팔인데 promptVersion=${item.promptVersion} — 이 인시던트에 쓸 예시가 없었다(자기 자신 제외 후 풀 0개)`;
        }
        if (arm === 'v3' && item.promptVersion !== 'v3') {
          rec.error = `v3 팔인데 promptVersion=${item.promptVersion} — 소스 읽기 리더가 비활성(OPS_SOURCE_READ_ENABLED=false)인가`;
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
