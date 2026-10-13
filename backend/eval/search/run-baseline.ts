import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { improvementCases, improvementReviews, SEARCH_FIXTURE_VERSION } from './fixture';

/** Exactly the existing filter + recent-order path, with IDs retained for scoring. No embeddings or LLM. */
async function main() {
  const db = new DataSource({
    type: 'postgres', host: '127.0.0.1', port: Number(process.env.SEARCH_TEST_POSTGRES_PORT || 15433),
    username: 'search_probe', password: 'search_probe', database: 'shopping_mall_search_probe',
  });
  await db.initialize();
  const runner = db.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    await runner.query(`CREATE TEMP TABLE search_baseline_reviews (
      id int PRIMARY KEY, product_id int NOT NULL, rating int NOT NULL, comment text NOT NULL, created_at timestamptz NOT NULL
    ) ON COMMIT DROP`);
    for (const review of improvementReviews) {
      await runner.query('INSERT INTO search_baseline_reviews VALUES ($1,$2,$3,$4,$5)', [
        review.id, review.productId, review.rating, review.comment, review.createdAt,
      ]);
    }
    const cases = [];
    for (const item of improvementCases) {
      const started = performance.now();
      const rows: { id: number }[] = await runner.query(`SELECT id FROM search_baseline_reviews
        WHERE product_id=$1 AND ($2::int IS NULL OR rating <= $2)
        ORDER BY created_at DESC, id DESC LIMIT 5`, [item.productId, item.maxRating]);
      const sourceIds = rows.map(row => row.id);
      const hits = sourceIds.filter(id => item.relevantIds.includes(id)).length;
      cases.push({ ...item, sourceIds, hitAt5: hits ? 1 : 0, recallAt5: hits / item.relevantIds.length, precisionAt5: hits / 5, dbMs: performance.now() - started });
    }
    let codeVersion: string | null = null;
    try { codeVersion = execFileSync('git', ['-c', `safe.directory=${resolve(__dirname, '../../..').replace(/\\/g, '/')}`, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* unavailable */ }
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const result = { runId, mode: 'structured-baseline', fixtureVersion: SEARCH_FIXTURE_VERSION,
      fixtureType: 'synthetic', originalReviews: 0, syntheticReviews: improvementReviews.length,
      questionCount: cases.length, codeVersion, workingTree: 'implementation-in-progress',
      baselinePolicy: 'same product/rating filters, recent 5 sources; semantic query ignored',
      cases, summary: { hitAt5: cases.reduce((sum, item) => sum + item.hitAt5, 0) / cases.length,
        recallAt5: cases.reduce((sum, item) => sum + item.recallAt5, 0) / cases.length,
        precisionAt5: cases.reduce((sum, item) => sum + item.precisionAt5, 0) / cases.length },
      embeddingRequests: 0, llmRequests: 0 };
    const directory = join(__dirname, '..', 'results');
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `search-baseline-${runId}.json`);
    writeFileSync(path, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ path, questionCount: cases.length, reviewCount: improvementReviews.length, summary: result.summary }));
    await runner.rollbackTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    await db.destroy();
  }
}
main().catch(() => { console.error('BASELINE_FAILED (DB connection or fixture query)'); process.exitCode = 1; });
