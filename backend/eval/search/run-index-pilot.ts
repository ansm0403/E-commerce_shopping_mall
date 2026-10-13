import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { SearchFoundation1791936000000 } from '../../src/database/migrations/1791936000000-SearchFoundation';
import { SearchIndexRecorder } from '../../src/search/search-index-recorder';
import { ReviewIndexStore } from '../../src/search/review-index.store';
import { ReviewIndexMaintenance } from '../../src/search/review-index.maintenance';
import { ReviewIndexProcessor } from '../../src/search/review-index.processor';
import { GeminiEmbeddingClient } from '../../src/intrastructure/ai/providers/gemini-embedding.client';
import { INITIAL_SEARCH_PROFILE } from '../../src/search/search-profile';
import { SearchError } from '../../src/search/search-error';
import { searchTable } from '../../src/search/search-sql';

/** Real SDK + durable queue pilot with synthetic sources only, on the dedicated probe DB. */
async function main() {
  const schema = `index_pilot_${randomUUID().replace(/-/g, '')}`;
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const db = new DataSource({ type: 'postgres', host: '127.0.0.1', port: Number(process.env.SEARCH_TEST_POSTGRES_PORT || 15433),
    username: 'search_probe', password: 'search_probe', database: 'shopping_mall_search_probe', schema, installExtensions: false });
  const config = new ConfigService<Record<string | symbol, unknown>>({ AI_SEARCH_REVIEW_INDEX_ENABLED: 'true' });
  const embedding = new GeminiEmbeddingClient(config);
  const cases: { caseId: string; passed: boolean; elapsedMs?: number; status?: string }[] = [];
  let errorCode: string | null = null;
  let schemaCreated = false;
  await db.initialize();
  try {
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(`CREATE SCHEMA "${schema}"`); schemaCreated = true;
      await runner.query(`SET search_path TO "${schema}", public`);
      await runner.query('CREATE TABLE reviews (id int PRIMARY KEY,comment text NOT NULL)');
      await runner.query('CREATE TABLE inquiries (id int PRIMARY KEY)');
      await new SearchFoundation1791936000000().up(runner);
    } finally { await runner.release(); }
    const recorder = new SearchIndexRecorder(config);
    const store = new ReviewIndexStore(db, recorder);
    const processor = new ReviewIndexProcessor(store, embedding);
    const table = (name: Parameters<typeof searchTable>[1]) => searchTable(db.manager, name);
    const writeStarted = performance.now();
    await db.transaction(async manager => {
      await manager.query(`INSERT INTO ${table('reviews')} VALUES (1,$1,1),(2,$2,1)`, [
        '팔이 조여서 움직이기 불편해요. 테스트 연락처 sample@example.com.', '작을까 걱정했는데 잘 맞아요.',
      ]);
      await recorder.recordReview(manager, 1); await recorder.recordReview(manager, 2);
    });
    for (let index = 0; index < 2; index++) {
      const result = await processor.runOne();
      cases.push({ caseId: `initial-source-${index + 1}`, passed: result.status === 'done', status: result.status, elapsedMs: performance.now() - writeStarted });
      if (result.status !== 'done') throw new SearchError('INDEX_STORAGE_FAILED');
    }
    const changedStarted = performance.now();
    await db.transaction(async manager => {
      await manager.query(`SELECT id FROM ${table('reviews')} WHERE id=1 FOR UPDATE`);
      await manager.query(`UPDATE ${table('reviews')} SET comment=$1 WHERE id=1`, ['이제는 움직이기 편하고 넉넉하게 맞아요.']);
      await recorder.advanceReview(manager, 1);
    });
    const stale = await db.query(`SELECT c.id FROM ${table('review_search_chunks')} c JOIN ${table('reviews')} r ON r.id=c.review_id WHERE r.id=1 AND c.source_version=r.search_version`);
    cases.push({ caseId: 'exclude-previous-version', passed: stale.length === 0 });
    const changed = await processor.runOne();
    cases.push({ caseId: 'edited-source', passed: changed.status === 'done', status: changed.status, elapsedMs: performance.now() - changedStarted });
    await db.query(`DELETE FROM ${table('reviews')} WHERE id=2`);
    const remnants = await db.query(`SELECT id FROM ${table('review_search_chunks')} WHERE review_id=2 UNION ALL SELECT id FROM ${table('search_index_jobs')} WHERE review_id=2`);
    cases.push({ caseId: 'deleted-source', passed: remnants.length === 0 });
    const maintenance = new ReviewIndexMaintenance(store);
    const reconciled = await maintenance.reconcile();
    cases.push({ caseId: 'reconciliation', passed: reconciled.queued === 0 && reconciled.repaired === 0 && reconciled.failed === 0 });
  } catch (error) {
    errorCode = error instanceof SearchError ? error.code : 'INDEX_PILOT_FAILED';
  } finally {
    if (schemaCreated) await db.query(`DROP SCHEMA "${schema}" CASCADE`);
    await db.destroy();
  }
  const passed = errorCode === null && cases.length === 6 && cases.every(item => item.passed);
  const result = { runId, phase: 'review-index', profile: INITIAL_SEARCH_PROFILE, syntheticSources: 2,
    originalSources: 0, planned: 6, executed: cases.length, passed, errorCode, cases, usage: embedding.snapshot(),
    timingBoundary: 'synthetic DB write start to completed index; includes configured RPM waiting; no HTTP or semantic search',
    limitations: 'SDK/storage smoke pilot; retrieval quality, HTTP save latency and concurrency load are not measured here' };
  const directory = join(__dirname, '../results'); mkdirSync(directory, { recursive: true });
  const path = join(directory, `search-index-pilot-${runId}.json`);
  writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ path, passed, errorCode, cases, usage: result.usage }));
  if (!passed) process.exitCode = 1;
}
main().catch(() => { console.error('INDEX_PILOT_CONFIGURATION_FAILED'); process.exitCode = 1; });
