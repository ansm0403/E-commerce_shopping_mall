import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { SemanticSearchService, SearchDiagnostics } from '../../src/search/semantic-search.service';
import type { ReviewSearchResult } from '../../src/search/search-contract';
import { SearchIndexRecorder } from '../../src/search/search-index-recorder';
import { INITIAL_SEARCH_PROFILE } from '../../src/search/search-profile';
import { evaluationToolContext } from '../../src/search/tool-execution-context';
import { queryInput } from '../../src/search/search-document';
import { searchTable } from '../../src/search/search-sql';
import { SearchError } from '../../src/search/search-error';
import { codeVersion } from './eval-observations';
import { improvementCases, improvementReviews, SEARCH_FIXTURE_VERSION } from './fixture';
import { finalCases, finalReviews, FINAL_CRITERIA, FINAL_FIXTURE_VERSION } from './final-fixture';
import { finalV2Cases, finalV2Reviews, FINAL_V2_CRITERIA, FINAL_V2_VERSION } from './final-fixture-v2';
import { EvalCase, EvalEmbeddingClient, createEvalDatabase, prepareReviews, score } from './search-eval-environment';

interface MeasuredCase extends EvalCase {
  status: ReviewSearchResult['status'];
  baseline: ReturnType<typeof score> & { ids: number[] };
  semantic: ReturnType<typeof score> & { ids: number[]; result: ReviewSearchResult; diagnostics: SearchDiagnostics };
  queryEmbeddingPreparation: { generatedAt: string; elapsedMs: number } | null;
}

async function main() {
  const version = codeVersion();
  const args = process.argv.slice(2);
  if (args.some(arg => !['--split=improvement', '--split=final', '--split=final-v2'].includes(arg)) || args.length > 1) throw new Error('INVALID_ARGUMENTS');
  const v2 = args.includes('--split=final-v2');
  const final = v2 || args.includes('--split=final');
  const planned = v2 ? finalV2Cases : final ? finalCases : improvementCases;
  const reviews = v2 ? finalV2Reviews : final ? finalReviews : improvementReviews;
  const environment = await createEvalDatabase();
  const config = new ConfigService({ AI_SEARCH_REVIEWS_ENABLED: 'true' });
  const embeddings = new EvalEmbeddingClient(config);
  const cases: MeasuredCase[] = [];
  let errorCode: string | null = null;
  let chunkCount = 0;
  try {
    chunkCount = await prepareReviews(environment.db, reviews, embeddings);
    const search = new SemanticSearchService(environment.db, config, embeddings, new SearchIndexRecorder(config));
    for (const item of planned) {
      const range = 'startDate' in item ? { startDate: item.startDate, endDate: item.endDate } : {};
      const baseline = await environment.db.query(`SELECT id FROM ${searchTable(environment.db.manager, 'reviews')} WHERE product_id=$1 AND ($2::int IS NULL OR rating<=$2)
        AND ($3::text IS NULL OR "createdAt">=($3::timestamptz AT TIME ZONE 'UTC')) AND ($4::text IS NULL OR "createdAt"<($4::timestamptz AT TIME ZONE 'UTC')) ORDER BY "createdAt" DESC,id DESC LIMIT 5`,
        [item.productId, item.maxRating, range.startDate ? `${range.startDate}T00:00:00+09:00` : null, range.endDate ? new Date(Date.parse(`${range.endDate}T00:00:00+09:00`) + 86400000).toISOString() : null]);
      const { result, diagnostics } = await search.searchReviewsWithTrace({ query: item.query, productIds: [item.productId], maxRating: item.maxRating ?? undefined, ...range, take: 5 }, evaluationToolContext(item.caseId));
      const ids = result.data.sources.map(source => source.id);
      const measured = score(result.status === 'ok' ? ids : [], item.relevantIds);
      const preparation = embeddings.record(queryInput(item.query));
      cases.push({ ...item, status: result.status, baseline: { ids: baseline.map((row: { id: number }) => row.id), ...score(baseline.map((row: { id: number }) => row.id), item.relevantIds) },
        semantic: { ids, ...measured, result, diagnostics }, queryEmbeddingPreparation: preparation ? {
          generatedAt: preparation.generatedAt, elapsedMs: preparation.elapsedMs,
        } : null });
      console.log(JSON.stringify({ searched: item.caseId, status: result.status, hitAt5: measured.hitAt5 }));
    }
  } catch (error) { errorCode = error instanceof SearchError ? error.code : 'SEARCH_EVALUATION_FAILED'; }
  finally { await environment.close(); }
  const average = (mode: 'baseline' | 'semantic', key: 'hitAt5' | 'recallAt5' | 'precisionAt5') => cases.reduce((sum, item) => sum + (item[mode][key] ?? 0), 0) / planned.filter(item => item.relevantIds.length).length;
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const result = { runId, codeVersion: version, fixtureVersion: v2 ? FINAL_V2_VERSION : final ? FINAL_FIXTURE_VERSION : SEARCH_FIXTURE_VERSION, split: v2 ? 'final-v2' : final ? 'final' : 'improvement', profile: INITIAL_SEARCH_PROFILE,
    syntheticReviews: reviews.length, originalReviews: 0, chunkCount, planned: planned.length, executed: cases.length, errorCode, criteria: v2 ? FINAL_V2_CRITERIA : final ? FINAL_CRITERIA : null,
    policy: 'exact cosine; 10 candidate chunks; 5 deduplicated sources; no threshold or reranker',
    summary: Object.fromEntries(['baseline', 'semantic'].map(mode => [mode, Object.fromEntries(['hitAt5', 'recallAt5', 'precisionAt5'].map(key => [key, average(mode as 'baseline' | 'semantic', key as 'hitAt5' | 'recallAt5' | 'precisionAt5')]))])),
    embeddingUsageThisRun: embeddings.actual.snapshot(), generated: embeddings.generated, cacheHits: embeddings.cacheHits,
    limitations: 'Synthetic data, one repetition. Identical fixture inputs share a cached real vector for evaluation. Preparation latency includes RPM waiting. Cached query lookup latency is separate from original API preparation latency. No final answer quality or HTTP latency claims.', cases };
  const directory = join(__dirname, '../results'); mkdirSync(directory, { recursive: true });
  const output = join(directory, `search-retrieval-${result.split}-${runId}.json`); writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, summary: result.summary, errorCode, usage: result.embeddingUsageThisRun }));
  if (errorCode || cases.length !== planned.length || cases.some(item => item.status !== 'ok') || (final && (result.summary.semantic.hitAt5 < FINAL_CRITERIA.retrieval.hitAt5 || result.summary.semantic.recallAt5 < FINAL_CRITERIA.retrieval.recallAt5))) process.exitCode = 1;
}
main().catch(() => { console.error('SEARCH_EVALUATION_CONFIGURATION_FAILED'); process.exitCode = 1; });
