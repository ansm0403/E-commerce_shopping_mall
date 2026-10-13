import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingClient } from '../../src/intrastructure/ai/embedding-client.interface';
import { SemanticSearchService } from '../../src/search/semantic-search.service';
import { SearchIndexRecorder } from '../../src/search/search-index-recorder';
import { INITIAL_SEARCH_PROFILE as PROFILE } from '../../src/search/search-profile';
import { evaluationToolContext } from '../../src/search/tool-execution-context';
import { queryInput } from '../../src/search/search-document';
import { searchTable } from '../../src/search/search-sql';
import { kstDayEndExclusive, kstDayStart } from '../../src/search/search-input';
import { SearchError } from '../../src/search/search-error';
import { codeVersion } from './eval-observations';
import { EvalEmbeddingClient, createEvalDatabase, prepareInquiries, score } from './search-eval-environment';
import {
  improvementInquiries, improvementInquiryCases, finalInquiries, finalInquiryCases, mockInquiryVector,
  INQUIRY_IMPROVEMENT_VERSION, INQUIRY_FINAL_VERSION, INQUIRY_FINAL_CRITERIA,
} from './inquiry-fixture';
import type { InquiryEvalCase } from './inquiry-fixture';

type InquirySearchRun = Awaited<ReturnType<SemanticSearchService['searchInquiriesWithTrace']>>;
interface MeasuredCase extends InquiryEvalCase {
  searchStatus: InquirySearchRun['result']['status'];
  baseline: ReturnType<typeof score> & { ids: number[] };
  semantic: ReturnType<typeof score> & { ids: number[] } & InquirySearchRun;
  queryEmbeddingPreparation: { generatedAt: string; elapsedMs: number } | null;
}

/** A mock run validates SQL and citation handling. Only explicit live runs measure embedding retrieval. */
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--split=improvement', '--split=final', '--embedding=mock', '--embedding=live'].includes(arg)) ||
    args.filter(arg => arg.startsWith('--split=')).length > 1 || args.filter(arg => arg.startsWith('--embedding=')).length > 1) throw new Error('INVALID_ARGUMENTS');
  const final = args.includes('--split=final');
  const live = args.includes('--embedding=live');
  const planned = final ? finalInquiryCases : improvementInquiryCases;
  const inquiries = final ? finalInquiries : improvementInquiries;
  const config = new ConfigService({ AI_SEARCH_INQUIRIES_ENABLED: 'true' });
  const actual = live ? new EvalEmbeddingClient(config) : null;
  let mockCalls = 0;
  let protectedInputViolations = 0;
  const embeddings: EmbeddingClient = {
    model: PROFILE.model, dimensions: PROFILE.dimensions, isEnabled: () => actual?.isEnabled() ?? true,
    async embed(inputs, signal, guard) {
      if (inputs.some(input => /PRIVATE_INQUIRY|fixture(?:-answer)?@example\.com|010-1234-5678/.test(input))) {
        protectedInputViolations++;
        throw new SearchError('INVALID_INPUT');
      }
      if (actual) return actual.embed(inputs, signal, guard);
      if (signal?.aborted) throw new SearchError('ABORTED');
      await guard?.();
      mockCalls++;
      return { vectors: inputs.map(mockInquiryVector), usage: { requests: 0, inputCodePoints: 0, inputBytes: 0, inputTokens: null } };
    },
  };
  const cases: MeasuredCase[] = [];
  let environment: Awaited<ReturnType<typeof createEvalDatabase>> | undefined;
  let errorCode: string | null = null;
  let chunkCount = 0;
  let secretSourcesReturned = 0;
  let rawContactLeaks = 0;
  try {
    environment = await createEvalDatabase();
    chunkCount = await prepareInquiries(environment.db, inquiries, embeddings);
    const search = new SemanticSearchService(environment.db, config, embeddings, new SearchIndexRecorder(config));
    for (const item of planned) {
      const baseline = await environment.db.query(`SELECT id FROM ${searchTable(environment.db.manager, 'inquiries')}
        WHERE product_id=$1 AND is_secret=false AND ($2::text IS NULL OR status::text=$2)
        AND ($3::text IS NULL OR "createdAt">=($3::timestamptz AT TIME ZONE 'UTC'))
        AND ($4::text IS NULL OR "createdAt"<($4::timestamptz AT TIME ZONE 'UTC'))
        ORDER BY "createdAt" DESC,id DESC LIMIT 5`,
      [item.productId, item.status ?? null, item.startDate ? kstDayStart(item.startDate) : null, item.endDate ? kstDayEndExclusive(item.endDate) : null]);
      const measured = await search.searchInquiriesWithTrace({ query: item.query, productIds: [item.productId], status: item.status,
        startDate: item.startDate, endDate: item.endDate, take: 5 }, evaluationToolContext(item.caseId));
      const ids = measured.result.data.sources.map(source => source.id);
      secretSourcesReturned += ids.filter(id => inquiries.some(inquiry => inquiry.id === id && inquiry.isSecret)).length;
      rawContactLeaks += Number(/PRIVATE_INQUIRY|fixture(?:-answer)?@example\.com|010-1234-5678/.test(JSON.stringify(measured.result)));
      const preparation = actual?.record(queryInput(item.query));
      cases.push({ ...item, searchStatus: measured.result.status,
        baseline: { ids: baseline.map((row: { id: number }) => row.id), ...score(baseline.map((row: { id: number }) => row.id), item.relevantIds) },
        semantic: { ...measured, ids, ...score(measured.result.status === 'ok' ? ids : [], item.relevantIds) },
        queryEmbeddingPreparation: preparation ? { generatedAt: preparation.generatedAt, elapsedMs: preparation.elapsedMs } : null });
      console.log(JSON.stringify({ searched: item.caseId, status: measured.result.status }));
    }
  } catch (error) { errorCode = error instanceof SearchError ? error.code : 'INQUIRY_SEARCH_EVALUATION_FAILED'; }
  finally { await environment?.close(); }
  const average = (mode: 'baseline' | 'semantic', key: 'hitAt5' | 'recallAt5' | 'precisionAt5') =>
    cases.reduce((sum, item) => sum + (item[mode][key] ?? 0), 0) / planned.filter(item => item.relevantIds.length).length;
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const summary = Object.fromEntries((['baseline', 'semantic'] as const).map(mode => [mode,
    Object.fromEntries((['hitAt5', 'recallAt5', 'precisionAt5'] as const).map(key => [key, average(mode, key)]))]));
  const apiErrors = cases.filter(item => ['unavailable', 'indexing', 'invalid_arguments', 'forbidden', 'unsupported'].includes(item.searchStatus)).length;
  const result = {
    runId, codeVersion: codeVersion(), fixtureVersion: final ? INQUIRY_FINAL_VERSION : INQUIRY_IMPROVEMENT_VERSION,
    split: final ? 'final-small' : 'improvement', embeddingMode: live ? 'live' : 'mock', profile: PROFILE,
    syntheticInquiries: inquiries.length, originalInquiries: 0, publicInquiries: inquiries.filter(item => !item.isSecret).length,
    secretInquiries: inquiries.filter(item => item.isSecret).length, chunkCount, planned: planned.length, executed: cases.length,
    unexecuted: planned.length - cases.length, apiErrors, errorCode, criteria: final ? INQUIRY_FINAL_CRITERIA : null,
    protection: { secretSourcesReturned, rawContactLeaks, protectedInputViolations }, summary,
    policy: 'same fixed query/filters for recent baseline and exact cosine; 10 candidate chunks; 5 deduplicated sources; no threshold or reranker',
    embeddingUsageThisRun: actual?.actual.snapshot() ?? { requests: 0, inputCodePoints: 0, inputBytes: 0, inputTokens: null },
    generated: actual?.generated ?? null, cacheHits: actual?.cacheHits ?? null, mockCalls: live ? null : mockCalls,
    limitations: live
      ? 'Synthetic data, one repetition. Cached actual vectors separate query preparation latency from lookup latency. No final-answer, human-review, HTTP latency, production or full 30-question quality claims. No-evidence questions measure retrieval behavior only; retrieved candidates are not evidence judgments.'
      : 'Deterministic topic vectors validate indexing, SQL filters and citations only. These scores are not semantic-quality measurements. No provider requests or final answers are generated. No-evidence queries can return unrelated candidates because the service has no threshold.',
    cases,
  };
  const directory = join(__dirname, '../results'); mkdirSync(directory, { recursive: true });
  const output = join(directory, `search-inquiry-retrieval-${result.embeddingMode}-${result.split}-${runId}.json`);
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, summary, errorCode, protection: result.protection, usage: result.embeddingUsageThisRun }));
  const thresholdsFailed = live && final && (summary.semantic.hitAt5 < INQUIRY_FINAL_CRITERIA.retrieval.hitAt5 || summary.semantic.recallAt5 < INQUIRY_FINAL_CRITERIA.retrieval.recallAt5);
  if (errorCode || cases.length !== planned.length || apiErrors || secretSourcesReturned || rawContactLeaks || protectedInputViolations || thresholdsFailed) process.exitCode = 1;
}
main().catch(() => { console.error('INQUIRY_SEARCH_EVALUATION_CONFIGURATION_FAILED'); process.exitCode = 1; });
