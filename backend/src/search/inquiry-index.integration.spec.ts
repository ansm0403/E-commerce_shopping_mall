import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { SearchFoundation1791936000000 } from '../database/migrations/1791936000000-SearchFoundation';
import type { EmbeddingClient } from '../intrastructure/ai/embedding-client.interface';
import { SearchIndexRecorder } from './search-index-recorder';
import { InquiryIndexStore } from './inquiry-index.store';
import { InquiryIndexProcessor } from './inquiry-index.processor';
import { InquiryIndexMaintenance } from './inquiry-index.maintenance';
import { ReviewIndexStore } from './review-index.store';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';
import { inquiryDocument } from './search-document';
import { SearchError } from './search-error';
import { searchTable } from './search-sql';
import { ROLE_DEMO_ENTITIES } from '../seed/role-demo.entities';
import { InquiryEntity, InquiryStatus } from '../inquiry/entity/inquiry.entity';
import { InquiryService } from '../inquiry/inquiry.service';
import { ProductEntity } from '../product/entity/product.entity';
import { SellerEntity } from '../seller/entity/seller.entity';
import { CommonService } from '../common/common.service';
import { DemoPolicyService } from '../demo/demo-policy.service';

function barrier() {
  let resolve = () => undefined;
  const promise = new Promise<void>(finish => { resolve = finish; });
  return { promise, resolve };
}
const vector = [1, ...Array(767).fill(0)];

describe('public inquiry index (isolated PostgreSQL transactions and leases)', () => {
  const schema = `inquiry_index_probe_${randomUUID().replace(/-/g, '')}`;
  let db: DataSource;
  let recorder: SearchIndexRecorder;
  let store: InquiryIndexStore;
  let maintenance: InquiryIndexMaintenance;
  let processor: InquiryIndexProcessor;
  let embed: jest.Mock;
  const actualService = (jobs = recorder) => {
    const repository = db.getRepository(InquiryEntity);
    const service = new InquiryService(repository,
      { findOne: async () => ({ id: 9, sellerId: 55 }) } as unknown as Repository<ProductEntity>,
      { findOne: async () => ({ id: 55 }) } as unknown as Repository<SellerEntity>,
      {} as CommonService, { createDemoInquiry: async () => null, assertInquiryActor: async () => undefined,
        forbidDemo: async () => undefined } as unknown as DemoPolicyService, jobs);
    Object.defineProperty(service, 'findOneWithUser', { value: (id: number) => repository.findOneBy({ id }) });
    return service;
  };
  const table = (name: Parameters<typeof searchTable>[1]) => searchTable(db.manager, name);
  const rows = (name: Parameters<typeof searchTable>[1]) => db.query(`SELECT * FROM ${table(name)} ORDER BY id`);
  const create = (fields: { title?: string; content?: string; answer?: string | null; isSecret?: boolean } = {}) => db.transaction(async manager => {
    const [source] = await manager.query(`INSERT INTO ${searchTable(manager, 'inquiries')} (title,content,answer,is_secret)
      VALUES ($1,$2,$3,$4) RETURNING *`, [fields.title ?? '도착 일정', fields.content ?? '출발 예정일을 알려주세요.', fields.answer ?? null, fields.isSecret ?? false]);
    await recorder.recordInquiry(manager, source.id);
    return source;
  });
  const edit = (id: number, field: 'title' | 'content' | 'answer' | 'status' | 'is_secret', value: unknown) => db.transaction(async manager => {
    await manager.query(`SELECT id FROM ${searchTable(manager, 'inquiries')} WHERE id=$1 FOR UPDATE`, [id]);
    await manager.query(`UPDATE ${searchTable(manager, 'inquiries')} SET ${manager.connection.driver.escape(field)}=$2 WHERE id=$1`, [id, value]);
    await recorder.advanceInquiry(manager, id);
  });
  const document = async (id = 1) => {
    const [source] = await db.query(`SELECT title,content,answer,is_secret AS "isSecret" FROM ${table('inquiries')} WHERE id=$1`, [id]);
    const result = inquiryDocument(source);
    if (!result) throw new Error('secret fixture');
    return result;
  };
  const claim = async () => {
    const result = await store.claim();
    if (!result) throw new Error('missing claim');
    return result;
  };

  beforeAll(async () => {
    db = new DataSource({ type: 'postgres', host: '127.0.0.1', port: Number(process.env.SEARCH_TEST_POSTGRES_PORT || 15433),
      username: 'search_probe', password: 'search_probe', database: 'shopping_mall_search_probe', schema, installExtensions: false, entities: ROLE_DEMO_ENTITIES });
    await db.initialize();
    const runner = db.createQueryRunner(); await runner.connect();
    try {
      await runner.query('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public');
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET search_path TO "${schema}", public`);
      await runner.query('CREATE TABLE reviews (id serial PRIMARY KEY, comment text NOT NULL DEFAULT \'review\')');
      await runner.query(`CREATE TABLE inquiries (id serial PRIMARY KEY,title varchar(200) NOT NULL,content text NOT NULL,
        answer text,is_secret boolean NOT NULL DEFAULT false,status varchar NOT NULL DEFAULT 'waiting',
        user_id int NOT NULL DEFAULT 7,product_id int NOT NULL DEFAULT 9,seller_id int NOT NULL DEFAULT 55,answered_at timestamptz,
        "createdAt" timestamp NOT NULL DEFAULT now(),"updatedAt" timestamp NOT NULL DEFAULT now())`);
      await new SearchFoundation1791936000000().up(runner);
    } finally { await runner.release(); }
  });

  afterAll(async () => {
    if (db?.isInitialized) { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.destroy(); }
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE ${table('search_index_jobs')},${table('review_search_chunks')},${table('inquiry_search_chunks')},${table('reviews')},${table('inquiries')} RESTART IDENTITY`);
    recorder = new SearchIndexRecorder(new ConfigService({ AI_SEARCH_REVIEW_INDEX_ENABLED: 'true', AI_SEARCH_INQUIRY_INDEX_ENABLED: 'true' }));
    store = new InquiryIndexStore(db, recorder);
    maintenance = new InquiryIndexMaintenance(store);
    embed = jest.fn(async (_inputs: string[], _signal?: AbortSignal, guard?: () => Promise<void>) => {
      await guard?.();
      return { vectors: [vector], usage: { requests: 1, inputTokens: null, inputBytes: 0, inputCodePoints: 0 } };
    });
    const embedding: EmbeddingClient = { model: PROFILE.model, dimensions: PROFILE.dimensions, isEnabled: () => true, embed };
    processor = new InquiryIndexProcessor(store, embedding);
  });

  it('masks title, body and answer before external requests and stores labeled evidence only', async () => {
    await create({ title: '답변 test@example.com', content: '010-1234-5678로 연락', answer: 'help@example.com에 문의하세요.' });
    expect(await processor.runOne()).toMatchObject({ inquiryId: 1, version: '1', status: 'done' });
    const input = embed.mock.calls[0][0][0];
    expect(input).toContain('title: 답변 t***@***');
    expect(input).toContain('[문의 본문]'); expect(input).toContain('[답변]');
    expect(input).not.toMatch(/test@example|help@example|010-1234-5678/);
    const [chunk] = await rows('inquiry_search_chunks');
    expect(chunk.text).not.toMatch(/test@example|help@example|010-1234-5678/);
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ inquiry_id: 1, review_id: null, status: 'done', chunk_count: 1 });
  });

  it('commits actual normal create and answer changes with their jobs and versions atomically', async () => {
    const service = actualService();
    const source = await service.create(7, { productId: 9, title: '보통 문의', content: '답변 대기' });
    expect(source?.id).toBe(1); expect((await rows('search_index_jobs'))[0]).toMatchObject({ source_version: '1', status: 'pending' });
    await processor.runOne();
    await service.answer(55, 1, { answer: '내일 출발합니다.' });
    expect((await rows('inquiries'))[0]).toMatchObject({ answer: '내일 출발합니다.', status: 'answered', search_version: '2' });
    expect((await rows('search_index_jobs'))[1]).toMatchObject({ source_version: '2', status: 'pending' });
    await processor.runOne(); expect((await rows('inquiry_search_chunks'))[0].text).toContain('[답변]\n내일 출발합니다.');
    await expect(service.answer(55, 1, { answer: '중복 답변' })).rejects.toMatchObject({ status: 400 });
    expect((await rows('inquiries'))[0].search_version).toBe('2');
  });

  it('rolls back actual create and answer updates when job registration fails', async () => {
    const service = actualService();
    jest.spyOn(recorder, 'assertProfile').mockRejectedValueOnce(new SearchError('PROFILE_MISMATCH'));
    await expect(service.create(7, { productId: 9, title: '실패 생성', content: '롤백' })).rejects.toMatchObject({ code: 'PROFILE_MISMATCH' });
    expect(await rows('inquiries')).toEqual([]); expect(await rows('search_index_jobs')).toEqual([]);
    const source = await create();
    jest.spyOn(recorder, 'assertProfile').mockRejectedValueOnce(new SearchError('PROFILE_MISMATCH'));
    await expect(service.answer(55, source.id, { answer: '실패 답변' })).rejects.toMatchObject({ code: 'PROFILE_MISMATCH' });
    expect((await rows('inquiries'))[0]).toMatchObject({ answer: null, status: 'waiting', search_version: '1' });
    expect(await rows('search_index_jobs')).toHaveLength(1);
  });

  it('keeps migrated sources private and advances versions through actual helper even when indexing is off', async () => {
    await create(); await processor.runOne();
    const disabled = new SearchIndexRecorder(new ConfigService({ AI_SEARCH_INQUIRY_INDEX_ENABLED: 'false' }));
    const service = actualService(disabled);
    const change = (patch: Parameters<InquiryService['saveSearchChange']>[2]) => db.transaction(async manager => {
      const inquiry = await manager.getRepository(InquiryEntity).findOne({ where: { id: 1 }, lock: { mode: 'pessimistic_write' } });
      if (!inquiry) throw new Error('source fixture');
      await service.saveSearchChange(manager, inquiry, patch);
    });
    await change({ isSecret: true });
    expect((await rows('inquiries'))[0]).toMatchObject({ is_secret: true, search_version: '2' });
    expect(await rows('inquiry_search_chunks')).toEqual([]);
    await change({ isSecret: false, content: '변경 공개 본문' });
    expect((await rows('inquiries'))[0]).toMatchObject({ is_secret: false, content: '변경 공개 본문', search_version: '3' });
    expect(await rows('search_index_jobs')).toHaveLength(1);
    expect(await maintenance.backfill()).toEqual({ scanned: 1, queued: 1 });
    await processor.runOne(); expect((await rows('inquiry_search_chunks'))[0].source_version).toBe('3');
  });

  it('actual deletion rejects non-owners and answered sources, and cascades waiting source evidence', async () => {
    await create(); await processor.runOne(); const service = actualService();
    await expect(service.delete(8, 1)).rejects.toMatchObject({ status: 403 });
    expect(await rows('inquiry_search_chunks')).toHaveLength(1);
    await service.delete(7, 1);
    expect(await rows('inquiries')).toEqual([]); expect(await rows('inquiry_search_chunks')).toEqual([]); expect(await rows('search_index_jobs')).toEqual([]);
    const next = await create(); await service.answer(55, next.id, { answer: '답변 완료' });
    await expect(service.delete(7, next.id)).rejects.toMatchObject({ status: 400 });
    expect(await rows('inquiries')).toHaveLength(1);
  });

  it('creates no jobs or provider calls for secret inquiries, including backfill and retry', async () => {
    await create({ isSecret: true, content: 'private body' });
    expect(await rows('search_index_jobs')).toEqual([]);
    expect(await maintenance.backfill(1)).toEqual({ scanned: 0, queued: 0 });
    expect(await processor.runOne()).toEqual({ status: 'idle' });
    expect(await maintenance.retryFailed(1)).toBe(0);
    expect(embed).not.toHaveBeenCalled();
  });

  it('keeps source types isolated during claims, exhaustion and maintenance', async () => {
    await db.transaction(async manager => {
      await manager.query(`INSERT INTO ${searchTable(manager, 'reviews')} DEFAULT VALUES`);
      await recorder.recordReview(manager, 1);
    });
    await create();
    const review = await new ReviewIndexStore(db, recorder).claim();
    expect(review).toMatchObject({ review_id: 1 });
    expect(await claim()).toMatchObject({ inquiry_id: 1 });
    expect(await store.claim()).toBeNull();
    await db.query(`UPDATE ${table('search_index_jobs')} SET attempts=5,lease_expires_at=clock_timestamp()-interval '1 second' WHERE review_id IS NOT NULL`);
    await store.claim();
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ status: 'running', review_id: 1, attempts: 5 });
  });

  it('gives simultaneous inquiry workers distinct claims', async () => {
    await create(); await create({ content: 'second' });
    const results = await Promise.all([store.claim(), store.claim(), store.claim()]);
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(new Set(results.filter(Boolean).map(job => job?.id)).size).toBe(2);
  });

  it.each(['title', 'content', 'answer'] as const)('re-embeds changes to %s and suppresses the old version immediately', async field => {
    await create(); await processor.runOne();
    await edit(1, field, '새 원문');
    expect(await db.query(`SELECT c.id FROM ${table('inquiry_search_chunks')} c JOIN ${table('inquiries')} i ON i.id=c.inquiry_id WHERE c.source_version=i.search_version`)).toEqual([]);
    expect((await processor.runOne()).status).toBe('done');
    expect(embed).toHaveBeenCalledTimes(2);
    expect((await rows('inquiry_search_chunks'))[0].source_version).toBe('2');
  });

  it('reuses vectors after metadata-only changes while preserving bigint versions exactly', async () => {
    await create();
    await db.query(`DELETE FROM ${table('search_index_jobs')}`);
    await db.query(`UPDATE ${table('inquiries')} SET search_version='9007199254740993'`);
    expect(await maintenance.backfill()).toEqual({ scanned: 1, queued: 1 });
    await processor.runOne();
    await edit(1, 'status', 'answered');
    expect(await processor.runOne()).toMatchObject({ status: 'reused', version: '9007199254740994' });
    expect(embed).toHaveBeenCalledTimes(1);
    expect((await rows('inquiry_search_chunks'))[0].source_version).toBe('9007199254740994');
  });

  it('indexes a title-only document and completes truly empty documents with zero chunks', async () => {
    await create({ title: '제목만 있는 자료', content: '  ' });
    expect((await processor.runOne()).status).toBe('done');
    expect(embed.mock.calls[0][0][0]).toBe('title: 제목만 있는 자료 | text: ');
    expect((await rows('inquiry_search_chunks'))[0].text).toBe('');
    await db.transaction(async manager => {
      await manager.query(`UPDATE ${searchTable(manager, 'inquiries')} SET title='',content='',answer=NULL WHERE id=1`);
      await recorder.advanceInquiry(manager, 1);
    });
    embed.mockClear();
    expect((await processor.runOne()).status).toBe('done');
    expect(embed).not.toHaveBeenCalled(); expect(await rows('inquiry_search_chunks')).toEqual([]);
    expect((await rows('search_index_jobs'))[1]).toMatchObject({ status: 'done', chunk_count: 0 });
  });

  it('removes chunks at public-to-secret save and re-embeds when made public again', async () => {
    await create(); await processor.runOne();
    await edit(1, 'is_secret', true);
    expect(await rows('inquiry_search_chunks')).toEqual([]);
    expect(await processor.runOne()).toEqual({ status: 'idle' });
    await edit(1, 'is_secret', false);
    expect((await processor.runOne()).status).toBe('done');
    expect((await rows('inquiry_search_chunks'))[0].source_version).toBe('3');
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('discards a late public result after secret conversion without restoring old chunks', async () => {
    await create(); const started = barrier(); const release = barrier();
    embed.mockImplementationOnce(async () => { started.resolve(); await release.promise; return { vectors: [vector] }; });
    const work = processor.runOne(); await started.promise;
    await edit(1, 'is_secret', true); release.resolve();
    expect((await work).status).toBe('discarded');
    expect(await rows('inquiry_search_chunks')).toEqual([]);
    expect((await rows('search_index_jobs'))[0].status).toBe('superseded');
  });

  it('checks the current source after rate pacing and before any transport call', async () => {
    await create(); let transportCalls = 0;
    embed.mockImplementationOnce(async (_inputs: string[], _signal?: AbortSignal, guard?: () => Promise<void>) => {
      await edit(1, 'is_secret', true);
      await guard?.(); transportCalls++;
      return { vectors: [vector] };
    });
    expect((await processor.runOne()).status).toBe('discarded');
    expect(transportCalls).toBe(0); expect(await rows('inquiry_search_chunks')).toEqual([]);
  });

  it('rejects a direct SQL secret conversion before embedding and clears obsolete evidence under source locks', async () => {
    await create(); await processor.runOne();
    await edit(1, 'answer', '새 답변');
    await db.query(`UPDATE ${table('inquiries')} SET is_secret=true`);
    embed.mockClear();
    expect((await processor.runOne()).status).toBe('discarded');
    expect(embed).not.toHaveBeenCalled(); expect(await rows('inquiry_search_chunks')).toEqual([]);
  });

  it('repairs direct SQL secret visibility even when no pending job exists', async () => {
    await create(); await processor.runOne();
    await db.query(`UPDATE ${table('inquiries')} SET is_secret=true`);
    expect(await maintenance.reconcile()).toMatchObject({ scanned: 1, queued: 0 });
    expect(await rows('inquiry_search_chunks')).toEqual([]); expect(embed).toHaveBeenCalledTimes(1);
  });

  it('allows answer changes while external requests wait and discards the late previous result', async () => {
    await create(); const started = barrier(); const release = barrier();
    embed.mockImplementationOnce(async () => { started.resolve(); await release.promise; return { vectors: [vector] }; });
    const work = processor.runOne(); await started.promise;
    expect(await processor.runOne()).toEqual({ status: 'idle' });
    await edit(1, 'answer', '내일 출발합니다.'); release.resolve();
    expect((await work).status).toBe('discarded'); expect(await rows('inquiry_search_chunks')).toEqual([]);
    expect((await processor.runOne()).status).toBe('done');
    expect((await rows('inquiry_search_chunks'))[0].text).toContain('[답변]\n내일 출발합니다.');
  });

  it('does not request additional chunks after the source changes during the first embedding', async () => {
    await create({ content: '긴 문의 '.repeat(500) });
    embed.mockImplementationOnce(async () => { await edit(1, 'content', '새 문의'); return { vectors: [vector] }; });
    expect((await processor.runOne()).status).toBe('discarded');
    expect(embed).toHaveBeenCalledTimes(1); expect(await rows('inquiry_search_chunks')).toEqual([]);
  });

  it('cascades deletion during embedding and never recreates the source', async () => {
    await create(); const started = barrier(); const release = barrier();
    embed.mockImplementationOnce(async () => { started.resolve(); await release.promise; return { vectors: [vector] }; });
    const work = processor.runOne(); await started.promise;
    await db.query(`DELETE FROM ${table('inquiries')} WHERE id=1`); release.resolve();
    expect((await work).status).toBe('discarded');
    expect(await rows('search_index_jobs')).toEqual([]); expect(await rows('inquiry_search_chunks')).toEqual([]);
  });

  it.each(['inquiry_id', 'profile_id', 'source_version'] as const)('rejects mismatched %s at each claim boundary', async field => {
    await create(); await create(); const job = await claim();
    const mixed = { ...job, [field]: field === 'inquiry_id' ? 2 : field === 'profile_id' ? 'other-profile' : '2' };
    await expect(store.source(mixed)).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(await store.heartbeat(mixed)).toBe(false);
    expect(await store.complete(mixed, await document(), [vector])).toBe(false);
    await store.fail(mixed, new SearchError('EMBEDDING_UNAVAILABLE', true));
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ status: 'running', lease_token: job.lease_token });
  });

  it('protects a reclaimed lease from old commits and failures', async () => {
    await create(); const previous = await claim();
    await db.query(`UPDATE ${table('search_index_jobs')} SET lease_expires_at=clock_timestamp()-interval '1 second'`);
    const current = await claim();
    expect(current.lease_token).not.toBe(previous.lease_token);
    expect(await store.complete(previous, await document(), [vector])).toBe(false);
    await store.fail(previous, new SearchError('EMBEDDING_UNAVAILABLE', true));
    expect((await rows('search_index_jobs'))[0].lease_token).toBe(current.lease_token);
    expect(await store.complete(current, await document(), [vector])).toBe(true);
  });

  it('renews only valid leases and aborts when renewal fails', async () => {
    await create(); const job = await claim();
    expect(await store.heartbeat(job)).toBe(true);
    await db.query(`UPDATE ${table('search_index_jobs')} SET lease_expires_at=clock_timestamp()-interval '1 second'`);
    expect(await store.heartbeat(job)).toBe(false);
    jest.spyOn(store, 'heartbeat').mockResolvedValue(false);
    embed.mockImplementationOnce(async (_inputs: string[], signal: AbortSignal) => {
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      return { vectors: [vector] };
    });
    const quick = new InquiryIndexProcessor(store, { model: PROFILE.model, dimensions: 768, isEnabled: () => true, embed }, 10);
    expect((await quick.runOne()).status).toBe('discarded'); expect(await rows('inquiry_search_chunks')).toEqual([]);
  });

  it.each([{ vectors: [] }, { vectors: [vector, vector] }, { vectors: [undefined] }, {}])('rejects malformed adapter responses %#', async response => {
    await create(); await processor.runOne(); await edit(1, 'content', '새 문의');
    embed.mockResolvedValueOnce(response);
    expect(await processor.runOne()).toMatchObject({ status: 'failed', errorCode: 'INVALID_EMBEDDING' });
    expect((await rows('inquiry_search_chunks'))[0].source_version).toBe('1');
  });

  it('re-embeds zero vectors instead of reusing corrupt matching metadata', async () => {
    await create(); await processor.runOne();
    await db.query(`UPDATE ${table('inquiry_search_chunks')} SET embedding=$1::vector`, [JSON.stringify(Array(768).fill(0))]);
    await edit(1, 'status', 'answered');
    expect((await processor.runOne()).status).toBe('done'); expect(embed).toHaveBeenCalledTimes(2);
  });

  it('rolls back invalid replacement vectors and retains the previous chunk set', async () => {
    await create(); await processor.runOne(); await edit(1, 'answer', 'changed'); const job = await claim();
    await expect(store.complete(job, await document(), [[1e100, ...Array(767).fill(0)]])).rejects.toMatchObject({ code: 'INVALID_EMBEDDING' });
    expect((await rows('inquiry_search_chunks'))[0].source_version).toBe('1');
    expect((await rows('search_index_jobs'))[1].status).toBe('running');
  });

  it('does not reuse an old matching hash after a different document replaced the stored chunks', async () => {
    await create({ content: '본문 A' }); await processor.runOne();
    await edit(1, 'content', '본문 B'); await processor.runOne();
    await edit(1, 'content', '본문 A');
    expect((await processor.runOne()).status).toBe('done'); expect(embed).toHaveBeenCalledTimes(3);
  });

  it.each([0, -1, 1.5, 1001, NaN])('rejects invalid batch sizes before querying %s', async size => {
    const query = jest.spyOn(db.manager, 'query');
    try {
      await expect(maintenance.backfill(size)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(maintenance.reconcile(size)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(query).not.toHaveBeenCalled();
    } finally { query.mockRestore(); }
  });

  it('makes repeated backfill idempotent without replacing running claim tokens', async () => {
    await create(); const job = await claim();
    expect(await maintenance.backfill(1)).toEqual({ scanned: 1, queued: 0 });
    expect(await maintenance.backfill(1)).toEqual({ scanned: 1, queued: 0 });
    expect((await rows('search_index_jobs'))[0].lease_token).toBe(job.lease_token);
  });

  it('repairs direct SQL text changes, missing completion jobs and corrupt evidence exactly once', async () => {
    await create(); await processor.runOne();
    await db.query(`UPDATE ${table('inquiries')} SET answer='SQL 변경'`);
    expect(await maintenance.reconcile()).toMatchObject({ repaired: 1, queued: 1 });
    expect(await maintenance.reconcile()).toMatchObject({ repaired: 0, queued: 0 });
    await processor.runOne(); await db.query(`DELETE FROM ${table('search_index_jobs')} WHERE source_version=2`);
    expect(await maintenance.reconcile()).toMatchObject({ queued: 1 });
    await processor.runOne(); await db.query(`UPDATE ${table('inquiry_search_chunks')} SET text='corrupt'`);
    expect(await maintenance.reconcile()).toMatchObject({ repaired: 1, queued: 1 });
  });

  it('respects Retry-After and bounds exhausted attempts until explicit current-source retry', async () => {
    await create(); embed.mockRejectedValueOnce(new SearchError('EMBEDDING_RATE_LIMIT', true, 60000));
    expect(await processor.runOne()).toMatchObject({ status: 'failed', errorCode: 'EMBEDDING_RATE_LIMIT' });
    const [pending] = await rows('search_index_jobs');
    expect(pending.status).toBe('pending'); expect(pending.next_run_at.getTime() - Date.now()).toBeGreaterThan(55000);
    for (let attempt = 1; attempt < 5; attempt++) {
      await db.query(`UPDATE ${table('search_index_jobs')} SET next_run_at=clock_timestamp()-interval '1 second',lease_expires_at=clock_timestamp()-interval '1 second'`);
      await claim();
    }
    await db.query(`UPDATE ${table('search_index_jobs')} SET lease_expires_at=clock_timestamp()-interval '1 second'`);
    expect(await store.claim()).toBeNull();
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ status: 'failed', attempts: 5, error_code: 'ATTEMPTS_EXHAUSTED' });
    expect(await maintenance.retryFailed(1)).toBe(1);
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('halts permission errors without copying provider messages or making another request', async () => {
    await create(); embed.mockRejectedValueOnce(new SearchError('EMBEDDING_PERMISSION'));
    expect(await processor.runOne()).toMatchObject({ status: 'failed', errorCode: 'EMBEDDING_PERMISSION' });
    expect(await processor.runOne()).toEqual({ status: 'idle' }); expect(embed).toHaveBeenCalledTimes(1);
  });

  it('queues oversized SQL edits without embedding and retains only current completion during cleanup', async () => {
    await create(); await processor.runOne();
    await db.query(`UPDATE ${table('inquiries')} SET content=$1`, ['가'.repeat(40000)]);
    expect(await maintenance.reconcile()).toMatchObject({ repaired: 1, queued: 1 });
    expect(await processor.runOne()).toMatchObject({ status: 'failed', errorCode: 'SOURCE_TOO_LARGE' });
    expect(embed).toHaveBeenCalledTimes(1);
    await db.query(`UPDATE ${table('search_index_jobs')} SET completed_at=clock_timestamp()-interval '15 days'`);
    expect(await maintenance.cleanup()).toBe(1);
    expect((await rows('search_index_jobs'))[0]).toMatchObject({ source_version: '2', status: 'failed' });
  });

  it('rolls back a partial replacement chunk set on real storage failure', async () => {
    await create(); await processor.runOne(); await edit(1, 'content', '긴 문의 '.repeat(500));
    await db.query(`CREATE FUNCTION "${schema}".reject_second_chunk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.chunk_index=1 THEN RAISE EXCEPTION 'TEST_INSERT_FAILURE'; END IF; RETURN NEW; END $$`);
    await db.query(`CREATE TRIGGER reject_second_chunk BEFORE INSERT ON ${table('inquiry_search_chunks')} FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_second_chunk()`);
    try {
      expect((await processor.runOne()).status).toBe('failed');
      expect(await rows('inquiry_search_chunks')).toEqual([expect.objectContaining({ source_version: '1' })]);
      expect((await rows('search_index_jobs'))[1].status).toBe('pending');
    } finally { await db.query(`DROP TRIGGER reject_second_chunk ON ${table('inquiry_search_chunks')}`); }
  });
});
