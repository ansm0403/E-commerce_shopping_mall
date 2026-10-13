import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { SearchFoundation1791936000000 } from '../database/migrations/1791936000000-SearchFoundation';
import { SearchIndexRecorder } from './search-index-recorder';
import { ReviewIndexStore } from './review-index.store';
import { SemanticSearchService } from './semantic-search.service';
import { reviewDocument } from './search-document';
import { searchTable } from './search-sql';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';
import { adminToolContext, evaluationToolContext } from './tool-execution-context';
import { SearchError } from './search-error';
import type { ReviewSearchInput } from './search-input';

const axis = (first = 1, second = 0) => [first, second, ...Array(766).fill(0)];
const context = evaluationToolContext('semantic-test');

describe('semantic reviews (real PostgreSQL)', () => {
  const schema = `semantic_probe_${randomUUID().replace(/-/g, '')}`;
  let db: DataSource;
  let config: ConfigService;
  let recorder: SearchIndexRecorder;
  let store: ReviewIndexStore;
  let search: SemanticSearchService;
  let embed: jest.Mock;
  const table = (name: Parameters<typeof searchTable>[1]) => searchTable(db.manager, name);
  const run = (args: Partial<ReviewSearchInput> = {}) => search.searchReviews({ query: '팔 부분이 좁다는 불만', ...args }, context);
  async function source(id: number, options: { comment?: string; productId?: number; rating?: number; createdAt?: string; indexed?: boolean; vectors?: number[][] } = {}) {
    const comment = options.comment ?? `원문 ${id}`;
    await db.transaction(async manager => {
      await manager.query(`INSERT INTO ${table('reviews')} (id,product_id,rating,comment,"createdAt") VALUES ($1,$2,$3,$4,$5::timestamptz AT TIME ZONE 'UTC')`,
        [id, options.productId ?? 1, options.rating ?? 5, comment, options.createdAt ?? '2026-10-13T12:00:00+09:00']);
      await recorder.recordReview(manager, id, true);
    });
    if (options.indexed !== false) {
      const job = await store.claim(); if (!job || job.review_id !== id) throw new Error('claim order');
      const doc = reviewDocument(comment);
      await store.complete(job, doc, doc.chunks.length ? doc.chunks.map((_, i) => options.vectors?.[i] ?? axis()) : undefined);
    }
  }

  beforeAll(async () => {
    db = new DataSource({ type: 'postgres', host: '127.0.0.1', port: Number(process.env.SEARCH_TEST_POSTGRES_PORT || 15433),
      username: 'search_probe', password: 'search_probe', database: 'shopping_mall_search_probe', schema, installExtensions: false });
    await db.initialize();
    const runner = db.createQueryRunner(); await runner.connect();
    try {
      await runner.query('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public');
      await runner.query(`CREATE SCHEMA "${schema}"`); await runner.query(`SET search_path TO "${schema}",public`);
      await runner.query('CREATE TABLE products (id int PRIMARY KEY,category_id int NOT NULL)');
      await runner.query('CREATE TABLE reviews (id int PRIMARY KEY,product_id int NOT NULL,rating int NOT NULL,comment text NOT NULL,"createdAt" timestamp NOT NULL)');
      await runner.query('CREATE TABLE inquiries (id int PRIMARY KEY)');
      await new SearchFoundation1791936000000().up(runner);
    } finally { await runner.release(); }
  });
  afterAll(async () => { if (db?.isInitialized) { await db.query(`DROP SCHEMA "${schema}" CASCADE`); await db.destroy(); } });
  beforeEach(async () => {
    await db.query(`TRUNCATE ${table('reviews')},${table('products')},${table('search_index_jobs')},${table('review_search_chunks')} RESTART IDENTITY CASCADE`);
    await db.query(`INSERT INTO ${table('products')} VALUES (1,1),(2,2),(3,1)`);
    config = new ConfigService({ AI_SEARCH_REVIEWS_ENABLED: 'true', AI_SEARCH_REVIEW_INDEX_ENABLED: 'true' });
    recorder = new SearchIndexRecorder(config); store = new ReviewIndexStore(db, recorder);
    embed = jest.fn(async () => ({ vectors: [axis()], usage: { requests: 1, inputBytes: 1, inputCodePoints: 1, inputTokens: null } }));
    search = new SemanticSearchService(db, config, { model: PROFILE.model, dimensions: 768, isEnabled: () => true, embed }, recorder);
  });

  it('ranks exact cosine distances, deduplicates sources and returns safe citations without vectors or distances', async () => {
    await source(1, { comment: '팔이 좁아요. test@example.com, 010-1234-5678', vectors: [axis(0, 1)] });
    await source(2, { comment: 'a'.repeat(1900), vectors: [axis(), axis()] });
    await source(3, { vectors: [axis(1, 1)] });
    const result = await run();
    expect(result.status).toBe('ok');
    expect(result.data.sources.map(row => row.id)).toEqual([2, 3, 1]);
    expect(result.data.sources[0].quotes).toHaveLength(2);
    expect(result.coverage).toEqual({ total: 3, ready: 3, pending: 0, failed: 0, partial: false });
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/test@example.com|010-1234-5678|"embedding":|"distance":|user_id/);
    expect(json).toContain('t***@***');
    expect(result.scope.query).toBe('팔 부분이 좁다는 불만');
    expect(result.scope.checkedAt).toBeDefined();
  });

  it('limits to 10 candidate chunks, stable ties, default 5 sources and at most 2 quotes per source', async () => {
    for (let id = 1; id <= 12; id++) await source(id, id === 1 ? { comment: 'a'.repeat(2800) } : {});
    const result = await run();
    expect(result.data.candidateChunkCount).toBe(10);
    expect(result.data.sources.map(row => row.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.data.sources[0].quotes).toHaveLength(2);
    expect(result.data.omittedSourceCount).toBe(3);
    expect(result.data.sources.flatMap(row => row.quotes).reduce((n, quote) => n + Array.from(quote.text).length, 0)).toBeLessThanOrEqual(12000);
  });

  it('uses current product/category/rating filters and never widens an empty product range', async () => {
    await source(1, { rating: 1 }); await source(2, { productId: 2, rating: 1 }); await source(3, { productId: 3, rating: 5 });
    expect((await run({ categoryIds: [1], maxRating: 2 })).data.sources.map(row => row.id)).toEqual([1]);
    expect((await run({ productIds: [2] })).data.sources.map(row => row.id)).toEqual([2]);
    embed.mockClear(); expect((await run({ productIds: [] })).status).toBe('no_data'); expect(embed).not.toHaveBeenCalled();
    await db.query(`UPDATE ${table('products')} SET category_id=2 WHERE id=1`);
    expect((await run({ productIds: [1,3], categoryIds: [1] })).data.sources.map(row => row.id)).toEqual([3]);
  });

  it('includes the entire KST end date including microseconds and excludes the next midnight', async () => {
    await source(1, { createdAt: '2026-10-12T23:59:59.999999+09:00' });
    await source(2, { createdAt: '2026-10-13T00:00:00+09:00' });
    await source(3, { createdAt: '2026-10-13T23:59:59.999999+09:00' });
    await source(4, { createdAt: '2026-10-14T00:00:00+09:00' });
    expect((await run({ startDate: '2026-10-13', endDate: '2026-10-13' })).data.sources.map(row => row.id)).toEqual([2, 3]);
    expect((await run({ endDate: '2026-10-12' })).data.sources.map(row => row.id)).toEqual([1]);
  });

  it('distinguishes no source, empty completed source, pending/missing/failed jobs and partial readiness', async () => {
    expect((await run()).status).toBe('no_data');
    await source(1, { comment: ' ' }); expect((await run()).status).toBe('no_candidates');
    await source(2, { indexed: false }); expect((await run()).status).toBe('indexing');
    await db.query(`DELETE FROM ${table('search_index_jobs')} WHERE review_id=2`); expect((await run()).status).toBe('indexing');
    await db.transaction(manager => recorder.recordReview(manager, 2, true));
    await db.query(`UPDATE ${table('search_index_jobs')} SET status='failed',completed_at=now(),error_code='EMBEDDING_TIMEOUT' WHERE review_id=2`);
    expect((await run()).status).toBe('unavailable');
    await source(3);
    const result = await run(); expect(result.status).toBe('ok');
    expect(result.coverage).toEqual({ total: 3, ready: 2, pending: 0, failed: 1, partial: true });
    expect(result.data.sources.map(row => row.id)).toEqual([3]);
  });

  it('does not expose stale vectors after a body edit or index a new version implicitly', async () => {
    await source(1);
    await db.transaction(async manager => { await manager.query(`UPDATE ${table('reviews')} SET search_version=search_version+1,comment='changed' WHERE id=1`); await recorder.recordReview(manager, 1, true); });
    const result = await run(); expect(result.status).toBe('indexing'); expect(result.data.sources).toEqual([]); expect(embed).not.toHaveBeenCalled();
  });

  it.each(['delete', 'body', 'rating', 'category', 'product', 'failed'])('rechecks %s changes during the external embedding request', async mutation => {
    await source(1, { rating: 1 });
    embed.mockImplementationOnce(async () => {
      if (mutation === 'delete') await db.query(`DELETE FROM ${table('reviews')} WHERE id=1`);
      if (mutation === 'body') await db.transaction(async manager => {
        await manager.query(`UPDATE ${table('reviews')} SET comment='new body',search_version=search_version+1 WHERE id=1`);
        await recorder.recordReview(manager, 1, true);
      });
      if (mutation === 'rating') await db.query(`UPDATE ${table('reviews')} SET rating=5 WHERE id=1`);
      if (mutation === 'category') await db.query(`UPDATE ${table('products')} SET category_id=2 WHERE id=1`);
      if (mutation === 'product') await db.query(`UPDATE ${table('reviews')} SET product_id=2 WHERE id=1`);
      if (mutation === 'failed') await db.query(`UPDATE ${table('search_index_jobs')} SET status='failed',completed_at=now(),error_code='INDEX_STORAGE_FAILED' WHERE review_id=1`);
      return { vectors: [axis()], usage: { requests: 1, inputBytes: 1, inputCodePoints: 1, inputTokens: null } };
    });
    const result = await run({ productIds: [1], categoryIds: [1], maxRating: 2 });
    expect(result.status).toBe(mutation === 'body' ? 'indexing' : mutation === 'failed' ? 'unavailable' : 'no_data');
    expect(result.data.sources).toEqual([]);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty', []], ['multiple', [axis(), axis()]], ['dimension', [[1]]],
    ['zero', [Array(768).fill(0)]], ['NaN', [axis(Number.NaN)]], ['infinite', [axis(Number.POSITIVE_INFINITY)]],
  ])('fails safely for a %s query embedding response', async (_name, vectors) => {
    await source(1);
    embed.mockResolvedValueOnce({ vectors, usage: { requests: 1, inputBytes: 1, inputCodePoints: 1, inputTokens: null } });
    const result = await run();
    expect(result).toMatchObject({ status: 'unavailable', error: { code: 'INVALID_EMBEDDING' } });
    expect(result.data.sources).toEqual([]);
  });

  it('preserves an empty category range, including when product IDs are supplied', async () => {
    await source(1);
    const result = await run({ categoryName: 'empty', categoryIds: [], productIds: [1] });
    expect(result).toMatchObject({ status: 'no_data', scope: { categoryIds: [], productIds: [1] }, coverage: { total: 0 } });
    expect(embed).not.toHaveBeenCalled();
  });

  it.each(['delete', 'body', 'rating', 'category', 'raw-body'])('rechecks %s changes after ranking before returning any citation', async mutation => {
    await source(1);
    const original = db.createQueryRunner.bind(db);
    let edited = false;
    const spy = jest.spyOn(db, 'createQueryRunner').mockImplementation(mode => {
      const runner = original(mode); const query = runner.manager.query.bind(runner.manager);
      runner.manager.query = async (sql, values) => {
        const rows = await query(sql, values);
        if (!edited && sql.includes('ORDER BY distance')) {
          edited = true;
          if (mutation === 'delete') await db.query(`DELETE FROM ${table('reviews')} WHERE id=1`);
          if (mutation === 'body') await db.query(`UPDATE ${table('reviews')} SET comment='changed',search_version=search_version+1 WHERE id=1`);
          if (mutation === 'raw-body') await db.query(`UPDATE ${table('reviews')} SET comment='changed' WHERE id=1`);
          if (mutation === 'rating') await db.query(`UPDATE ${table('reviews')} SET rating=5 WHERE id=1`);
          if (mutation === 'category') await db.query(`UPDATE ${table('products')} SET category_id=2 WHERE id=1`);
        }
        return rows;
      };
      return runner;
    });
    if (mutation === 'rating') await db.query(`UPDATE ${table('reviews')} SET rating=1 WHERE id=1`);
    try {
      const result = await run({ categoryIds: [1], maxRating: mutation === 'rating' ? 2 : undefined });
      expect(edited).toBe(true); expect(result.data.sources).toEqual([]);
      expect(result.status).not.toBe('ok');
    } finally { spy.mockRestore(); }
  });

  it('rejects zero/missing/corrupt chunks as unavailable and never leaks corrupted contact text', async () => {
    await source(1); await db.query(`UPDATE ${table('review_search_chunks')} SET embedding=$1::vector`, [JSON.stringify(Array(768).fill(0))]);
    expect((await run()).status).toBe('unavailable'); expect(embed).not.toHaveBeenCalled();
  });

  it('reports mismatched quote text as failed coverage instead of an empty successful search', async () => {
    await source(1);
    await db.query(`UPDATE ${table('review_search_chunks')} SET text='secret@example.com 010-1234-5678' WHERE review_id=1`);
    const result = await run();
    expect(result.status).toBe('unavailable');
    expect(result.coverage).toEqual({ total: 1, ready: 0, pending: 0, failed: 1, partial: true });
    expect(result.data.sources).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/secret@example.com|010-1234-5678/);
  });

  it('excludes a corrupted source while reporting the remaining valid source as a partial result', async () => {
    await source(1); await source(2);
    await db.query(`UPDATE ${table('reviews')} SET comment='unrecorded edit' WHERE id=1`);
    const result = await run();
    expect(result.status).toBe('ok');
    expect(result.data.sources.map(row => row.id)).toEqual([2]);
    expect(result.coverage).toEqual({ total: 2, ready: 1, pending: 0, failed: 1, partial: true });
  });

  it('does not claim there are no chunks if a newly completed version invalidates the ranked candidates', async () => {
    await source(1);
    const original = db.createQueryRunner.bind(db);
    let changed = false;
    const spy = jest.spyOn(db, 'createQueryRunner').mockImplementation(mode => {
      const runner = original(mode); const query = runner.manager.query.bind(runner.manager);
      runner.manager.query = async (sql, values) => {
        const rows = await query(sql, values);
        if (!changed && sql.includes('ORDER BY distance')) {
          changed = true;
          await db.transaction(async manager => {
            await manager.query(`UPDATE ${table('reviews')} SET comment='new body',search_version=search_version+1 WHERE id=1`);
            await recorder.recordReview(manager, 1, true);
          });
          const job = await store.claim(); if (!job) throw new Error('missing next version');
          await store.complete(job, reviewDocument('new body'), [axis()]);
        }
        return rows;
      };
      return runner;
    });
    try {
      const result = await run();
      expect(changed).toBe(true);
      expect(result).toMatchObject({ status: 'unavailable', error: { code: 'SOURCE_CHANGED' }, coverage: { ready: 1, partial: true } });
      expect(result.data.sources).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  it('checks profile/client mismatch and masks query text before the embedding call', async () => {
    await source(1);
    const result = await run({ query: 'contact@example.com 010-1234-5678' });
    expect(result.status).toBe('ok'); expect(embed.mock.calls[0][0]).toEqual(['task: search result | query: c***@*** ***']);
    expect(JSON.stringify(result.scope)).not.toContain('contact@example.com');
    await db.query(`UPDATE ${table('search_embedding_profiles')} SET model='other' WHERE id=$1`, [PROFILE.id]);
    try { expect((await run()).error?.code).toBe('PROFILE_MISMATCH'); }
    finally { await db.query(`UPDATE ${table('search_embedding_profiles')} SET model=$2 WHERE id=$1`, [PROFILE.id, PROFILE.model]); }
  });

  it('returns safe unavailable on provider errors instead of declaring no data', async () => {
    await source(1); embed.mockRejectedValueOnce({ message: 'secret@example.com API-key raw-body' });
    const result = await run(); expect(result.status).toBe('unavailable'); expect(JSON.stringify(result)).not.toMatch(/secret@example.com|API-key|raw-body/);
    embed.mockRejectedValueOnce(new SearchError('EMBEDDING_TIMEOUT', true)); expect((await run()).error?.code).toBe('EMBEDDING_TIMEOUT');
  });

  it('rejects invalid actors, disabled capability and invalid arguments before any query or external request', async () => {
    const query = jest.spyOn(db, 'createQueryRunner');
    try {
      expect((await search.searchReviews({ query: 'q' }, adminToolContext(1, ['buyer']))).status).toBe('forbidden');
      config.set('AI_SEARCH_REVIEWS_ENABLED', 'false'); expect((await run()).status).toBe('unsupported');
      config.set('AI_SEARCH_REVIEWS_ENABLED', 'true');
      expect((await run({ query: ' ', take: 11 })).status).toBe('invalid_arguments');
      expect((await run({ startDate: '2026-02-30' })).status).toBe('invalid_arguments');
      expect((await run({ categoryName: 'unresolved category' })).status).toBe('invalid_arguments');
      const expandedMask = await run({ query: 'a@b.co '.repeat(142) });
      expect(expandedMask.status).toBe('invalid_arguments');
      expect(JSON.stringify(expandedMask)).not.toContain('a@b.co');
      expect(query).not.toHaveBeenCalled(); expect(embed).not.toHaveBeenCalled();
    } finally { query.mockRestore(); }
  });

  it('propagates abort during a live PostgreSQL query, releases its client, and leaves subsequent searches usable', async () => {
    await source(1); const abort = new AbortController();
    const original = db.createQueryRunner.bind(db);
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    const spy = jest.spyOn(db, 'createQueryRunner').mockImplementation(mode => {
      const runner = original(mode); const query = runner.manager.query.bind(runner.manager);
      runner.manager.query = async (sql, values) => {
        if (sql.includes('ORDER BY distance')) { entered(); await runner.query('SELECT pg_sleep(10)'); }
        return query(sql, values);
      };
      return runner;
    });
    const work = search.searchReviews({ query: 'q' }, evaluationToolContext('abort', abort.signal));
    try {
      await started; const time = Date.now(); abort.abort();
      const result = await work; expect(result.error?.code).toBe('ABORTED'); expect(Date.now() - time).toBeLessThan(1500);
    } finally { spy.mockRestore(); }
    expect((await run()).status).toBe('ok');
  });

  it('cancels while waiting for a saturated pool and releases the late connection without querying', async () => {
    const limited = new DataSource({ ...db.options, extra: { max: 1, connectionTimeoutMillis: 5000 } });
    await limited.initialize();
    const holder = limited.createQueryRunner(); await holder.connect();
    const abort = new AbortController();
    const waitingSearch = new SemanticSearchService(limited, config, search.embedding, recorder);
    const original = limited.createQueryRunner.bind(limited);
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let runner!: ReturnType<DataSource['createQueryRunner']>;
    let query!: jest.SpyInstance;
    const spy = jest.spyOn(limited, 'createQueryRunner').mockImplementation(mode => {
      runner = original(mode);
      query = jest.spyOn(runner, 'query');
      const connect = runner.connect.bind(runner);
      runner.connect = () => { const pending = connect(); entered(); return pending; };
      return runner;
    });
    const work = waitingSearch.searchReviews({ query: 'q' }, evaluationToolContext('pool-abort', abort.signal));
    let result: Awaited<typeof work> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await started; abort.abort();
      result = await Promise.race([work, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1500); })]);
    } finally {
      clearTimeout(timer); spy.mockRestore(); await holder.release(); await work;
      // A canceled pg pool waiter cannot be removed; its eventual client must return safely to the pool.
      await limited.query('SELECT 1');
      await limited.destroy();
    }
    expect(result).toMatchObject({ status: 'unavailable', error: { code: 'ABORTED' } });
    expect(runner.isReleased).toBe(true);
    expect(query).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it.each(['readonly', 'timeout'])('enforces %s on the search transaction and leaves the pool usable after failure', async mode => {
    await source(1);
    const original = db.createQueryRunner.bind(db);
    let reached = false;
    const spy = jest.spyOn(db, 'createQueryRunner').mockImplementation(replication => {
      const runner = original(replication); const query = runner.manager.query.bind(runner.manager);
      runner.manager.query = async (sql, values) => {
        if (sql.includes('ORDER BY distance')) {
          reached = true;
          await runner.query(mode === 'readonly'
            ? `UPDATE ${table('reviews')} SET comment='forbidden write' WHERE id=1`
            : 'SELECT pg_sleep(10)');
        }
        return query(sql, values);
      };
      return runner;
    });
    const started = Date.now();
    try {
      const result = await run();
      expect(reached).toBe(true);
      expect(result).toMatchObject({ status: 'unavailable', error: { code: 'INDEX_STORAGE_FAILED' } });
      if (mode === 'timeout') expect(Date.now() - started).toBeLessThan(5000);
    } finally { spy.mockRestore(); }
    const [row] = await db.query(`SELECT comment FROM ${table('reviews')} WHERE id=1`);
    expect(row.comment).toBe('원문 1');
    expect((await run()).status).toBe('ok');
  });
  it('reports an absent embedding key separately from a profile mismatch, without any provider request', async () => {
    await source(1);
    const enabled = jest.spyOn(search.embedding, 'isEnabled').mockReturnValue(false);
    try {
      const result = await run();
      expect(result).toMatchObject({ status: 'unavailable', error: { code: 'EMBEDDING_DISABLED' } });
      expect(embed).not.toHaveBeenCalled();
    } finally { enabled.mockRestore(); }
  });
});
