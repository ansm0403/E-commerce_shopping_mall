import 'reflect-metadata';
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AssistantTraceError } from '../../src/admin/assistant/assistant.service';
import type { AssistantTraceResult, AssistantToolTrace } from '../../src/admin/assistant/assistant.service';
import { maskAssistantValue } from '../../src/admin/assistant/assistant-masking';
import type { EmbeddingClient } from '../../src/intrastructure/ai/embedding-client.interface';
import type { LlmClient } from '../../src/intrastructure/ai/llm-client.interface';
import type { LlmFailure } from '../../src/intrastructure/ai/llm-failure';
import type { InquirySearchResult } from '../../src/search/search-contract';
import { SearchError } from '../../src/search/search-error';
import { evaluationToolContext } from '../../src/search/tool-execution-context';
import { inquiryAnswerFinalCases, inquiryAnswerFinalSources, INQUIRY_ANSWER_FINAL_VERSION, INQUIRY_ANSWER_FINAL_CRITERIA } from './inquiry-final-fixture';
import { inquiryAnswerV2Cases, inquiryAnswerV2Sources, INQUIRY_ANSWER_FINAL_V2_VERSION, INQUIRY_ANSWER_FINAL_V2_CRITERIA } from './inquiry-final-fixture-v2';
import { inquiryAnswerV3Cases, inquiryAnswerV3Sources, INQUIRY_ANSWER_FINAL_V3_VERSION, INQUIRY_ANSWER_FINAL_V3_CRITERIA } from './inquiry-final-fixture-v3';
import { EvalEmbeddingClient, createEvalDatabase, prepareInquiries } from './search-eval-environment';
import { PacedEvalLlmClient, codeVersion, sumUsage } from './eval-observations';
import { syntheticInquiryAssistant } from './synthetic-inquiry-assistant';
import { inquiryToolObservations } from './inquiry-answer-observations';

const protectedText = (value: unknown) => /PRIVATE_INQUIRY|fixture(?:-answer)?@example\.com|010-1234-5678/.test(JSON.stringify(value));
type Planned = typeof inquiryAnswerFinalCases[number];
function observations(item: Planned, trace: AssistantTraceResult, corpus: typeof inquiryAnswerFinalSources) {
  const calls = trace.toolCalls.filter(call => call.name === 'summarize_inquiries');
  const valid = calls.filter(call => typeof call.args.query === 'string' && call.args.productId === item.productId &&
    call.args.status === item.status && call.args.startDate === item.startDate && call.args.endDate === item.endDate);
  const sources = valid.flatMap(call => (call.result as InquirySearchResult).data?.sources ?? []);
  const ids = [...new Set(sources.map(source => source.id))];
  const cited = [...trace.reply.matchAll(/(?:#|문의\s*)(\d+)/g)].map(match => Number(match[1]));
  return { ...inquiryToolObservations(item, trace.toolCalls),
    unexpectedTools: trace.toolCalls.filter(call => call.name !== 'summarize_inquiries').map(call => call.name),
    statuses: calls.map(call => (call.result as InquirySearchResult).status), returnedIds: ids, citedIds: cited,
    hitAt5: item.noEvidence ? null : Number(item.relevantIds.some(id => ids.includes(id))),
    recallAt5: item.noEvidence ? null : item.relevantIds.filter(id => ids.includes(id)).length / item.relevantIds.length,
    citationIdsSupplied: cited.every(id => ids.includes(id)), relevantSourceCited: cited.some(id => item.relevantIds.includes(id)),
    privateSourcesReturned: sources.filter(source => corpus.some(original => original.id === source.id && original.isSecret)).length,
    rawContactLeaks: Number(protectedText(trace)),
    caveat: 'Tool-selected-query retrieval observations, not fixed-query A/B scores or answer correctness. Agent and human must inspect the original facts, polarity and unsupported claims.' };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--live' && !/^--only=[a-z0-9,-]+$/.test(arg) && !/^--fixture=(final-v1|final-v2|final-v3)$/.test(arg)) || args.filter(arg => arg === '--live').length > 1 || args.filter(arg => arg.startsWith('--only=')).length > 1 || args.filter(arg => arg.startsWith('--fixture=')).length > 1) throw new Error('INVALID_ARGUMENTS');
  // v3 is the frozen final; v1 and v2 were already run and are kept as improvement diagnostics.
  const fixture = args.includes('--fixture=final-v1') ? 'v1' : args.includes('--fixture=final-v2') ? 'v2' : 'v3';
  const frozenFinal = fixture === 'v3';
  const allCases = { v1: inquiryAnswerFinalCases, v2: inquiryAnswerV2Cases, v3: inquiryAnswerV3Cases }[fixture];
  const corpus = { v1: inquiryAnswerFinalSources, v2: inquiryAnswerV2Sources, v3: inquiryAnswerV3Sources }[fixture];
  const fixtureVersion = { v1: INQUIRY_ANSWER_FINAL_VERSION, v2: INQUIRY_ANSWER_FINAL_V2_VERSION, v3: INQUIRY_ANSWER_FINAL_V3_VERSION }[fixture];
  const criteria = { v1: INQUIRY_ANSWER_FINAL_CRITERIA, v2: INQUIRY_ANSWER_FINAL_V2_CRITERIA, v3: INQUIRY_ANSWER_FINAL_V3_CRITERIA }[fixture];
  const fixtureFile = { v1: 'inquiry-final-fixture.ts', v2: 'inquiry-final-fixture-v2.ts', v3: 'inquiry-final-fixture-v3.ts' }[fixture];
  const selected = args.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
  if (selected && (new Set(selected).size !== selected.length || selected.some(id => !allCases.some(item => item.caseId === id)))) throw new Error('UNKNOWN_CASE_ID');
  const planned = selected ? allCases.filter(item => selected.includes(item.caseId)) : allCases;
  const fixtureSha256 = createHash('sha256').update(readFileSync(join(__dirname, fixtureFile))).digest('hex');
  if (!args.includes('--live')) {
    console.log(JSON.stringify({ live: false, fixtureVersion, fixtureSha256, fixtureRole: frozenFinal ? 'frozen-final' : 'improvement-diagnostic', planned: planned.length,
      masterPlanned: 30, executed: 0, llmRequests: 0, embeddingRequests: 0, criteria,
      instruction: 'Add --live for this frozen synthetic evaluation. --only selects a separately reported partial run; no whole-turn replay. Three consecutive terminal errors stop the run.' }));
    return;
  }
  const config = new ConfigService();
  const cases: { caseId: string; question: string; expected: Planned; trace: AssistantTraceResult | null; executedTools: AssistantToolTrace[];
    elapsedMs: number; llmRequests: number; requestFailures: LlmFailure[]; errorCode: string | null; observations: ReturnType<typeof observations> | null; humanReview: 'pending' }[] = [];
  let environment: Awaited<ReturnType<typeof createEvalDatabase>> | undefined;
  let embeddings: EvalEmbeddingClient | undefined;
  let errorCode: string | null = null;
  let llmRequests = 0; let protectedInputViolations = 0; let modelBoundaryViolations = 0; let consecutiveErrors = 0;
  const failures: LlmFailure[] = [];
  const started = performance.now();
  const stop = new AbortController();
  const totalTimer = setTimeout(() => stop.abort(), 30 * 60000);
  process.once('SIGINT', () => stop.abort());
  let currentTools: AssistantToolTrace[] = [];
  try {
    embeddings = new EvalEmbeddingClient(config);
    const paced = new PacedEvalLlmClient(config);
    if (!embeddings.isEnabled() || !paced.isEnabled()) throw new SearchError('EMBEDDING_DISABLED');
    const guardedEmbeddings: EmbeddingClient = { model: embeddings.model, dimensions: embeddings.dimensions, isEnabled: () => embeddings!.isEnabled(),
      async embed(inputs, signal, guard) {
        if (inputs.some(protectedText)) { protectedInputViolations++; throw new SearchError('INVALID_INPUT'); }
        return embeddings!.embed(inputs, signal ? AbortSignal.any([signal, stop.signal]) : stop.signal, guard);
      } };
    const observed: LlmClient = { isEnabled: () => paced.isEnabled(), generate: params => paced.generate(params), generateStream: params => paced.generateStream(params),
      async *generateWithTools(params) {
        if (protectedText(params.messages)) { modelBoundaryViolations++; throw new SearchError('INVALID_INPUT'); }
        yield* paced.generateWithTools({ ...params,
          onRequest: () => { llmRequests++; params.onRequest?.(); },
          onRequestFailure: failure => { failures.push(failure); params.onRequestFailure?.(failure); },
          executeTool: async call => {
            const result = await params.executeTool(call);
            if (protectedText(result)) { modelBoundaryViolations++; throw new SearchError('INVALID_INPUT'); }
            currentTools.push({ name: call.name, args: maskAssistantValue(call.args) as Record<string, unknown>, result });
            return result;
          },
        });
      } };
    environment = await createEvalDatabase();
    await prepareInquiries(environment.db, corpus, guardedEmbeddings);
    const { service } = syntheticInquiryAssistant(environment.db, corpus, guardedEmbeddings, observed);
    for (const item of planned) {
      if (stop.signal.aborted) { errorCode = 'EVALUATION_ABORTED'; break; }
      currentTools = []; const beforeRequests = llmRequests; const beforeFailures = failures.length; const caseStarted = performance.now();
      let trace: AssistantTraceResult | null = null; let failure: string | null = null;
      const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(Number(config.get('GEMINI_TURN_TIMEOUT_MS', 180000)) + 15000)]);
      try {
        trace = await service.chatWithTrace(item.question, evaluationToolContext(item.caseId, signal));
        if (inquiryToolObservations(item, currentTools).terminalSearchFailure) failure = 'SEARCH_REQUEST_FAILED';
      } catch (error) { failure = error instanceof AssistantTraceError ? error.code : error instanceof SearchError ? error.code : 'ASSISTANT_EVALUATION_FAILED'; }
      const measured = trace ? observations(item, trace, corpus) : null;
      if (measured?.privateSourcesReturned || measured?.rawContactLeaks || protectedInputViolations || modelBoundaryViolations) failure = 'PROTECTION_VIOLATION';
      cases.push({ caseId: item.caseId, question: item.question, expected: item, trace, executedTools: currentTools,
        elapsedMs: performance.now() - caseStarted, llmRequests: llmRequests - beforeRequests, requestFailures: failures.slice(beforeFailures), errorCode: failure, observations: measured, humanReview: 'pending' });
      console.log(JSON.stringify({ answered: item.caseId, errorCode: failure, llmRequests: llmRequests - beforeRequests, scopeMatched: measured?.scopeMatched }));
      consecutiveErrors = failure ? consecutiveErrors + 1 : 0;
      if (failure === 'PROTECTION_VIOLATION' || consecutiveErrors >= 3) { errorCode = failure === 'PROTECTION_VIOLATION' ? failure : 'STOPPED_AFTER_ERRORS'; break; }
    }
  } catch (error) { errorCode = error instanceof SearchError ? error.code : 'INQUIRY_ANSWER_EVALUATION_FAILED'; }
  finally {
    clearTimeout(totalTimer);
    try { await environment?.close(); } catch { errorCode ??= 'EVALUATION_CLEANUP_FAILED'; }
  }
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const result = { runId, split: 'final', sourceType: 'inquiry', live: true, fixtureVersion, fixtureSha256, fixtureRole: frozenFinal ? 'frozen-final' : 'improvement-diagnostic',
    codeVersion: codeVersion(), runnerSha256: createHash('sha256').update(readFileSync(__filename)).digest('hex'), criteria,
    model: config.get('GEMINI_MODEL', 'gemini-3.1-flash-lite'), frozenTodayKst: '2026-10-14',
    masterPlanned: 30, fullSuite: !selected, planned: planned.length, executed: cases.length, unexecuted: planned.length - cases.length,
    completedReplies: cases.filter(item => item.trace).length, apiErrors: cases.filter(item => item.errorCode).length, errorCode,
    llmRequests, sdkRequestFailures: failures.length, requestFailures: failures, usage: sumUsage(cases.map(item => item.trace?.usage)),
    usageCompleteness: 'Successful completed traces only; recovered/failed SDK attempts can consume tokens without supplied usage. No whole-turn replay.',
    syntheticInquiries: corpus.length, originalInquiries: 0, publicInquiries: corpus.filter(item => !item.isSecret).length, secretInquiries: corpus.filter(item => item.isSecret).length,
    userDatabaseAccess: false, embeddingUsageThisRun: embeddings?.actual.snapshot() ?? null, generated: embeddings?.generated, cacheHits: embeddings?.cacheHits,
    protection: { protectedInputViolations, modelBoundaryViolations, privateSourcesReturned: cases.reduce((sum, item) => sum + (item.observations?.privateSourcesReturned ?? 0), 0), rawContactLeaks: cases.reduce((sum, item) => sum + (item.observations?.rawContactLeaks ?? 0), 0) },
    humanReviewPending: planned.length, finalAnswerSuccessRate: null, elapsedMs: performance.now() - started,
    limitations: 'One frozen synthetic run in an isolated probe schema. No HTTP latency or production load claim. No final answer quality score until a person reviews each case.', cases };
  const directory = join(__dirname, '../results'); mkdirSync(directory, { recursive: true });
  const output = join(directory, `search-inquiry-answer-final-${runId}.json`);
  writeFileSync(output, JSON.stringify(maskAssistantValue(result), null, 2) + '\n');
  console.log(JSON.stringify({ output, planned: result.planned, executed: result.executed, completedReplies: result.completedReplies, apiErrors: result.apiErrors, llmRequests, embeddingRequests: result.embeddingUsageThisRun?.requests, errorCode, humanReviewPending: result.humanReviewPending }));
  if (errorCode || result.apiErrors || result.unexecuted) process.exitCode = 1;
}
main().catch(() => { console.error('INQUIRY_ANSWER_EVALUATION_CONFIGURATION_FAILED'); process.exitCode = 1; });
