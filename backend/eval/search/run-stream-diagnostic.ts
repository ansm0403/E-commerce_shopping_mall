import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AssistantService } from '../../src/admin/assistant/assistant.service';
import { maskAssistantValue } from '../../src/admin/assistant/assistant-masking';
import { GeminiClient } from '../../src/intrastructure/ai/providers/gemini.client';
import { classifyLlmFailure, LlmFailure } from '../../src/intrastructure/ai/llm-failure';
import type { LlmClient } from '../../src/intrastructure/ai/llm-client.interface';
import { INITIAL_SEARCH_PROFILE as PROFILE } from '../../src/search/search-profile';
import { kstDayEndExclusive, kstDayStart, ReviewSearchInput } from '../../src/search/search-input';
import type { ReviewSearchResult } from '../../src/search/search-contract';
import { normalizeSearchText } from '../../src/search/search-document';
import { scrubText } from '../../src/common/utils/scrub-text';

const QUESTIONS = {
  rating: '상품 577의 2점 이하 리뷰에서 소매가 조여 움직이기 어렵다는 불만을 의미 검색으로 찾아줘. 리뷰 ID와 원문을 인용해줘.',
  period: '상품 577의 2026년 10월 1일부터 12일까지 리뷰에서 소매가 조여 움직이기 어렵다는 불만을 의미 검색으로 찾아줘.',
  mold: '상품 577 리뷰에서 빵에 곰팡이가 생겼다는 불만을 의미 검색으로 찾아줘. 리뷰 ID와 원문을 인용해줘.',
} as const;

/** Same dispatcher/stream/prompt as the app; fixed synthetic result, no DB or embedding calls. */
function fixtureService(llm: LlmClient) {
  const createdAt = '2026-10-13T04:58:06.826Z';
  const text = normalizeSearchText('팔 부분이 꽉 끼어서 움직이기 불편합니다. test@example.com, 010-1234-5678');
  const search = { isReviewsEnabled: () => true, searchReviews: async (args: ReviewSearchInput): Promise<ReviewSearchResult> => {
    const matches = (args.productIds === undefined || args.productIds.includes(577)) &&
      (args.maxRating === undefined || args.maxRating >= 5) &&
      (!args.startDate || Date.parse(createdAt) >= Date.parse(kstDayStart(args.startDate))) &&
      (!args.endDate || Date.parse(createdAt) < Date.parse(kstDayEndExclusive(args.endDate)));
    return { status: matches ? 'ok' : 'no_data', mode: 'semantic',
      scope: { sourceType: 'review', timezone: 'Asia/Seoul', unit: 'source', profileId: PROFILE.id,
        ...args, query: normalizeSearchText(args.query), take: args.take ?? 5, checkedAt: new Date().toISOString() },
      coverage: { total: matches ? 1 : 0, ready: matches ? 1 : 0, pending: 0, failed: 0, partial: false },
      data: { sources: matches ? [{ sourceType: 'review', id: 1874, productId: 577, rating: 5, createdAt, quotes: [{ chunkIndex: 0, text }] }] : [],
        candidateChunkCount: matches ? 1 : 0, omittedSourceCount: 0, contextTruncated: false }, error: null };
  } };
  const rows: { id: number; role: 'user' | 'assistant'; content: string }[] = [];
  const messages = { create: (value: object) => value, save: async (value: object) => {
    const row = { id: rows.length + 1, ...value }; rows.push(row as never); return row;
  }, find: async () => [...rows].reverse() };
  const conversations = { create: (value: object) => value, save: async (value: object) => ({ id: 1, ...value }), findOne: async () => null };
  return new AssistantService(llm, {} as never, {} as never, {} as never,
    { getCategoryIdsByName: async () => [] } as never,
    { getReviewsForAssistant: async () => [] } as never, {} as never,
    conversations as never, messages as never, search as never);
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log(JSON.stringify({ live: false, llmRequests: 0, instruction: 'Use --live --case=rating|period|mold to diagnose one fixed synthetic question.' }));
    return;
  }
  const selected = args[1]?.replace(/^--case=/, '') as keyof typeof QUESTIONS;
  if (args.length !== 2 || args[0] !== '--live' || !args[1].startsWith('--case=') || !Object.hasOwn(QUESTIONS, selected)) throw new Error('INVALID_ARGUMENTS');
  const config = new ConfigService(); const gemini = new GeminiClient(config);
  if (!gemini.isEnabled()) throw new Error('LLM_DISABLED');
  let llmRequests = 0; let failure: LlmFailure | null = null;
  const requestFailures: LlmFailure[] = [];
  const tools: { name: string; args: unknown; result: unknown }[] = [];
  const observed: LlmClient = {
    isEnabled: () => gemini.isEnabled(), generate: params => gemini.generate(params), generateStream: params => gemini.generateStream(params),
    async *generateWithTools(params) {
      try {
        yield* gemini.generateWithTools({ ...params, onRequest: () => { llmRequests++; params.onRequest?.(); },
          onRequestFailure: observedFailure => { requestFailures.push(observedFailure); params.onRequestFailure?.(observedFailure); }, executeTool: async call => {
          const result = await params.executeTool(call);
          tools.push({ name: scrubText(call.name) ?? '', args: maskAssistantValue(call.args), result });
          return result;
        } });
      } catch (error) { failure = classifyLlmFailure(error, params.signal?.aborted); throw error; }
    },
  };
  const requestTimeoutMs = Number(config.get('GEMINI_REQUEST_TIMEOUT_MS', 60000));
  const turnTimeoutMs = Number(config.get('GEMINI_TURN_TIMEOUT_MS', 180000));
  const diagnosticTimeoutMs = turnTimeoutMs + 15000;
  const service = fixtureService(observed); const signal = AbortSignal.timeout(diagnosticTimeoutMs);
  const started = performance.now(); const eventTypes: string[] = []; let reply = ''; let errorMessage: string | null = null;
  for await (const event of service.streamChat({ message: QUESTIONS[selected], adminUserId: 1, roles: ['admin'], requestId: `diagnostic-${selected}` }, signal)) {
    eventTypes.push(event.type);
    if (event.type === 'text') reply += event.delta;
    if (event.type === 'error') errorMessage = event.message;
  }
  const measuredFailure = failure as LlmFailure | null;
  const errorCode = measuredFailure?.code ?? (signal.aborted ? 'DIAGNOSTIC_TIMEOUT' : errorMessage ? 'ASSISTANT_UNAVAILABLE' : null);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const result = { runId, caseId: selected, question: QUESTIONS[selected], model: config.get('GEMINI_MODEL', 'gemini-3.1-flash-lite'),
    planned: 1, executed: 1, llmRequests, requestFailures, errorCode, httpStatus: measuredFailure?.httpStatus ?? null,
    timeouts: { requestTimeoutMs, turnTimeoutMs, diagnosticTimeoutMs },
    elapsedMs: performance.now() - started, eventTypes, errorMessage, reply: scrubText(reply) ?? '', tools,
    fixture: { syntheticReviews: 1, userDatabaseAccess: false, embeddingRequests: 0 },
    caveat: 'Current live API probe using the app service/prompt/dispatcher/stream with a fixed synthetic search result. No HTTP authentication or real DB/vector search. Does not establish the cause of previous failures or answer correctness.' };
  const output = join(__dirname, '../results', `search-stream-diagnostic-${runId}.json`);
  mkdirSync(join(__dirname, '../results'), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, llmRequests, errorCode, httpStatus: result.httpStatus, eventTypes }));
  if (errorCode || !eventTypes.includes('done')) process.exitCode = 1;
}
main().catch(() => { console.error('STREAM_DIAGNOSTIC_CONFIGURATION_FAILED'); process.exitCode = 1; });
