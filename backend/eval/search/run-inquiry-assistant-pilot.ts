import 'reflect-metadata';
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AssistantService, AssistantTraceError } from '../../src/admin/assistant/assistant.service';
import type { AssistantTraceResult, AssistantToolTrace } from '../../src/admin/assistant/assistant.service';
import { maskAssistantValue } from '../../src/admin/assistant/assistant-masking';
import type { EmbeddingClient } from '../../src/intrastructure/ai/embedding-client.interface';
import type { LlmClient } from '../../src/intrastructure/ai/llm-client.interface';
import type { LlmFailure } from '../../src/intrastructure/ai/llm-failure';
import { SemanticSearchService } from '../../src/search/semantic-search.service';
import { SearchIndexRecorder } from '../../src/search/search-index-recorder';
import { SearchError } from '../../src/search/search-error';
import { INITIAL_SEARCH_PROFILE as PROFILE } from '../../src/search/search-profile';
import { evaluationToolContext } from '../../src/search/tool-execution-context';
import type { InquirySearchResult } from '../../src/search/search-contract';
import { scrubText } from '../../src/common/utils/scrub-text';
import { finalInquiries, finalInquiryCases, INQUIRY_FINAL_VERSION } from './inquiry-fixture';
import type { InquiryEvalCase } from './inquiry-fixture';
import { EvalEmbeddingClient, createEvalDatabase, prepareInquiries } from './search-eval-environment';
import { PacedEvalLlmClient, codeVersion, sumUsage } from './eval-observations';
import { confirmationInquiries, confirmationInquiryCases, INQUIRY_CONFIRMATION_VERSION,
  INQUIRY_CONFIRMATION_CRITERIA } from './inquiry-pilot-confirmation-fixture';

const ALIASES = { title: 'inquiry-final-1-waiting', absent: 'inquiry-final-1-absent' } as const;
const CONFIRMATION_ALIASES = { title: 'inquiry-confirmation-title', absent: 'inquiry-confirmation-absent' } as const;
type Alias = keyof typeof ALIASES;
type Fixture = 'initial' | 'confirmation';
const protectedText = (value: unknown) => /PRIVATE_INQUIRY|fixture(?:-answer)?@example\.com|010-1234-5678/.test(JSON.stringify(value));

interface PilotCase {
  alias: Alias;
  caseId: string;
  question: string;
  expected: InquiryEvalCase;
  elapsedMs: number;
  llmRequests: number;
  requestFailures: LlmFailure[];
  errorCode: string | null;
  trace: AssistantTraceResult | null;
  executedTools: AssistantToolTrace[];
  observations: ReturnType<typeof observe> | null;
  humanReview: 'pending';
}

function plannedCase(alias: Alias, fixture: Fixture) {
  const dataset = fixture === 'confirmation' ? confirmationInquiryCases : finalInquiryCases;
  const aliases = fixture === 'confirmation' ? CONFIRMATION_ALIASES : ALIASES;
  const frozen = dataset.find(item => item.caseId === aliases[alias]);
  if (!frozen) throw new Error('UNKNOWN_FIXTURE_CASE');
  // Each pilot is a standalone turn, so it cannot depend on a previous question's dates.
  const question = fixture === 'confirmation' ? frozen.question :
    frozen.question.replace('같은 기간', '2026년 10월 1일부터 13일까지') + ' 의미 검색으로 확인하고 문의 ID와 실제 원문을 인용해줘.';
  return { alias, caseId: frozen.caseId, question, expected: { ...frozen, question } };
}

function observe(item: InquiryEvalCase, trace: AssistantTraceResult, secretIds: readonly number[]) {
  const calls = trace.toolCalls.filter(call => call.name === 'summarize_inquiries');
  const semantic = calls.filter(call => typeof call.args.query === 'string');
  const matching = semantic.filter(call => call.args.productId === item.productId && call.args.status === item.status &&
    call.args.startDate === item.startDate && call.args.endDate === item.endDate);
  const results = semantic.map(call => call.result as InquirySearchResult);
  const sources = results.flatMap(result => result.data?.sources ?? []);
  const citedIds = [...trace.reply.matchAll(/(?:#|문의\s*)(\d+)/g)].map(match => Number(match[1]));
  return {
    inquirySemanticCallCount: semantic.length,
    expectedScopeUsed: matching.length > 0 && matching.length === semantic.length,
    unexpectedToolNames: trace.toolCalls.filter(call => call.name !== 'summarize_inquiries').map(call => call.name),
    resultStatuses: results.map(result => result.status),
    returnedSourceIds: [...new Set(sources.map(source => source.id))],
    citedIds,
    citationIdsSupplied: citedIds.every(id => sources.some(source => source.id === id)),
    expectedSourceCited: citedIds.some(id => item.relevantIds.includes(id)),
    noEvidenceAcknowledged: /근거.{0,30}(없|못)|찾.{0,20}못|확인.{0,20}(없|못|않)|관련.{0,25}(없|못)/.test(trace.reply),
    secretSourcesReturned: sources.filter(source => secretIds.includes(source.id)).length,
    rawContactOrPrivateMarkerLeaks: Number(protectedText(trace)),
    caveat: 'Scope/citation observations only. Polarity, relevant facts, unsupported claims and answer correctness require human review; absent-case candidates are not positive evidence.',
  };
}

/** Default is a dry run. Only explicit --live permits requests using synthetic fixtures. */
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--live' && !/^--cases=(title|absent)(,(title|absent))*$/.test(arg) && !/^--fixture=(initial|confirmation)$/.test(arg)) ||
    args.filter(arg => arg === '--live').length > 1 || args.filter(arg => arg.startsWith('--cases=')).length > 1 ||
    args.filter(arg => arg.startsWith('--fixture=')).length > 1) throw new Error('INVALID_ARGUMENTS');
  const fixture: Fixture = args.includes('--fixture=confirmation') ? 'confirmation' : 'initial';
  const inquiriesCorpus = fixture === 'confirmation' ? confirmationInquiries : finalInquiries;
  const fixtureVersion = fixture === 'confirmation' ? INQUIRY_CONFIRMATION_VERSION : INQUIRY_FINAL_VERSION;
  const secretIds = inquiriesCorpus.filter(source => source.isSecret).map(source => source.id);
  const selected = (args.find(arg => arg.startsWith('--cases='))?.slice('--cases='.length).split(',') ?? ['title', 'absent']) as Alias[];
  if (new Set(selected).size !== selected.length) throw new Error('INVALID_ARGUMENTS');
  const planned = selected.map(alias => plannedCase(alias, fixture));
  if (!args.includes('--live')) {
    console.log(JSON.stringify({ live: false, planned: planned.length, executed: 0, llmRequests: 0, embeddingRequests: 0,
      selectedCaseIds: planned.map(item => item.caseId), fixture, fixtureVersion,
      instruction: 'Add --live to run only these synthetic standalone cases. Optional --cases=title,absent and --fixture=confirmation. Stop at the first failure; no whole-turn retry.' }));
    return;
  }

  const cases: PilotCase[] = [];
  const config = new ConfigService();
  const started = performance.now();
  const requestTimeoutMs = Number(config.get('GEMINI_REQUEST_TIMEOUT_MS', 60000));
  const turnTimeoutMs = Number(config.get('GEMINI_TURN_TIMEOUT_MS', 180000));
  const pilotTimeoutMs = turnTimeoutMs + 15000;
  let environment: Awaited<ReturnType<typeof createEvalDatabase>> | undefined;
  let actualEmbeddings: EvalEmbeddingClient | undefined;
  let errorCode: string | null = null;
  let chunkCount = 0;
  let protectedInputViolations = 0;
  let modelBoundaryViolations = 0;
  let llmRequests = 0;
  const requestFailures: LlmFailure[] = [];
  try {
    actualEmbeddings = new EvalEmbeddingClient(config);
    const paced = new PacedEvalLlmClient(config);
    if (!paced.isEnabled() || !actualEmbeddings.isEnabled()) throw new SearchError('EMBEDDING_DISABLED');
    const embeddings: EmbeddingClient = {
      model: PROFILE.model, dimensions: PROFILE.dimensions, isEnabled: () => actualEmbeddings!.isEnabled(),
      async embed(inputs, signal, guard) {
        if (inputs.some(input => protectedText(input))) { protectedInputViolations++; throw new SearchError('INVALID_INPUT'); }
        return actualEmbeddings!.embed(inputs, signal, guard);
      },
    };
    let currentTools: AssistantToolTrace[] = [];
    const observed: LlmClient = {
      isEnabled: () => paced.isEnabled(), generate: params => paced.generate(params), generateStream: params => paced.generateStream(params),
      async *generateWithTools(params) {
        if (protectedText(params.messages)) { modelBoundaryViolations++; throw new SearchError('INVALID_INPUT'); }
        yield* paced.generateWithTools({ ...params,
          onRequest: () => { llmRequests++; params.onRequest?.(); },
          onRequestFailure: failure => { requestFailures.push(failure); params.onRequestFailure?.(failure); },
          executeTool: async call => {
            const result = await params.executeTool(call);
            if (protectedText(result)) { modelBoundaryViolations++; throw new SearchError('INVALID_INPUT'); }
            currentTools.push({ name: scrubText(call.name) ?? '', args: maskAssistantValue(call.args) as Record<string, unknown>, result });
            return result;
          },
        });
      },
    };
    environment = await createEvalDatabase();
    chunkCount = await prepareInquiries(environment.db, inquiriesCorpus, embeddings);
    const searchConfig = new ConfigService({ AI_SEARCH_REVIEWS_ENABLED: 'false', AI_SEARCH_INQUIRIES_ENABLED: 'true' });
    const search = new SemanticSearchService(environment.db, searchConfig, embeddings, new SearchIndexRecorder(searchConfig));
    const productIds = [...new Set(inquiriesCorpus.map(source => source.productId))];
    const products = { getProductIdsByCategoryIds: async () => productIds,
      findAllAdmin: async () => ({ data: productIds.map(id => ({ id, name: `합성 상품 ${id}`, category: { name: '합성 평가' } })), meta: { total: productIds.length } }) };
    const categories = { getCategoryIdsByName: async (name: string) => name === '합성 평가' ? [1] : [] };
    const inquiries = { getInquiriesForAssistant: async (filter: { productIds?: number[]; status?: string; startDate?: string; endDate?: string; take?: number }) =>
      inquiriesCorpus.filter(source => !source.isSecret && (!filter.productIds || filter.productIds.includes(source.productId)) &&
        (!filter.status || source.status === filter.status) && (!filter.startDate || Date.parse(source.createdAt) >= Date.parse(filter.startDate)) &&
        (!filter.endDate || Date.parse(source.createdAt) <= Date.parse(filter.endDate)))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id).slice(0, filter.take ?? 30)
        .map(source => maskAssistantValue({ id: source.id, productId: source.productId, status: source.status, isSecret: false,
          title: source.title, content: source.content, answer: source.answer, createdAt: new Date(source.createdAt) })) };
    const service = new AssistantService(observed,
      { getSalesSummary: async () => ({ totalRevenue: 0, orderCount: 0 }), getOrderStats: async () => ({ total: 0, byStatus: {} }) } as never,
      { getAuditLogs: async () => ({ data: [], meta: { total: 0 } }) } as never, products as never, categories as never,
      { getReviewsForAssistant: async () => [] } as never, inquiries as never, {} as never, {} as never, search);
    Object.assign(service, { todayKst: () => '2026-10-13' });

    for (const item of planned) {
      currentTools = [];
      const caseStarted = performance.now();
      const initialRequests = llmRequests;
      const initialFailures = requestFailures.length;
      let trace: AssistantTraceResult | null = null;
      let caseError: string | null = null;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), pilotTimeoutMs);
      try {
        trace = await service.chatWithTrace(item.question, evaluationToolContext(`inquiry-pilot-${item.alias}`, abort.signal));
        const failedSearch = currentTools.find(call => call.name === 'summarize_inquiries' &&
          ['unavailable', 'indexing', 'invalid_arguments', 'forbidden', 'unsupported'].includes((call.result as InquirySearchResult).status));
        if (failedSearch) caseError = 'SEARCH_REQUEST_FAILED';
      } catch (error) {
        caseError = error instanceof AssistantTraceError ? error.code : error instanceof SearchError ? error.code : 'ASSISTANT_PILOT_FAILED';
        if (abort.signal.aborted && caseError === 'ABORTED') caseError = 'PILOT_TIMEOUT';
      } finally { clearTimeout(timer); }
      const observations = trace ? observe(item.expected, trace, secretIds) : null;
      if (observations?.secretSourcesReturned || observations?.rawContactOrPrivateMarkerLeaks || protectedInputViolations || modelBoundaryViolations) caseError = 'PROTECTION_VIOLATION';
      cases.push({ ...item, trace, executedTools: currentTools, elapsedMs: performance.now() - caseStarted,
        llmRequests: llmRequests - initialRequests, requestFailures: requestFailures.slice(initialFailures), errorCode: caseError, observations, humanReview: 'pending' });
      console.log(JSON.stringify({ answered: item.caseId, errorCode: caseError, llmRequests: llmRequests - initialRequests }));
      if (caseError) { errorCode = caseError; break; }
    }
  } catch (error) { errorCode = error instanceof AssistantTraceError ? error.code : error instanceof SearchError ? error.code : 'INQUIRY_ASSISTANT_PILOT_FAILED'; }
  finally {
    try { await environment?.close(); }
    catch { errorCode ??= 'PILOT_CLEANUP_FAILED'; }
  }
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const result = {
    runId, live: true, fixture, fixtureVersion, model: config.get('GEMINI_MODEL', 'gemini-3.1-flash-lite'), profile: PROFILE,
    criteria: fixture === 'confirmation' ? INQUIRY_CONFIRMATION_CRITERIA : null,
    initialDiagnosticPlan: fixture === 'confirmation' ? { planned: 2, fixtureVersion: INQUIRY_FINAL_VERSION,
      role: 'Initial pilot became improvement diagnostic material; preserve its original artifacts and exclude it from confirmation metrics.' } : null,
    codeVersion: codeVersion(), runnerSha256: createHash('sha256').update(readFileSync(__filename)).digest('hex'),
    dateKst: '2026-10-13', selectedCaseIds: planned.map(item => item.caseId), masterPlanned: 2,
    planned: planned.length, executed: cases.length, unexecuted: planned.length - cases.length, repetitions: 1,
    apiErrors: cases.filter(item => item.errorCode && item.errorCode !== 'PROTECTION_VIOLATION').length,
    errorCode, llmRequests, sdkRequestFailures: requestFailures.length, requestFailures,
    usage: sumUsage(cases.map(item => item.trace?.usage)),
    usageCompleteness: 'SDK usage from successful completed traces only; failed/recovered SDK attempts can consume tokens without supplied usage. SDK failures include recovered retries. No whole-turn retries.',
    timeouts: { requestTimeoutMs, turnTimeoutMs, pilotTimeoutMs }, elapsedMs: performance.now() - started,
    syntheticInquiries: inquiriesCorpus.length, originalInquiries: 0, publicInquiries: inquiriesCorpus.filter(source => !source.isSecret).length,
    secretInquiries: secretIds.length, chunkCount, userDatabaseAccess: false,
    embeddingUsageThisRun: actualEmbeddings?.actual.snapshot() ?? null, generated: actualEmbeddings?.generated ?? null, cacheHits: actualEmbeddings?.cacheHits ?? null,
    protection: { protectedInputViolations, modelBoundaryViolations,
      secretSourcesReturned: cases.reduce((sum, item) => sum + (item.observations?.secretSourcesReturned ?? 0), 0),
      rawContactOrPrivateMarkerLeaks: cases.reduce((sum, item) => sum + (item.observations?.rawContactOrPrivateMarkerLeaks ?? 0), 0) },
    humanReviewPending: cases.length,
    limitations: 'Two bounded synthetic standalone cases at most; real Gemini, real dispatcher, exact vector search in an isolated probe schema. Cached actual embeddings may be reused. First terminal failure stops remaining cases. No HTTP/browser authentication measurement, production performance claim, full answer evaluation or automatic answer correctness score. Human review is pending.',
    cases,
  };
  const directory = join(__dirname, '../results'); mkdirSync(directory, { recursive: true });
  const output = join(directory, `search-inquiry-assistant-pilot-${runId}.json`);
  const humanOutput = join(directory, `search-inquiry-assistant-human-review-${runId}.md`);
  writeFileSync(output, JSON.stringify(maskAssistantValue(result), null, 2) + '\n');
  const human = [`# 공개 문의 어시스턴트 소규모 검토`, '', `- 자료: ${fixtureVersion}; 합성 문의만 사용; 사용자 DB 접근 없음`,
    `- 계획 ${result.planned} / 실행 ${result.executed} / 미실행 ${result.unexecuted}; SDK 요청 ${llmRequests}; 실패 관측 ${requestFailures.length}`,
    '- 사람 판정: 전체 pending. 아래 관측값은 답변 정확성 점수가 아니다.', '',
    ...planned.flatMap(item => {
      const measured = cases.find(answer => answer.caseId === item.caseId);
      return [`## ${item.caseId}`, '', `질문: ${item.question}`, '', `기대 원문 ID: ${item.expected.relevantIds.join(', ') || '없음'}`,
        `판정 근거: ${item.expected.reason}`, '', `실행: ${measured ? measured.errorCode ?? '완료' : '미실행'}`, '사람 판정: pending', '',
        '실제 도구 인자·결과:', '', '```json', JSON.stringify(maskAssistantValue(measured?.executedTools ?? []), null, 2), '```', '',
        '실제 답변:', '', measured?.trace?.reply ?? '(완료된 답변 없음)', '',
        '검토: 조건 보존, 공개 원문 ID/정확한 인용, 제목·본문·답변 구분, 비밀/연락처 보호, 근거 없음과 실패 구분, 지원하지 않는 사실 추가 여부.', ''];
    })].join('\n');
  writeFileSync(humanOutput, (scrubText(human) ?? '') + '\n');
  console.log(JSON.stringify({ output, humanOutput, planned: result.planned, executed: result.executed, unexecuted: result.unexecuted,
    llmRequests, sdkRequestFailures: requestFailures.length, errorCode, humanReviewPending: result.humanReviewPending }));
  if (errorCode || result.unexecuted) process.exitCode = 1;
}
main().catch(() => { console.error('INQUIRY_ASSISTANT_PILOT_CONFIGURATION_FAILED'); process.exitCode = 1; });
