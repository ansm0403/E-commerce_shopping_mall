import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { SearchFoundation1791936000000 } from '../database/migrations/1791936000000-SearchFoundation';
import { SearchIndexRecorder } from './search-index-recorder';
import { InquiryIndexStore } from './inquiry-index.store';
import { SemanticSearchService } from './semantic-search.service';
import { inquiryDocument } from './search-document';
import { searchTable } from './search-sql';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';
import { adminToolContext, evaluationToolContext } from './tool-execution-context';
import { SearchError } from './search-error';
import type { InquirySearchInput } from './search-input';

const axis = (first = 1, second = 0) => [first, second, ...Array(766).fill(0)];
const context = evaluationToolContext('inquiry-semantic-test');
interface SourceOptions {
  title?: string; content?: string; answer?: string | null; isSecret?: boolean;
  productId?: number; status?: 'waiting' | 'answered'; createdAt?: string; indexed?: boolean; vectors?: number[][];
}

describe('semantic public inquiries (real PostgreSQL)', () => {
  const schema = `inquiry_semantic_probe_${randomUUID().replace(/-/g, '')}`;
  let db: DataSource;
  let config: ConfigService;
  let recorder: SearchIndexRecorder;
  let store: InquiryIndexStore;
  let search: SemanticSearchService;
  let embed: jest.Mock;
  const table = (name: Parameters<typeof searchTable>[1]) => searchTable(db.manager, name);
  const run = (input: Partial<InquirySearchInput> = {}) => search.searchInquiries({ query: '제품 사용 문제의 해결 답변', ...input }, context);

  async function source(id: number, options: SourceOptions = {}) {
    const original = { title: options.title ?? `문의 ${id}`, content: options.content ?? `문의 원문 ${id}`,
      answer: options.answer ?? null, isSecret: options.isSecret ?? false };
    await db.transaction(async manager => {
      await manager.query(`INSERT INTO ${table('inquiries')} (id,product_id,title,content,answer,is_secret,status,"createdAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz AT TIME ZONE 'UTC')`,
      [id, options.productId ?? 1, original.title, original.content, original.answer, original.isSecret,
        options.status ?? 'waiting', options.createdAt ?? '2026-10-13T12:00:00+09:00']);
      await recorder.recordInquiry(manager, id, true);
    });
    if (options.indexed !== false && !original.isSecret) {
      const job = await store.claim(); if (!job || job.inquiry_id !== id) throw new Error('claim order');
      const document = inquiryDocument(original); if (!document) throw new Error('public document missing');
      if (!await store.complete(job, document, document.chunks.length ? document.chunks.map((_, index) => options.vectors?.[index] ?? axis()) : undefined)) throw new Error('complete failed');
    }
  }
  async function edit(id: number, sql: string) {
    await db.transaction(async manager => {
      await manager.query(`UPDATE ${table('inquiries')} SET ${sql},search_version=search_version+1 WHERE id=$1`, [id]);
      await recorder.recordInquiry(manager, id, true);
    });
  }
  function afterRanking(mutate: () => Promise<void>) {
    const original = db.createQueryRunner.bind(db);
    let changed = false;
    const spy = jest.spyOn(db, 'createQueryRunner').mockImplementation(mode => {
      const runner = original(mode); const query = runner.manager.query.bind(runner.manager);
      runner.manager.query = async (sql, values) => {
        const rows = await query(sql, values);
        if (!changed && sql.includes('ORDER BY distance')) { changed = true; await mutate(); }
        return rows;
      };
      return runner;
    });
    return { spy, changed: () => changed };
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
      await runner.query('CREATE TABLE reviews (id int PRIMARY KEY)');
      await runner.query(`CREATE TABLE inquiries (id int PRIMARY KEY,product_id int NOT NULL,title text NOT NULL,content text NOT NULL,
        answer text,is_secret boolean NOT NULL,status text NOT NULL,"createdAt" timestamp NOT NULL)`);
      await new SearchFoundation1791936000000().up(runner);
    } finally { await runner.release(); }
  });
  afterAll(async () => { if (db?.isInitialized) { await db.query(`DROP SCHEMA "${schema}" CASCADE`); await db.destroy(); } });
  beforeEach(async () => {
    await db.query(`TRUNCATE ${table('inquiries')},${table('products')},${table('search_index_jobs')},${table('inquiry_search_chunks')} RESTART IDENTITY CASCADE`);
    await db.query(`INSERT INTO ${table('products')} VALUES (1,1),(2,2),(3,1)`);
    config = new ConfigService({ AI_SEARCH_INQUIRIES_ENABLED: 'true', AI_SEARCH_INQUIRY_INDEX_ENABLED: 'true' });
    recorder = new SearchIndexRecorder(config); store = new InquiryIndexStore(db, recorder);
    embed = jest.fn(async () => ({ vectors: [axis()], usage: { requests: 1, inputBytes: 1, inputCodePoints: 1, inputTokens: null } }));
    search = new SemanticSearchService(db, config, { model: PROFILE.model, dimensions: 768, isEnabled: () => true, embed }, recorder);
  });

  it('returns masked public title, body and answer citations with exact ranking and no author/vector/distance fields', async () => {
    await source(1, { title: 'title@example.com의 문의', content: '본문 010-1234-5678', answer: '답변 answer@example.com', status: 'answered', vectors: [axis(0, 1)] });
    await source(2, { content: 'a'.repeat(1900), vectors: [axis(), axis()] });
    await source(3, { vectors: [axis(1, 1)] });
    const result = await run();
    expect(result.status).toBe('ok');
    expect(result.data.sources.map(row => row.id)).toEqual([2, 3, 1]);
    expect(result.data.sources[0].quotes).toHaveLength(2);
    expect(result.data.sources[2]).toMatchObject({ sourceType: 'inquiry', productId: 1, status: 'answered' });
    const text = result.data.sources[2].quotes.map(quote => quote.text).join('\n');
    expect(text).toContain('t***@***'); expect(text).toContain('본문'); expect(text).toContain('답변');
    expect(result.coverage).toEqual({ total: 3, ready: 3, pending: 0, failed: 0, partial: false });
    expect(JSON.stringify(result)).not.toMatch(/title@example.com|answer@example.com|010-1234-5678|"embedding":|"distance":|user_id|seller_id/);
    expect(result.scope).toMatchObject({ sourceType: 'inquiry', timezone: 'Asia/Seoul', query: '제품 사용 문제의 해결 답변' });
  });

  it('cites a title-only inquiry and an answer-only inquiry without losing their evidence', async () => {
    await source(1, { title: '소매가 조여 움직이기 어렵습니다', content: '' });
    await source(2, { title: '', content: '', answer: '끈 길이를 조절한 뒤 교환을 접수해주세요.', status: 'answered' });
    const result = await run();
    expect(result.status).toBe('ok');
    expect(result.data.sources[0].quotes.map(quote => quote.text).join('\n')).toContain('소매가 조여 움직이기 어렵습니다');
    expect(result.data.sources[1].quotes.map(quote => quote.text).join('\n')).toContain('끈 길이를 조절');
    expect(result.data.sources[0]).toMatchObject({ hasContent: false, hasAnswer: false });
    expect(result.data.sources[1]).toMatchObject({ hasContent: false, hasAnswer: true });
  });

  it('excludes secret inquiries from results and all coverage counts, regardless of stored chunks or jobs', async () => {
    await source(1); await source(4); await source(2, { indexed: false }); await source(3, { isSecret: true });
    // Simulate a pre-existing stray completed index for a secret row; query protection cannot rely only on recorder cleanup.
    await db.query(`UPDATE ${table('inquiries')} SET is_secret=true WHERE id=4`);
    await db.query(`INSERT INTO ${table('search_index_jobs')} (inquiry_id,source_version,profile_id,status,error_code,completed_at)
      VALUES (3,1,$1,'failed','INDEX_STORAGE_FAILED',now())`, [PROFILE.id]);
    const result = await run();
    expect(result.data.sources.map(row => row.id)).toEqual([1]);
    expect(result.coverage).toEqual({ total: 2, ready: 1, pending: 1, failed: 0, partial: true });
    await db.query(`UPDATE ${table('inquiries')} SET is_secret=true WHERE id IN (1,2)`);
    embed.mockClear(); expect((await run()).status).toBe('no_data'); expect(embed).not.toHaveBeenCalled();
  });

  it('uses current status and product/category filters and never widens empty scopes', async () => {
    await source(1, { status: 'waiting', answer: '답변이 있어도 현재 상태는 waiting입니다.' });
    await source(2, { status: 'answered', productId: 2 }); await source(3, { productId: 3, status: 'answered' });
    expect((await run({ status: 'waiting' })).data.sources.map(row => row.id)).toEqual([1]);
    expect((await run({ status: 'answered', categoryIds: [1] })).data.sources.map(row => row.id)).toEqual([3]);
    expect((await run({ productIds: [2] })).data.sources.map(row => row.id)).toEqual([2]);
    await db.query(`UPDATE ${table('products')} SET category_id=2 WHERE id=1`);
    expect((await run({ productIds: [1,3], categoryIds: [1] })).data.sources.map(row => row.id)).toEqual([3]);
    embed.mockClear();
    expect((await run({ productIds: [] })).status).toBe('no_data');
    expect((await run({ categoryIds: [], categoryName: 'empty', productIds: [1] })).status).toBe('no_data');
    expect(embed).not.toHaveBeenCalled();
  });

  it('includes KST date microseconds and excludes the following midnight', async () => {
    await source(1, { createdAt: '2026-10-12T23:59:59.999999+09:00' });
    await source(2, { createdAt: '2026-10-13T00:00:00+09:00' });
    await source(3, { createdAt: '2026-10-13T23:59:59.999999+09:00' });
    await source(4, { createdAt: '2026-10-14T00:00:00+09:00' });
    expect((await run({ startDate: '2026-10-13', endDate: '2026-10-13' })).data.sources.map(row => row.id)).toEqual([2, 3]);
    expect((await run({ endDate: '2026-10-12' })).data.sources.map(row => row.id)).toEqual([1]);
  });

  it('distinguishes no source, completed empty source, missing/pending/failed indexes and partial readiness', async () => {
    expect((await run()).status).toBe('no_data');
    await source(1, { title: '', content: ' ', answer: '' }); expect((await run()).status).toBe('no_candidates');
    await source(2, { indexed: false }); expect((await run()).status).toBe('indexing');
    await db.query(`DELETE FROM ${table('search_index_jobs')} WHERE inquiry_id=2`); expect((await run()).status).toBe('indexing');
    await db.transaction(manager => recorder.recordInquiry(manager, 2, true));
    await db.query(`UPDATE ${table('search_index_jobs')} SET status='failed',completed_at=now(),error_code='EMBEDDING_TIMEOUT' WHERE inquiry_id=2`);
    expect((await run()).status).toBe('unavailable');
    await source(3);
    const result = await run();
    expect(result.status).toBe('ok'); expect(result.data.sources.map(row => row.id)).toEqual([3]);
    expect(result.coverage).toEqual({ total: 3, ready: 2, pending: 0, failed: 1, partial: true });
  });

  it.each(['title', 'content', 'answer'])('excludes stale vectors after a recorded %s edit without implicitly indexing', async field => {
    await source(1, { status: 'answered', answer: '이전 답변' });
    await edit(1, `${field}='new text'`);
    const result = await run();
    expect(result.status).toBe('indexing'); expect(result.data.sources).toEqual([]); expect(embed).not.toHaveBeenCalled();
  });

  it('requires a new current index after secret-to-public transition, then exposes only its public text', async () => {
    await source(1, { isSecret: true, title: '공개 전 제목', content: '공개할 문의' });
    expect((await run()).status).toBe('no_data');
    await edit(1, 'is_secret=false');
    expect((await run()).status).toBe('indexing'); expect(embed).not.toHaveBeenCalled();
    const job = await store.claim(); if (!job) throw new Error('missing public job');
    const document = inquiryDocument({ title: '공개 전 제목', content: '공개할 문의', answer: null, isSecret: false });
    if (!document) throw new Error('missing document');
    await store.complete(job, document, [axis()]);
    expect((await run()).data.sources.map(row => row.id)).toEqual([1]);
  });

  it.each(['secret', 'delete', 'title', 'content', 'answer', 'status', 'product', 'category', 'failed'])('rechecks %s changes during the query embedding request', async mutation => {
    await source(1, { status: 'waiting', answer: '이전 답변' });
    embed.mockImplementationOnce(async () => {
      if (mutation === 'secret') await edit(1, 'is_secret=true');
      if (mutation === 'delete') await db.query(`DELETE FROM ${table('inquiries')} WHERE id=1`);
      if (['title', 'content', 'answer'].includes(mutation)) await edit(1, `${mutation}='new text'`);
      if (mutation === 'status') await db.query(`UPDATE ${table('inquiries')} SET status='answered' WHERE id=1`);
      if (mutation === 'product') await db.query(`UPDATE ${table('inquiries')} SET product_id=2 WHERE id=1`);
      if (mutation === 'category') await db.query(`UPDATE ${table('products')} SET category_id=2 WHERE id=1`);
      if (mutation === 'failed') await db.query(`UPDATE ${table('search_index_jobs')} SET status='failed',completed_at=now(),error_code='INDEX_STORAGE_FAILED' WHERE inquiry_id=1`);
      return { vectors: [axis()], usage: { requests: 1, inputBytes: 1, inputCodePoints: 1, inputTokens: null } };
    });
    const result = await run({ status: 'waiting', productIds: [1], categoryIds: [1] });
    expect(result.status).toBe(['title', 'content', 'answer'].includes(mutation) ? 'indexing' : mutation === 'failed' ? 'unavailable' : 'no_data');
    expect(result.data.sources).toEqual([]); expect(embed).toHaveBeenCalledTimes(1);
  });

  it.each(['secret', 'delete', 'title', 'content', 'answer', 'status', 'product', 'category', 'raw-title', 'raw-answer'])('rechecks %s after ranking before exposing a citation', async mutation => {
    await source(1, { status: 'waiting', answer: '이전 답변' });
    const probe = afterRanking(async () => {
      if (mutation === 'secret') await edit(1, 'is_secret=true');
      if (mutation === 'delete') await db.query(`DELETE FROM ${table('inquiries')} WHERE id=1`);
      if (['title', 'content', 'answer'].includes(mutation)) await edit(1, `${mutation}='new text'`);
      if (mutation === 'raw-title' || mutation === 'raw-answer') await db.query(`UPDATE ${table('inquiries')} SET ${mutation.slice(4)}='unrecorded text' WHERE id=1`);
      if (mutation === 'status') await db.query(`UPDATE ${table('inquiries')} SET status='answered' WHERE id=1`);
      if (mutation === 'product') await db.query(`UPDATE ${table('inquiries')} SET product_id=2 WHERE id=1`);
      if (mutation === 'category') await db.query(`UPDATE ${table('products')} SET category_id=2 WHERE id=1`);
    });
    try {
      const result = await run({ status: 'waiting', productIds: [1], categoryIds: [1] });
      expect(probe.changed()).toBe(true); expect(result.status).not.toBe('ok'); expect(result.data.sources).toEqual([]);
      if (mutation === 'secret') {
        expect(result.data).toMatchObject({ candidateChunkCount: 0, omittedSourceCount: 0 });
        expect(result.coverage).toMatchObject({ total: 0, ready: 0, pending: 0, failed: 0 });
      }
    } finally { probe.spy.mockRestore(); }
  });

  it('does not report no candidates when a new completed source version replaces the ranked version', async () => {
    await source(1);
    const probe = afterRanking(async () => {
      await edit(1, "answer='새 답변',status='answered'");
      const job = await store.claim(); if (!job) throw new Error('missing next job');
      const document = inquiryDocument({ title: '문의 1', content: '문의 원문 1', answer: '새 답변', isSecret: false });
      if (!document) throw new Error('missing document');
      await store.complete(job, document, [axis()]);
    });
    try {
      expect(await run()).toMatchObject({ status: 'unavailable', error: { code: 'SOURCE_CHANGED' }, data: { sources: [] }, coverage: { ready: 1, partial: true } });
      expect(probe.changed()).toBe(true);
    } finally { probe.spy.mockRestore(); }
  });

  it.each(['chunk-text', 'content-hash', 'raw-title', 'raw-answer', 'zero-vector', 'missing-chunk'])('rejects %s corruption without leaking contact text or treating it as no data', async corruption => {
    await source(1, { answer: '기존 답변', status: 'answered' });
    if (corruption === 'chunk-text') await db.query(`UPDATE ${table('inquiry_search_chunks')} SET text='leak@example.com 010-1234-5678'`);
    if (corruption === 'content-hash') await db.query(`UPDATE ${table('inquiry_search_chunks')} SET content_hash=$1`, ['0'.repeat(64)]);
    if (corruption === 'raw-title' || corruption === 'raw-answer') await db.query(`UPDATE ${table('inquiries')} SET ${corruption.slice(4)}='leak@example.com 010-1234-5678' WHERE id=1`);
    if (corruption === 'zero-vector') await db.query(`UPDATE ${table('inquiry_search_chunks')} SET embedding=$1::vector`, [JSON.stringify(Array(768).fill(0))]);
    if (corruption === 'missing-chunk') await db.query(`DELETE FROM ${table('inquiry_search_chunks')}`);
    const result = await run();
    expect(result.status).toBe('unavailable'); expect(result.coverage).toEqual({ total: 1, ready: 0, pending: 0, failed: 1, partial: true });
    expect(result.data.sources).toEqual([]);
    // SQL can detect hash/count/vector corruption before embedding. Text edits need the final source comparison.
    expect(embed).toHaveBeenCalledTimes(['chunk-text', 'raw-title', 'raw-answer'].includes(corruption) ? 1 : 0);
    expect(JSON.stringify(result)).not.toMatch(/leak@example.com|010-1234-5678/);
  });

  it('returns partial coverage while excluding a corrupted inquiry and keeping the valid source', async () => {
    await source(1); await source(2);
    await db.query(`UPDATE ${table('inquiries')} SET title='unrecorded change' WHERE id=1`);
    const result = await run();
    expect(result.status).toBe('ok'); expect(result.data.sources.map(row => row.id)).toEqual([2]);
    expect(result.coverage).toEqual({ total: 2, ready: 1, pending: 0, failed: 1, partial: true });
  });

  it('masks query text before embedding, reports safe provider failure, and recognizes profile/client mismatch', async () => {
    await source(1);
    expect((await run({ query: 'contact@example.com 010-1234-5678' })).status).toBe('ok');
    expect(embed.mock.calls[0][0]).toEqual(['task: search result | query: c***@*** ***']);
    embed.mockRejectedValueOnce({ message: 'secret@example.com API-key raw-body' });
    const failed = await run(); expect(failed.status).toBe('unavailable'); expect(JSON.stringify(failed)).not.toMatch(/secret@example.com|API-key|raw-body/);
    embed.mockRejectedValueOnce(new SearchError('EMBEDDING_TIMEOUT', true)); expect((await run()).error?.code).toBe('EMBEDDING_TIMEOUT');
    await db.query(`UPDATE ${table('search_embedding_profiles')} SET model='other' WHERE id=$1`, [PROFILE.id]);
    try { expect((await run()).error?.code).toBe('PROFILE_MISMATCH'); }
    finally { await db.query(`UPDATE ${table('search_embedding_profiles')} SET model=$2 WHERE id=$1`, [PROFILE.id, PROFILE.model]); }
  });

  it('rejects invalid actor, disabled search and invalid status/date/query before any DB or provider access', async () => {
    const query = jest.spyOn(db, 'createQueryRunner');
    try {
      expect((await search.searchInquiries({ query: 'q' }, adminToolContext(1, ['buyer']))).status).toBe('forbidden');
      config.set('AI_SEARCH_INQUIRIES_ENABLED', 'false'); expect((await run()).status).toBe('unsupported');
      config.set('AI_SEARCH_INQUIRIES_ENABLED', 'true');
      expect((await search.searchInquiries({ query: 'q', status: 'invalid' } as unknown as InquirySearchInput, context)).status).toBe('invalid_arguments');
      expect((await run({ query: ' ', take: 11 })).status).toBe('invalid_arguments');
      expect((await run({ startDate: '2026-02-30' })).status).toBe('invalid_arguments');
      expect((await run({ categoryName: 'unresolved' })).status).toBe('invalid_arguments');
      expect((await run({ query: 'a@b.co '.repeat(142) })).status).toBe('invalid_arguments');
      expect(query).not.toHaveBeenCalled(); expect(embed).not.toHaveBeenCalled();
    } finally { query.mockRestore(); }
  });

  it('cancels a live ranking query promptly and leaves the pool usable for subsequent inquiry search', async () => {
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
    const work = search.searchInquiries({ query: 'q' }, evaluationToolContext('inquiry-abort', abort.signal));
    try {
      await started; const time = Date.now(); abort.abort();
      expect((await work).error?.code).toBe('ABORTED'); expect(Date.now() - time).toBeLessThan(1500);
    } finally { spy.mockRestore(); }
    expect((await run()).status).toBe('ok');
  });

  it('reports an absent embedding key without invoking the provider', async () => {
    await source(1); const enabled = jest.spyOn(search.embedding, 'isEnabled').mockReturnValue(false);
    try { expect((await run()).error?.code).toBe('EMBEDDING_DISABLED'); expect(embed).not.toHaveBeenCalled(); }
    finally { enabled.mockRestore(); }
  });
});
