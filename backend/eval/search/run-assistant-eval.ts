import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AssistantTraceError, AssistantTraceResult } from '../../src/admin/assistant/assistant.service';
import { evaluationToolContext } from '../../src/search/tool-execution-context';
import type { ReviewSearchResult } from '../../src/search/search-contract';
import { scrubText } from '../../src/common/utils/scrub-text';
import { INITIAL_SEARCH_PROFILE } from '../../src/search/search-profile';
import { SearchError } from '../../src/search/search-error';
import type { LlmFailure } from '../../src/intrastructure/ai/llm-failure';
import { finalCases, finalReviews, FINAL_CRITERIA, FINAL_FIXTURE_VERSION, FinalCase } from './final-fixture';
import { finalV2Cases, finalV2Reviews, FINAL_V2_CRITERIA, FINAL_V2_VERSION } from './final-fixture-v2';
import { EvalEmbeddingClient, createEvalDatabase, prepareReviews } from './search-eval-environment';
import { PacedEvalLlmClient, codeVersion, sumUsage } from './eval-observations';
import { syntheticAssistant } from './synthetic-assistant';
import { gradeCase, GoldenCase } from '../golden-grading';

interface MeasuredAnswer {
  caseId: string; question: string; expected: unknown; trace: AssistantTraceResult | null; llmRequests: number;
  elapsedMs: number; errorCode: string | null; necessaryChecks: Record<string, unknown> | null; humanReview: 'pending';
  attempts: { llmRequests: number; errorCode: string | null; requestFailures: LlmFailure[] }[];
}
function checkFinal(item: FinalCase, trace: AssistantTraceResult) {
  const calls = trace.toolCalls.filter(call => call.name === 'summarize_reviews');
  const valid = calls.filter(call => typeof call.args.query === 'string' && call.args.productId === item.productId &&
    call.args.startDate === item.startDate && call.args.endDate === item.endDate && (item.maxRating === null ? call.args.maxRating === undefined : call.args.maxRating === item.maxRating));
  const sources = valid.flatMap(call => (call.result as ReviewSearchResult).data?.sources ?? []);
  const cited = [...trace.reply.matchAll(/(?:#|리뷰\s*)(\d+)/g)].map(match => Number(match[1]));
  const noEvidenceAcknowledged = /근거.{0,25}(없|못)|찾.{0,15}못|불만.{0,20}(없|확인되지)/.test(trace.reply);
  const flags = { validScope: valid.length > 0 && calls.length === valid.length,
    citationIdsSupplied: cited.every(id => sources.some(source => source.id === id)),
    citedRelevant: cited.some(id => item.relevantIds.includes(id)), factsPresent: item.answerFacts.every(fact => trace.reply.includes(fact)),
    noEvidenceAcknowledged, noUnmaskedContacts: scrubText(trace.reply) === trace.reply,
    semanticOk: valid.some(call => (call.result as ReviewSearchResult).status === 'ok') };
  return { ...flags, necessaryChecksPass: flags.validScope && flags.citationIdsSupplied && flags.noUnmaskedContacts && flags.semanticOk &&
    (item.noEvidence ? noEvidenceAcknowledged : flags.citedRelevant && flags.factsPresent),
    caveat: 'Necessary automated checks only. Polarity, grounded facts and completeness require developer review of all 30 final answers.' };
}

async function main() {
  const version = codeVersion();
  const args = process.argv.slice(2);
  if (!args.length || args.length > 2 || !['--split=regression', '--split=final', '--split=final-v2'].includes(args[0]) ||
    (args[1] && (args[0] !== '--split=regression' || !/^--only=[a-z0-9,-]+$/.test(args[1])))) throw new Error('INVALID_ARGUMENTS');
  const v2 = args[0] === '--split=final-v2';
  const final = v2 || args[0] === '--split=final';
  const reviews = v2 ? finalV2Reviews : finalReviews;
  const golden = JSON.parse(readFileSync(join(__dirname, '../golden-set.json'), 'utf8')) as { version: number; cases: GoldenCase[] };
  const allCases = final ? (v2 ? finalV2Cases : finalCases).map(item => ({ caseId: item.caseId, question: item.question, expected: item })) : golden.cases.map(item => ({ caseId: item.id, question: item.question, expected: item }));
  const selected = args[1]?.slice('--only='.length).split(',');
  if (selected?.some(id => !allCases.some(item => item.caseId === id))) throw new Error('UNKNOWN_CASE_ID');
  const planned = selected ? allCases.filter(item => selected.includes(item.caseId)) : allCases;
  const environment = await createEvalDatabase(); const config = new ConfigService();
  const embeddings = new EvalEmbeddingClient(config, final); const llm = new PacedEvalLlmClient(config);
  const cases: MeasuredAnswer[] = []; let errorCode: string | null = null; let consecutiveErrors = 0;
  try {
    await prepareReviews(environment.db, reviews, embeddings);
    const service = syntheticAssistant(environment.db, reviews, embeddings, llm);
    for (const item of planned) {
      const started = performance.now(); let trace: AssistantTraceResult | null = null; let code: string | null = null; let requests = 0;
      const attempts: MeasuredAnswer['attempts'] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          trace = await service.chatWithTrace(item.question, evaluationToolContext(item.caseId));
          attempts.push({ llmRequests: trace.llmRequests, errorCode: null, requestFailures: trace.llmRequestFailures }); requests += trace.llmRequests; code = null; consecutiveErrors = 0; break;
        } catch (error) {
          code = error instanceof AssistantTraceError ? error.code : 'ASSISTANT_UNAVAILABLE';
          const count = error instanceof AssistantTraceError ? error.llmRequests : 0;
          attempts.push({ llmRequests: count, errorCode: code, requestFailures: error instanceof AssistantTraceError ? error.llmRequestFailures : [] }); requests += count;
          if (!['LLM_RATE_LIMIT', 'LLM_UNAVAILABLE', 'LLM_TIMEOUT', 'LLM_NETWORK_ERROR', 'ASSISTANT_UNAVAILABLE'].includes(code) || attempt === 1) { consecutiveErrors++; break; }
          await new Promise(resolve => setTimeout(resolve, 12000));
        }
      }
      const checks = trace ? final ? checkFinal(item.expected as FinalCase, trace) : gradeCase(item.expected as GoldenCase, trace) : null;
      cases.push({ ...item, trace, llmRequests: requests, elapsedMs: performance.now() - started, errorCode: code, necessaryChecks: checks, humanReview: 'pending', attempts });
      console.log(JSON.stringify({ answered: item.caseId, errorCode: code, checks }));
      if (consecutiveErrors >= 3) { errorCode = 'EVALUATION_STOPPED_AFTER_ERRORS'; break; }
    }
  } catch (error) {
    const sqlCode = String((error as { code?: unknown })?.code ?? '');
    errorCode = error instanceof SearchError ? error.code : /^[0-9A-Z]{5}$/.test(sqlCode) ? `SQL_${sqlCode}` : error instanceof TypeError ? 'EVALUATION_TYPE_ERROR' : 'ASSISTANT_EVALUATION_FAILED';
  }
  finally { await environment.close(); }
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const toolCases = planned.filter(item => (item.expected as GoldenCase).expect?.type === 'tool_call');
  const result = { runId, split: final ? 'final' : 'regression', model: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite', profile: INITIAL_SEARCH_PROFILE,
    fixtureVersion: v2 ? FINAL_V2_VERSION : FINAL_FIXTURE_VERSION, goldenVersion: golden.version, dateKst: '2026-10-13', codeVersion: version, criteria: v2 ? FINAL_V2_CRITERIA : FINAL_CRITERIA,
    syntheticReviews: 100, originalReviews: 0, repetitions: 1, planned: planned.length, executed: cases.length, unexecuted: planned.length - cases.length, errorCode,
    fullSuite: selected === undefined, selectedCaseIds: selected ?? null, masterPlanned: allCases.length,
    apiErrors: cases.filter(item => item.errorCode).length, llmRequests: cases.reduce((sum, item) => sum + item.llmRequests, 0), usage: sumUsage(cases.map(item => item.trace?.usage)),
    sdkRequestFailures: cases.reduce((sum, item) => sum + item.attempts.reduce((n, attempt) => n + attempt.requestFailures.length, 0), 0),
    usageCompleteness: 'Provided SDK usage on successful traces only. Failed/retried SDK requests may consume tokens without supplied usage; request failures are recorded separately.',
    failedAttempts: cases.reduce((sum, item) => sum + item.attempts.filter(attempt => attempt.errorCode).length, 0),
    embeddingUsageThisRun: embeddings.actual.snapshot(), generated: embeddings.generated, cacheHits: embeddings.cacheHits,
    toolRegression: final ? null : { passed: cases.filter(item => toolCases.some(test => test.caseId === item.caseId) && item.necessaryChecks?.status === 'pass').length, planned: toolCases.length },
    finalNecessaryChecks: final ? { evidence: { passed: cases.filter(item => !(item.expected as FinalCase).noEvidence && item.necessaryChecks?.necessaryChecksPass).length, planned: 20 },
      noEvidence: { passed: cases.filter(item => (item.expected as FinalCase).noEvidence && item.necessaryChecks?.necessaryChecksPass).length, planned: 10 } } : null,
    humanReviewPending: cases.length, limitations: 'Synthetic fixture; one repetition. Necessary checks are not answer correctness. Developer must review all final answers. CLI elapsed time includes per-request quota pacing, not HTTP latency.', cases };
  const output = join(__dirname, '../results', `search-assistant-${result.split}-${runId}.json`); mkdirSync(join(__dirname, '../results'), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ output, llmRequests: result.llmRequests, apiErrors: result.apiErrors, toolRegression: result.toolRegression, finalNecessaryChecks: result.finalNecessaryChecks }));
  if (errorCode || result.apiErrors || result.unexecuted || (result.toolRegression && result.toolRegression.passed !== result.toolRegression.planned)) process.exitCode = 1;
}
main().catch(() => { console.error('ASSISTANT_EVALUATION_CONFIGURATION_FAILED'); process.exitCode = 1; });
