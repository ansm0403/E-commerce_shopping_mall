import { randomUUID } from 'node:crypto';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { SearchFoundation1791936000000 } from '../database/migrations/1791936000000-SearchFoundation';
import { ROLE_DEMO_ENTITIES } from '../seed/role-demo.entities';
import { ReviewEntity } from '../review/entity/review.entity';
import { OrderEntity } from '../order/entity/order.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import { ReviewService } from '../review/review.service';
import { CommonService } from '../common/common.service';
import { DemoPolicyService } from '../demo/demo-policy.service';
import { mockDemoPolicy } from '../demo/demo-policy.mock';
import type { EmbeddingClient } from '../intrastructure/ai/embedding-client.interface';
import { SearchIndexRecorder } from './search-index-recorder';
import { ReviewIndexStore } from './review-index.store';
import { ReviewIndexProcessor } from './review-index.processor';
import { ReviewIndexMaintenance } from './review-index.maintenance';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';
import { reviewDocument } from './search-document';
import { SearchError } from './search-error';
import { searchTable } from './search-sql';
import { SearchIndexModule } from './search-index.module';
import { ReviewIndexScheduler } from './review-index.scheduler';

@Module({})
class ProbeDatabaseModule {}

function barrier() {
  let resolve = () => undefined;
  const promise = new Promise<void>(finish => { resolve = finish; });
  return { promise, resolve };
}
const vector = [1, ...Array(767).fill(0)];

describe('review index (real PostgreSQL transactions and leases)', () => {
  const schema = `index_probe_${randomUUID().replace(/-/g, '')}`;
  let db: DataSource;
  let recorder: SearchIndexRecorder;
  let store: ReviewIndexStore;
  let maintenance: ReviewIndexMaintenance;
  let processor: ReviewIndexProcessor;
  let service: ReviewService;
  let repo: Repository<ReviewEntity>;
  let events: jest.SpyInstance;
  let embed: jest.Mock;

  const table = (name: Parameters<typeof searchTable>[1]) => searchTable(db.manager, name);
  const another = () => db.transaction(async manager => {
    const source = await manager.getRepository(ReviewEntity).save({ userId: 8, productId: 10, orderId: 2, rating: 5, comment: 'another source' });
    await recorder.recordReview(manager, source.id);
    return source;
  });
  const rows = (name: Parameters<typeof searchTable>[1]) => db.query(`SELECT * FROM ${table(name)} ORDER BY id`);
  const create = (comment = '팔 부분이 꽉 끼어요.') => service.create(7, { orderId: 1, productId: 9, rating: 5, comment });

  beforeAll(async () => {
    db = new DataSource({ type: 'postgres', host: '127.0.0.1', port: Number(process.env.SEARCH_TEST_POSTGRES_PORT || 15433),
      username: 'search_probe', password: 'search_probe', database: 'shopping_mall_search_probe',
      schema, installExtensions: false, entities: ROLE_DEMO_ENTITIES });
    await db.initialize();
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public');
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET search_path TO "${schema}", public`);
      await runner.query(`CREATE TABLE reviews (id serial PRIMARY KEY, "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),user_id int NOT NULL,product_id int NOT NULL,order_id int NOT NULL,
        rating smallint NOT NULL,comment text NOT NULL,"imageUrls" text[] NOT NULL DEFAULT '{}',UNIQUE(user_id,product_id,order_id))`);
      await runner.query('CREATE TABLE inquiries (id int PRIMARY KEY)');
      await new SearchFoundation1791936000000().up(runner);
    } finally { await runner.release(); }
  });

  afterAll(async () => {
    if (db?.isInitialized) { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.destroy(); }
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE ${table('search_index_jobs')},${table('review_search_chunks')},"${schema}".inquiry_search_chunks,${table('reviews')},"${schema}".inquiries RESTART IDENTITY`);
    recorder = new SearchIndexRecorder(new ConfigService<Record<string | symbol, unknown>>({ AI_SEARCH_REVIEW_INDEX_ENABLED: 'true' }));
    store = new ReviewIndexStore(db, recorder);
    maintenance = new ReviewIndexMaintenance(store);
    embed = jest.fn(async (_inputs: string[], _signal?: AbortSignal, guard?: () => Promise<void>) => {
      await guard?.();
      return { vectors: [vector], usage: { requests: 1, inputTokens: null, inputBytes: 0, inputCodePoints: 0 } };
    });
    const embedding: EmbeddingClient = { model: PROFILE.model, dimensions: 768, isEnabled: () => true, embed };
    processor = new ReviewIndexProcessor(store, embedding);
    repo = db.getRepository(ReviewEntity);
    const emitter = new EventEmitter2();
    events = jest.spyOn(emitter, 'emit');
    service = new ReviewService(repo,
      { findOne: async () => ({ id: 1, status: 'completed' }) } as unknown as Repository<OrderEntity>,
      { findOne: async () => ({ orderId: 1, productId: 9 }) } as unknown as Repository<OrderItemEntity>,
      emitter, {} as CommonService, mockDemoPolicy() as unknown as DemoPolicyService, recorder);
    // Only the post-commit display relation is stubbed; all source writes, locks, versions and jobs use PostgreSQL.
    Object.defineProperty(service, 'findOneWithUser', { value: (id: number) => repo.findOneBy({ id }) });
  });

  it.each([
    { AI_SEARCH_REVIEW_INDEX_ENABLED: 'false', AI_SEARCH_WORKER_ENABLED: 'false' },
    { AI_SEARCH_REVIEW_INDEX_ENABLED: 'false', AI_SEARCH_WORKER_ENABLED: 'true', AI_SEARCH_EMBEDDING_RPM: '0', AI_SEARCH_EMBEDDING_TIMEOUT_MS: '0' },
    { AI_SEARCH_REVIEW_INDEX_ENABLED: 'true', AI_SEARCH_WORKER_ENABLED: 'false', AI_SEARCH_EMBEDDING_RPM: '0', AI_SEARCH_EMBEDDING_TIMEOUT_MS: '0' },
  ])('boots the real Nest module with an inactive worker and never queries the database %#', async settings => {
    const application = await Test.createTestingModule({ imports: [
      { module: ProbeDatabaseModule, global: true, providers: [{ provide: DataSource, useValue: db }], exports: [DataSource] },
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => settings] }),
      ScheduleModule.forRoot(), SearchIndexModule,
    ] }).compile();
    const query = jest.spyOn(db.manager, 'query');
    try {
      await application.init();
      const scheduler = application.get(ReviewIndexScheduler);
      await scheduler.tick(); await scheduler.reconcile(); await scheduler.cleanup();
      expect(query).not.toHaveBeenCalled();
    } finally { await application.close(); query.mockRestore(); }
  });

  it('claims unrelated work without waiting for a locked exhausted lease', async () => {
    await create(); const second = await another();
    await db.query(`UPDATE ${table('search_index_jobs')} SET attempts=5,status='running',lease_token=$1,lease_expires_at=clock_timestamp()-interval '1 second' WHERE review_id=1`, [randomUUID()]);
    const runner = db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
    let claim: ReturnType<ReviewIndexStore['claim']> | undefined;
    let timer!: ReturnType<typeof setTimeout>;
    try {
      await runner.query(`SELECT id FROM ${table('search_index_jobs')} WHERE review_id=1 FOR UPDATE`);
      claim = store.claim();
      const result = await Promise.race([claim, new Promise<'blocked'>(resolve => { timer = setTimeout(() => resolve('blocked'), 500); })]);
      expect(result).toMatchObject({ review_id: second.id });
    } finally { clearTimeout(timer); await runner.rollbackTransaction(); await runner.release(); await claim; }
    expect(await store.claim()).toBeNull();
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ status: 'failed', error_code: 'ATTEMPTS_EXHAUSTED' });
  });

  it('gives simultaneous workers distinct jobs', async () => {
    await create(); await another();
    const claimed = await Promise.all([store.claim(), store.claim(), store.claim()]);
    expect(claimed.filter(Boolean)).toHaveLength(2);
    expect(new Set(claimed.filter(Boolean).map(job => job?.id)).size).toBe(2);
    expect((await rows('search_index_jobs')).map(job => job.attempts)).toEqual([1, 1]);
  });

  it('commits only one review and one job when concurrent creates both pass the duplicate precheck', async () => {
    const precheck = jest.spyOn(repo, 'findOne').mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    try {
      const outcomes = await Promise.allSettled([create('first'), create('second')]);
      expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason.getStatus()).toBe(400);
      const sources = await rows('reviews');
      expect(sources).toHaveLength(1);
      expect(await rows('search_index_jobs')).toEqual([expect.objectContaining({ review_id: sources[0].id, source_version: '1' })]);
      expect(events).toHaveBeenCalledTimes(1);
    } finally { precheck.mockRestore(); }
  });

  it('carries versions above Number.MAX_SAFE_INTEGER through backfill, embedding, edits and reuse', async () => {
    await create();
    await db.query(`DELETE FROM ${table('search_index_jobs')}`);
    await db.query(`UPDATE ${table('reviews')} SET search_version='9007199254740993'`);
    expect(await maintenance.backfill()).toEqual({ scanned: 1, queued: 1 });
    expect((await processor.runOne()).status).toBe('done');
    await service.update(7, 1, { rating: 2 });
    expect((await processor.runOne()).status).toBe('reused');
    expect((await rows('reviews'))[0].search_version).toBe('9007199254740994');
    expect((await rows('review_search_chunks'))[0].source_version).toBe('9007199254740994');
    expect((await rows('search_index_jobs')).map(job => job.source_version)).toEqual(['9007199254740993', '9007199254740994']);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('rolls back a source edit and emits no events on PostgreSQL bigint exhaustion', async () => {
    await create('original'); events.mockClear();
    await db.query(`UPDATE ${table('reviews')} SET search_version='9223372036854775807'`);
    await expect(service.update(7, 1, { comment: 'overflow', rating: 1 })).rejects.toMatchObject({ driverError: { code: '22003' } });
    expect((await rows('reviews'))[0]).toMatchObject({ comment: 'original', rating: 5, search_version: '9223372036854775807' });
    expect(await rows('search_index_jobs')).toHaveLength(1);
    expect(events).not.toHaveBeenCalled();
  });

  it('keeps review versions and jobs unchanged on rejected ownership and age checks', async () => {
    await create('original'); events.mockClear();
    await expect(service.update(8, 1, { comment: 'unauthorized' })).rejects.toMatchObject({ status: 403 });
    await expect(service.delete(8, 1, false)).rejects.toMatchObject({ status: 403 });
    await db.query(`UPDATE ${table('reviews')} SET "createdAt"=now()-interval '31 days'`);
    await expect(service.update(7, 1, { comment: 'too late' })).rejects.toMatchObject({ status: 400 });
    expect((await rows('reviews'))[0]).toMatchObject({ comment: 'original', search_version: '1' });
    expect(await rows('search_index_jobs')).toHaveLength(1);
    expect(events).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 1001, NaN])('rejects an invalid maintenance batch size %s before querying', async size => {
    const query = jest.spyOn(db.manager, 'query');
    try {
      await expect(maintenance.backfill(size)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(maintenance.reconcile(size)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(query).not.toHaveBeenCalled();
    } finally { query.mockRestore(); }
  });

  it.each([
    Object.assign(Array(768), { 0: 1 }), Array(768).fill(1e-50), [1e100, ...Array(767).fill(0)],
  ].map(invalid => ({ invalid })))('rolls back invalid float32 vector replacement and retains old evidence %#', async ({ invalid }) => {
    await create(); await processor.runOne();
    await service.update(7, 1, { comment: 'changed source' });
    const job = await store.claim(); if (!job) throw new Error('claim');
    await expect(store.complete(job, reviewDocument('changed source'), [invalid])).rejects.toMatchObject({ code: 'INVALID_EMBEDDING', retryable: false });
    expect((await rows('review_search_chunks'))[0].source_version).toBe('1');
    expect((await rows('search_index_jobs'))[1].status).toBe('running');
  });

  it.each(['review_id', 'profile_id', 'source_version'] as const)('rejects a claim with a mismatched %s at every ownership boundary', async field => {
    await create(); const second = await another();
    const job = await store.claim(); if (!job) throw new Error('claim');
    const mixed = { ...job, [field]: field === 'review_id' ? second.id : field === 'profile_id' ? 'other-profile' : '2' };
    await expect(store.source(mixed)).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(await store.heartbeat(mixed)).toBe(false);
    expect(await store.complete(mixed, reviewDocument('mixed source'), [vector])).toBe(false);
    await store.fail(mixed, new SearchError('EMBEDDING_UNAVAILABLE', true));
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ status: 'running', lease_token: job.lease_token });
    expect(await rows('review_search_chunks')).toEqual([]);
  });

  it('re-embeds a zero vector instead of reusing matching chunk metadata', async () => {
    await create(); await processor.runOne(); embed.mockClear();
    await db.query(`UPDATE ${table('review_search_chunks')} SET embedding=$1::vector`, [JSON.stringify(Array(768).fill(0))]);
    await service.update(7, 1, { rating: 2 });
    expect((await processor.runOne()).status).toBe('done');
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('reconciles a zero vector and queues exactly one repair', async () => {
    await create(); await processor.runOne();
    await db.query(`UPDATE ${table('review_search_chunks')} SET embedding=$1::vector`, [JSON.stringify(Array(768).fill(0))]);
    expect(await maintenance.reconcile()).toMatchObject({ repaired: 1, queued: 1 });
    expect(await maintenance.reconcile()).toMatchObject({ repaired: 0, queued: 0 });
    expect((await processor.runOne()).status).toBe('done');
  });

  it.each([{ vectors: [] }, { vectors: [vector, vector] }, { vectors: [undefined] }, {}])
    ('rejects invalid adapter responses before the next request and preserves previous chunks %#', async response => {
    await create(); await processor.runOne();
    await service.update(7, 1, { comment: 'a'.repeat(1900) });
    embed.mockClear(); embed.mockResolvedValueOnce(response);
    expect(await processor.runOne()).toMatchObject({ status: 'failed', errorCode: 'INVALID_EMBEDDING' });
    expect((await rows('search_index_jobs'))[1]).toMatchObject({ status: 'failed' });
    expect((await rows('review_search_chunks'))[0].source_version).toBe('1');
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('stops before requesting the next chunk after an edit during a multi-chunk embedding', async () => {
    await create('a'.repeat(1900));
    embed.mockImplementationOnce(async () => {
      await service.update(7, 1, { comment: 'new source' });
      return { vectors: [vector] };
    });
    expect((await processor.runOne()).status).toBe('discarded');
    expect(embed).toHaveBeenCalledTimes(1);
    expect(await rows('review_search_chunks')).toEqual([]);
    expect((await rows('search_index_jobs'))[0].status).toBe('superseded');
  });

  it('atomically creates version 1 and a job, masks evidence and completes the chunk set', async () => {
    const source = await create('팔이 꽉 끼어요. 고객 test@example.com, 010-1234-5678');
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ source_version: '1', status: 'pending' });
    expect(events).toHaveBeenCalledTimes(1);
    expect((await processor.runOne()).status).toBe('done');
    const chunks = await rows('review_search_chunks');
    expect(chunks[0].text).toContain('t***@***');
    expect(chunks[0].text).not.toContain('010-1234-5678');
    expect(embed.mock.calls[0][0][0]).not.toContain('test@example.com');
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ status: 'done', chunk_count: 1, source_version: '1' });
    expect(source?.id).toBe(chunks[0].review_id);
  });

  it('records body-only edits, preserves existing rating-event counts and suppresses old versions immediately', async () => {
    await create(); await processor.runOne(); events.mockClear();
    await service.update(7, 1, { comment: '이제는 넉넉하게 맞아요.' });
    expect(events).not.toHaveBeenCalled();
    expect((await rows('reviews'))[0].search_version).toBe('2');
    expect(await db.query(`SELECT c.id FROM ${table('review_search_chunks')} c JOIN ${table('reviews')} r ON r.id=c.review_id WHERE c.source_version=r.search_version`)).toEqual([]);
    await processor.runOne();
    expect((await rows('review_search_chunks'))[0]).toMatchObject({ source_version: '2', text: '이제는 넉넉하게 맞아요.' });
  });

  it('reuses the stored vectors for rating-only edits and still emits the original two rating events', async () => {
    await create(); await processor.runOne(); embed.mockClear(); events.mockClear();
    await service.update(7, 1, { rating: 2 });
    expect((await processor.runOne()).status).toBe('reused');
    expect(embed).not.toHaveBeenCalled();
    expect(events).toHaveBeenCalledTimes(2);
    expect((await rows('review_search_chunks'))[0].source_version).toBe('2');
  });

  it('does not reuse an old matching hash when the actual stored chunk set now belongs to other content', async () => {
    await create('본문 A'); await processor.runOne();
    await service.update(7, 1, { comment: '본문 B' }); await processor.runOne();
    await service.update(7, 1, { comment: '본문 A' });
    expect((await processor.runOne()).status).toBe('done');
    expect(embed).toHaveBeenCalledTimes(3);
    expect((await rows('review_search_chunks'))[0]).toMatchObject({ text: '본문 A', source_version: '3' });
  });

  it('finishes empty documents at zero chunks and removes previous evidence without an API call', async () => {
    await create(); await processor.runOne(); embed.mockClear();
    await service.update(7, 1, { comment: '  \n ' }); await processor.runOne();
    expect(embed).not.toHaveBeenCalled();
    expect(await rows('review_search_chunks')).toEqual([]);
    expect((await rows('search_index_jobs')).find(job => job.source_version === '2')).toMatchObject({ status: 'done', chunk_count: 0 });
  });

  it('allows a body update while an external request waits and discards the late old result', async () => {
    await create(); const started = barrier(); const release = barrier();
    embed.mockImplementationOnce(async () => { started.resolve(); await release.promise; return { vectors: [vector] }; });
    const work = processor.runOne(); await started.promise;
    expect((await processor.runOne()).status).toBe('idle');
    await service.update(7, 1, { comment: '새 본문' }); // Completes before releasing provider: no source lock held over API.
    release.resolve(); expect((await work).status).toBe('discarded');
    expect((await rows('search_index_jobs'))[0].status).toBe('superseded');
    expect(await rows('review_search_chunks')).toEqual([]);
    await processor.runOne(); expect((await rows('review_search_chunks'))[0].text).toBe('새 본문');
  });

  it('cascades deletion while embedding is in progress and never recreates a deleted source', async () => {
    await create(); const started = barrier(); const release = barrier();
    embed.mockImplementationOnce(async () => { started.resolve(); await release.promise; return { vectors: [vector] }; });
    const work = processor.runOne(); await started.promise;
    await service.delete(7, 1, false); release.resolve(); await work;
    expect(await rows('reviews')).toEqual([]); expect(await rows('search_index_jobs')).toEqual([]); expect(await rows('review_search_chunks')).toEqual([]);
  });

  it('protects a reclaimed job from both commit and failure by the previous token', async () => {
    await create(); const previous = await store.claim(); if (!previous) throw new Error('claim');
    await db.query(`UPDATE ${table('search_index_jobs')} SET lease_expires_at=clock_timestamp()-interval '1 second'`);
    const current = await store.claim(); if (!current) throw new Error('reclaim');
    expect(current.lease_token).not.toBe(previous.lease_token); expect(current.attempts).toBe(2);
    expect(await store.complete(previous, reviewDocument('팔 부분이 꽉 끼어요.'), [vector])).toBe(false);
    await store.fail(previous, new SearchError('EMBEDDING_UNAVAILABLE', true));
    expect((await rows('search_index_jobs'))[0].lease_token).toBe(current.lease_token);
    expect(await store.complete(current, reviewDocument('팔 부분이 꽉 끼어요.'), [vector])).toBe(true);
    expect((await rows('review_search_chunks'))).toHaveLength(1);
  });

  it('renews only the current valid lease and leaves reclaimed ownership untouched', async () => {
    await create(); const job = await store.claim(); if (!job) throw new Error('claim');
    await db.query(`UPDATE ${table('search_index_jobs')} SET lease_expires_at=clock_timestamp()+interval '2 seconds'`);
    expect(await store.heartbeat(job)).toBe(true);
    expect((await rows('search_index_jobs'))[0].lease_expires_at.getTime() - Date.now()).toBeGreaterThan(110000);
    await db.query(`UPDATE ${table('search_index_jobs')} SET lease_expires_at=clock_timestamp()-interval '1 second'`);
    await store.claim();
    expect(await store.heartbeat(job)).toBe(false);
  });

  it('rejects an otherwise current result when its lease expires during chunk insertion', async () => {
    await create(); const job = await store.claim(); if (!job) throw new Error('claim');
    await db.query(`CREATE FUNCTION "${schema}".slow_chunk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END $$`);
    await db.query(`CREATE TRIGGER slow_chunk BEFORE INSERT ON ${table('review_search_chunks')} FOR EACH ROW EXECUTE FUNCTION "${schema}".slow_chunk()`);
    try {
      await db.query(`UPDATE ${table('search_index_jobs')} SET lease_expires_at=clock_timestamp()+interval '0.1 second'`);
      await expect(store.complete(job, reviewDocument('팔 부분이 꽉 끼어요.'), [vector])).rejects.toMatchObject({ code: 'LEASE_LOST' });
      expect(await rows('review_search_chunks')).toEqual([]);
      expect((await rows('search_index_jobs'))[0].status).toBe('running');
    } finally { await db.query(`DROP TRIGGER slow_chunk ON ${table('review_search_chunks')}`); }
  });

  it('aborts and does not commit when heartbeat renewal fails', async () => {
    await create();
    jest.spyOn(store, 'heartbeat').mockResolvedValue(false);
    embed.mockImplementationOnce(async (_inputs: string[], signal: AbortSignal) => {
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      return { vectors: [vector] };
    });
    const quick = new ReviewIndexProcessor(store, { model: PROFILE.model, dimensions: 768, isEnabled: () => true, embed }, 10);
    expect((await quick.runOne()).status).toBe('discarded');
    expect(await rows('review_search_chunks')).toEqual([]);
    expect((await rows('search_index_jobs'))[0].status).toBe('running');
  });

  it('serializes concurrent source edits without losing content or search-version increments', async () => {
    await create();
    await Promise.all([service.update(7, 1, { comment: '동시에 바꾼 본문' }), service.update(7, 1, { rating: 2 })]);
    expect((await rows('reviews'))[0]).toMatchObject({ comment: '동시에 바꾼 본문', rating: 2, search_version: '3' });
    expect((await rows('search_index_jobs')).map(job => job.source_version)).toEqual(['1', '2', '3']);
  });

  it('does not duplicate or replace a running job during repeated cursor backfill', async () => {
    await create(); const claimed = await store.claim();
    expect(await maintenance.backfill(1)).toEqual({ scanned: 1, queued: 0 });
    expect(await maintenance.backfill(1)).toEqual({ scanned: 1, queued: 0 });
    expect((await rows('search_index_jobs'))[0].lease_token).toBe(claimed?.lease_token);
  });

  it('rolls back source creation and emits no event when job recording fails', async () => {
    jest.spyOn(recorder, 'assertProfile').mockRejectedValueOnce(new SearchError('PROFILE_MISMATCH'));
    await expect(create()).rejects.toMatchObject({ code: 'PROFILE_MISMATCH' });
    expect(await rows('reviews')).toEqual([]); expect(await rows('search_index_jobs')).toEqual([]); expect(events).not.toHaveBeenCalled();
  });

  it('rolls back edited content and version together when the new job cannot be recorded', async () => {
    await create(); events.mockClear();
    jest.spyOn(recorder, 'assertProfile').mockRejectedValueOnce(new SearchError('PROFILE_MISMATCH'));
    await expect(service.update(7, 1, { comment: '실패한 수정' })).rejects.toMatchObject({ code: 'PROFILE_MISMATCH' });
    expect((await rows('reviews'))[0]).toMatchObject({ comment: '팔 부분이 꽉 끼어요.', search_version: '1' });
    expect(await rows('search_index_jobs')).toHaveLength(1); expect(events).not.toHaveBeenCalled();
  });

  it('retries transient failures and respects Retry-After, then exposes terminal exhaustion for explicit retry', async () => {
    await create(); embed.mockRejectedValueOnce(new SearchError('EMBEDDING_RATE_LIMIT', true, 60000));
    await processor.runOne();
    const [pending] = await rows('search_index_jobs');
    expect(pending.status).toBe('pending'); expect(pending.next_run_at.getTime() - Date.now()).toBeGreaterThan(55000);
    for (let attempt = 1; attempt < 5; attempt++) {
      await db.query(`UPDATE ${table('search_index_jobs')} SET next_run_at=clock_timestamp()-interval '1 second',lease_expires_at=clock_timestamp()-interval '1 second'`);
      expect(await store.claim()).not.toBeNull();
    }
    await db.query(`UPDATE ${table('search_index_jobs')} SET lease_expires_at=clock_timestamp()-interval '1 second'`);
    expect(await store.claim()).toBeNull();
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ status: 'failed', attempts: 5 });
    expect(await maintenance.retryFailed(1)).toBe(1);
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('halts model/permission failures after a single request and never copies the provider error body', async () => {
    await create(); embed.mockRejectedValueOnce(new SearchError('EMBEDDING_PERMISSION'));
    expect((await processor.runOne()).errorCode).toBe('EMBEDDING_PERMISSION');
    expect((await processor.runOne()).status).toBe('idle'); expect(embed).toHaveBeenCalledTimes(1);
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ status: 'failed', error_code: 'EMBEDDING_PERMISSION' });
  });

  it('detects direct SQL changes, restores missing jobs and leaves active jobs untouched', async () => {
    await create(); await processor.runOne();
    await db.query(`UPDATE ${table('reviews')} SET comment='SQL로 바뀐 원문' WHERE id=1`);
    expect(await maintenance.reconcile()).toMatchObject({ repaired: 1, queued: 1 });
    expect(await maintenance.reconcile()).toMatchObject({ repaired: 0, queued: 0 });
    await processor.runOne();
    await db.query(`DELETE FROM ${table('search_index_jobs')} WHERE source_version=2`);
    expect(await maintenance.reconcile()).toMatchObject({ queued: 1 });
  });

  it('preserves current completion during retention cleanup and rejects oversized source without embedding', async () => {
    await create(); await processor.runOne();
    await service.update(7, 1, { comment: '가'.repeat(40000) });
    expect((await processor.runOne()).errorCode).toBe('SOURCE_TOO_LARGE');
    expect(embed).toHaveBeenCalledTimes(1);
    await db.query(`UPDATE ${table('search_index_jobs')} SET completed_at=clock_timestamp()-interval '15 days'`);
    expect(await maintenance.cleanup()).toBe(1);
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ source_version: '2', status: 'failed' });
  });

  it('preserves an aged current done record required by coverage and vector reuse', async () => {
    await create(); await processor.runOne();
    await service.update(7, 1, { rating: 2 }); await processor.runOne();
    await db.query(`UPDATE ${table('search_index_jobs')} SET completed_at=clock_timestamp()-interval '15 days'`);
    expect(await maintenance.cleanup()).toBe(1);
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ source_version: '2', status: 'done' });
  });

  it('repairs corrupted derived text and queues oversized direct-SQL edits instead of aborting reconciliation', async () => {
    await create(); await processor.runOne();
    await db.query(`UPDATE ${table('review_search_chunks')} SET text='잘못된 파생 원문'`);
    expect(await maintenance.reconcile()).toMatchObject({ repaired: 1, queued: 1 });
    await processor.runOne();
    await db.query(`UPDATE ${table('reviews')} SET comment=$1`, ['가'.repeat(40000)]);
    expect(await maintenance.reconcile()).toMatchObject({ repaired: 1, queued: 1 });
    expect((await processor.runOne()).errorCode).toBe('SOURCE_TOO_LARGE');
  });

  it('rolls back a partially inserted replacement chunk set on a real PostgreSQL storage error', async () => {
    await create(); await processor.runOne();
    await service.update(7, 1, { comment: '긴 문서 '.repeat(400) });
    await db.query(`CREATE FUNCTION "${schema}".reject_second_chunk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.chunk_index=1 THEN RAISE EXCEPTION 'TEST_INSERT_FAILURE'; END IF; RETURN NEW; END $$`);
    await db.query(`CREATE TRIGGER reject_second_chunk BEFORE INSERT ON ${table('review_search_chunks')} FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_second_chunk()`);
    try {
      expect((await processor.runOne()).status).toBe('failed');
      expect((await rows('review_search_chunks'))).toHaveLength(1);
      expect((await rows('review_search_chunks'))[0]).toMatchObject({ source_version: '1', text: '팔 부분이 꽉 끼어요.' });
      expect((await rows('search_index_jobs')).find(job => job.source_version === '2').status).toBe('pending');
    } finally { await db.query(`DROP TRIGGER reject_second_chunk ON ${table('review_search_chunks')}`); }
  });
});
