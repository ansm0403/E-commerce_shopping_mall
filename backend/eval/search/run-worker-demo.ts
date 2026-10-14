import 'reflect-metadata';
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmbeddingClient } from '../../src/intrastructure/ai/embedding-client.interface';
import { SearchIndexRecorder } from '../../src/search/search-index-recorder';
import { ReviewIndexStore } from '../../src/search/review-index.store';
import { InquiryIndexStore } from '../../src/search/inquiry-index.store';
import { ReviewIndexProcessor } from '../../src/search/review-index.processor';
import { InquiryIndexProcessor } from '../../src/search/inquiry-index.processor';
import { ReviewIndexMaintenance } from '../../src/search/review-index.maintenance';
import { InquiryIndexMaintenance } from '../../src/search/inquiry-index.maintenance';
import { ReviewIndexScheduler } from '../../src/search/review-index.scheduler';
import { SemanticSearchService } from '../../src/search/semantic-search.service';
import { INITIAL_SEARCH_PROFILE as PROFILE } from '../../src/search/search-profile';
import { SearchError } from '../../src/search/search-error';
import { searchTable } from '../../src/search/search-sql';
import { evaluationToolContext } from '../../src/search/tool-execution-context';
import { EvalEmbeddingClient, createEvalDatabase } from './search-eval-environment';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--live') || args.length > 1) throw new Error('INVALID_ARGUMENTS');
  if (!args.length) {
    console.log(JSON.stringify({ live: false, apiRequests: 0, userDatabaseAccess: false,
      instruction: 'Add --live for a bounded Nest @Interval worker demo in an isolated synthetic probe schema. No manual work CLI is used.' })); return;
  }
  const environment = await createEvalDatabase();
  const { db } = environment;
  const config = new ConfigService({ AI_SEARCH_WORKER_ENABLED: 'false', AI_SEARCH_REVIEW_INDEX_ENABLED: 'true', AI_SEARCH_INQUIRY_INDEX_ENABLED: 'true',
    AI_SEARCH_REVIEWS_ENABLED: 'true', AI_SEARCH_INQUIRIES_ENABLED: 'true', AI_SEARCH_PROFILE_ID: PROFILE.id });
  const actual = new EvalEmbeddingClient(config);
  let protectedInputViolations = 0;
  const embeddings: EmbeddingClient = { model: actual.model, dimensions: actual.dimensions, isEnabled: () => actual.isEnabled(),
    async embed(inputs, signal, guard) {
      if (inputs.some(input => /PRIVATE_INQUIRY|fixture(?:-answer)?@example\.com|010-1234-5678/.test(input))) { protectedInputViolations++; throw new SearchError('INVALID_INPUT'); }
      return actual.embed(inputs, signal, guard);
    } };
  const recorder = new SearchIndexRecorder(config);
  const reviewStore = new ReviewIndexStore(db, recorder); const inquiryStore = new InquiryIndexStore(db, recorder);
  const reviews = new ReviewIndexProcessor(reviewStore, embeddings); const inquiries = new InquiryIndexProcessor(inquiryStore, embeddings);
  const outcomes: { source: string; status: string; version?: string; elapsedMs: number }[] = [];
  const latencies: { source: string; version: string; storedToReadyMs: number }[] = [];
  for (const [source, processor] of [['review', reviews], ['inquiry', inquiries]] as const) {
    const run = processor.runOne.bind(processor);
    processor.runOne = async signal => {
      const started = performance.now(); const result = await run(signal);
      if (result.status !== 'idle') outcomes.push({ source, status: result.status, version: result.version, elapsedMs: performance.now() - started });
      return result;
    };
  }
  const scheduler = new ReviewIndexScheduler(config, reviews, new ReviewIndexMaintenance(reviewStore), inquiries, new InquiryIndexMaintenance(inquiryStore));
  @Module({ imports: [ScheduleModule.forRoot()], providers: [{ provide: ReviewIndexScheduler, useValue: scheduler }] })
  class DemoWorkerModule {}
  let application: INestApplicationContext | undefined;
  const checks: { caseId: string; passed: boolean }[] = [];
  let errorCode: string | null = null;
  const table = (name: Parameters<typeof searchTable>[1]) => searchTable(db.manager, name);
  const assert = (caseId: string, passed: boolean) => { checks.push({ caseId, passed }); if (!passed) throw new Error('WORKER_DEMO_ASSERTION_FAILED'); };
  const ready = async (source: 'review' | 'inquiry', id: number, version: string, storedAt: number) => {
    const started = performance.now();
    while (performance.now() - started < 180000) {
      const [job] = await db.query(`SELECT status FROM ${table('search_index_jobs')} WHERE ${source}_id=$1 AND source_version=$2 AND profile_id=$3`, [id, version, PROFILE.id]);
      if (job?.status === 'done') { latencies.push({ source, version, storedToReadyMs: performance.now() - storedAt }); return; }
      if (job?.status === 'failed') throw new Error('WORKER_JOB_FAILED');
      await pause(200);
    }
    throw new Error('WORKER_DEMO_TIMEOUT');
  };
  const search = new SemanticSearchService(db, config, embeddings, recorder);
  try {
    application = await NestFactory.createApplicationContext(DemoWorkerModule, { logger: false, abortOnError: false });
    await db.query(`INSERT INTO ${table('products')} (id,category_id) VALUES (901,1)`);
    const firstStoredAt = performance.now();
    await db.transaction(async manager => {
      await manager.query(`INSERT INTO ${table('reviews')} (id,product_id,rating,comment,"createdAt") VALUES (9201,901,2,$1,now())`, ['끝부분의 봉제가 풀렸습니다. 수선하고 싶습니다.']);
      await recorder.recordReview(manager, 9201);
      await manager.query(`INSERT INTO ${table('inquiries')} (id,product_id,title,content,is_secret,status,"createdAt") VALUES (9101,901,$1,$2,false,'waiting',now())`,
        ['시연 문의: 가방 안감이 뜯어졌습니다', '안쪽 천의 봉제가 풀렸습니다. 수선 방법을 알려주세요. fixture@example.com, 010-1234-5678입니다.']);
      await recorder.recordInquiry(manager, 9101);
    });
    await pause(1200);
    assert('disabled-worker-keeps-jobs-pending', outcomes.length === 0);
    const pending = await search.searchInquiries({ productIds: [901], query: '가방 안쪽 봉제가 풀린 문의' }, evaluationToolContext('worker-before'));
    assert('pending-source-not-cited', pending.status === 'indexing' && pending.data.sources.length === 0);
    config.set('AI_SEARCH_WORKER_ENABLED', 'true');
    await ready('review', 9201, '1', firstStoredAt); await ready('inquiry', 9101, '1', firstStoredAt);
    assert('both-queues-run-through-nest-interval', outcomes.some(item => item.source === 'review' && item.status === 'done') && outcomes.some(item => item.source === 'inquiry' && item.status === 'done'));
    const initial = await search.searchInquiries({ productIds: [901], query: '가방 안쪽 봉제가 풀린 문의' }, evaluationToolContext('worker-ready'));
    assert('automatic-inquiry-search-ready', initial.status === 'ok' && initial.data.sources.some(source => source.id === 9101 && source.quotes.some(quote => quote.text.includes('봉제'))));
    config.set('AI_SEARCH_WORKER_ENABLED', 'false');
    const answerStoredAt = performance.now();
    await db.transaction(async manager => {
      await manager.query(`SELECT id FROM ${table('inquiries')} WHERE id=9101 FOR UPDATE`);
      await manager.query(`UPDATE ${table('inquiries')} SET answer=$1,status='answered' WHERE id=9101`, ['뜯어진 안감의 사진을 보내주시면 수선 접수를 도와드립니다. fixture-answer@example.com입니다.']);
      await recorder.advanceInquiry(manager, 9101);
    });
    const updating = await search.searchInquiries({ productIds: [901], status: 'answered', query: '안감 수선 접수 안내' }, evaluationToolContext('worker-updating'));
    assert('old-version-not-returned-after-answer', updating.status === 'indexing' && updating.data.sources.length === 0);
    config.set('AI_SEARCH_WORKER_ENABLED', 'true');
    await ready('inquiry', 9101, '2', answerStoredAt);
    const answered = await search.searchInquiries({ productIds: [901], status: 'answered', query: '안감 수선 접수 안내' }, evaluationToolContext('worker-answered'));
    assert('automatic-answer-version-search-ready', answered.status === 'ok' && answered.data.sources.some(source => source.id === 9101 && source.quotes.some(quote => quote.text.includes('수선 접수'))));
    const requestsBeforeSecret = actual.actual.snapshot().requests;
    await db.transaction(async manager => {
      await manager.query(`INSERT INTO ${table('inquiries')} (id,product_id,title,content,is_secret,status,"createdAt") VALUES (9102,901,'PRIVATE_INQUIRY 비공개','PRIVATE_INQUIRY 비공개 본문',true,'waiting',now())`);
      await recorder.recordInquiry(manager, 9102);
    });
    await pause(1200);
    const [{ count: secretJobs }] = await db.query(`SELECT count(*)::int AS count FROM ${table('search_index_jobs')} WHERE inquiry_id=9102`);
    assert('private-source-has-no-job-or-request', secretJobs === 0 && actual.actual.snapshot().requests === requestsBeforeSecret);
    const deletionStoredAt = performance.now();
    await db.transaction(async manager => {
      await manager.query(`INSERT INTO ${table('inquiries')} (id,product_id,title,content,is_secret,status,"createdAt") VALUES (9103,901,'삭제 시연','바느질 실이 끊어진 미답변 문의입니다.',false,'waiting',now())`);
      await recorder.recordInquiry(manager, 9103);
    });
    await ready('inquiry', 9103, '1', deletionStoredAt);
    await db.query(`DELETE FROM ${table('inquiries')} WHERE id=9103 AND status='waiting'`);
    const [{ chunks }] = await db.query(`SELECT count(*)::int AS chunks FROM ${table('inquiry_search_chunks')} WHERE inquiry_id=9103`);
    const [{ jobs }] = await db.query(`SELECT count(*)::int AS jobs FROM ${table('search_index_jobs')} WHERE inquiry_id=9103`);
    assert('waiting-source-delete-immediately-clears-evidence', chunks === 0 && jobs === 0);
    assert('protected-inputs-never-sent', protectedInputViolations === 0);
  } catch (error) { errorCode = error instanceof SearchError ? error.code : error instanceof Error && /^WORKER_[A-Z_]+$/.test(error.message) ? error.message : 'WORKER_DEMO_FAILED'; }
  finally { await application?.close(); await environment.close(); }
  const runId = new Date().toISOString().replace(/[:.]/g, '-'); const directory = join(__dirname, '../results'); mkdirSync(directory, { recursive: true });
  const output = join(directory, `search-worker-demo-${runId}.json`);
  const result = { runId, live: true, passed: !errorCode && checks.length === 9 && checks.every(item => item.passed), errorCode,
    scheduling: 'Real Nest ScheduleModule @Interval(1000), production scheduler/store/processors; no manual work CLI',
    userDatabaseAccess: false, userEnvChanged: false, syntheticSources: { review: 1, inquiry: 3 }, llmRequests: 0,
    embeddingUsage: actual.actual.snapshot(), generated: actual.generated, cacheHits: actual.cacheHits, checks, outcomes, latencies,
    limitation: 'Isolated SQL source writes and actual embeddings, not buyer/seller/admin browser verification. These few queue timings are not production P50/P95 or service latency.' };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ output, passed: result.passed, errorCode, checks }));
  if (!result.passed) process.exitCode = 1;
}
main().catch(() => { console.error('WORKER_DEMO_CONFIGURATION_FAILED'); process.exitCode = 1; });
