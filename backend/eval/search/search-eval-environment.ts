import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { EmbeddingClient, EmbeddingUsage } from '../../src/intrastructure/ai/embedding-client.interface';
import { GeminiEmbeddingClient } from '../../src/intrastructure/ai/providers/gemini-embedding.client';
import { INITIAL_SEARCH_PROFILE as PROFILE } from '../../src/search/search-profile';
import { SearchFoundation1791936000000 } from '../../src/database/migrations/1791936000000-SearchFoundation';
import { SearchIndexRecorder } from '../../src/search/search-index-recorder';
import { ReviewIndexStore } from '../../src/search/review-index.store';
import { InquiryIndexStore } from '../../src/search/inquiry-index.store';
import { reviewDocument, inquiryDocument } from '../../src/search/search-document';
import { searchTable } from '../../src/search/search-sql';
import { assertSearchVector } from '../../src/search/search-vector';
import { SearchError } from '../../src/search/search-error';

export interface EvalReview { id: number; productId: number; rating: number; comment: string; createdAt: string; }
export interface EvalInquiry {
  id: number; productId: number; title: string; content: string; answer: string | null;
  isSecret: boolean; status: 'waiting' | 'answered'; createdAt: string;
}
export interface EvalCase { caseId: string; query: string; productId: number; maxRating: number | null; relevantIds: number[]; reason: string; startDate?: string; endDate?: string; }
interface CachedVector { vector: number[]; generatedAt: string; elapsedMs: number; usage: EmbeddingUsage; }
interface VectorCache { profileId: string; model: string; dimensions: number; entries: Record<string, CachedVector>; }

/** Only fixed synthetic corpora enter this cache. Production indexing does not reuse vectors across sources. */
export class EvalEmbeddingClient implements EmbeddingClient {
  readonly model = PROFILE.model;
  readonly dimensions = PROFILE.dimensions;
  readonly actual: GeminiEmbeddingClient;
  readonly cachePath = resolve(__dirname, '../../../tmp/search-eval/embedding-cache-v1.json');
  readonly cache: VectorCache;
  readonly cacheHits: Record<'document' | 'query', number> = { document: 0, query: 0 };
  readonly generated: Record<'document' | 'query', number> = { document: 0, query: 0 };

  constructor(config: ConfigService, private readonly persistCache = true) {
    this.actual = new GeminiEmbeddingClient(config);
    this.cache = existsSync(this.cachePath) ? JSON.parse(readFileSync(this.cachePath, 'utf8')) as VectorCache : {
      profileId: PROFILE.id, model: PROFILE.model, dimensions: PROFILE.dimensions, entries: {},
    };
    if (this.cache.profileId !== PROFILE.id || this.cache.model !== PROFILE.model || this.cache.dimensions !== PROFILE.dimensions) throw new SearchError('PROFILE_MISMATCH');
  }
  isEnabled(): boolean { return this.actual.isEnabled(); }
  inputKey(input: string): string { return createHash('sha256').update(input).digest('hex'); }
  record(input: string): CachedVector | undefined { return this.cache.entries[this.inputKey(input)]; }

  async embed(inputs: readonly string[], signal?: AbortSignal, guard?: () => Promise<void>) {
    const usage: EmbeddingUsage = { requests: 0, inputCodePoints: 0, inputBytes: 0, inputTokens: null };
    const vectors = [];
    for (const input of inputs) {
      if (signal?.aborted) throw new SearchError('ABORTED');
      await guard?.();
      const key = this.inputKey(input);
      const kind = input.startsWith('task:') ? 'query' : 'document';
      let record = this.cache.entries[key];
      if (record) { assertSearchVector(record.vector); this.cacheHits[kind]++; }
      else {
        const started = performance.now();
        const response = await this.actual.embed([input], signal, guard);
        assertSearchVector(response.vectors[0]);
        record = { vector: response.vectors[0], generatedAt: new Date().toISOString(), elapsedMs: performance.now() - started, usage: response.usage };
        this.cache.entries[key] = record; this.generated[kind]++;
        usage.requests += response.usage.requests; usage.inputBytes += response.usage.inputBytes; usage.inputCodePoints += response.usage.inputCodePoints;
        if (this.persistCache) {
          mkdirSync(dirname(this.cachePath), { recursive: true });
          writeFileSync(`${this.cachePath}.tmp`, JSON.stringify(this.cache)); renameSync(`${this.cachePath}.tmp`, this.cachePath);
        }
        console.log(JSON.stringify({ embeddingPrepared: kind, generated: this.generated, cacheHits: this.cacheHits }));
      }
      vectors.push(record.vector);
    }
    return { vectors, usage };
  }
}

export async function createEvalDatabase() {
  const schema = `search_eval_${randomUUID().replace(/-/g, '')}`;
  const db = new DataSource({ type: 'postgres', host: '127.0.0.1', port: Number(process.env.SEARCH_TEST_POSTGRES_PORT || 15433),
    username: 'search_probe', password: 'search_probe', database: 'shopping_mall_search_probe', schema, installExtensions: false });
  await db.initialize();
  const runner = db.createQueryRunner(); await runner.connect();
  try {
    await runner.query('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public');
    await runner.query(`CREATE SCHEMA "${schema}"`); await runner.query(`SET search_path TO "${schema}",public`);
    await runner.query('CREATE TABLE products (id int PRIMARY KEY,category_id int NOT NULL)');
    await runner.query('CREATE TABLE reviews (id int PRIMARY KEY,product_id int NOT NULL,rating int NOT NULL,comment text NOT NULL,"createdAt" timestamp NOT NULL)');
    await runner.query(`CREATE TABLE inquiries (id int PRIMARY KEY, product_id int NOT NULL,
      title varchar(200) NOT NULL DEFAULT '',content text NOT NULL DEFAULT '',answer text,
      is_secret boolean NOT NULL DEFAULT false,status varchar NOT NULL DEFAULT 'waiting',
      "createdAt" timestamp NOT NULL DEFAULT now())`);
    await new SearchFoundation1791936000000().up(runner);
  } catch (error) {
    await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await runner.release(); await db.destroy(); throw error;
  }
  finally { await runner.release(); }
  return { db, schema, async close() { await db.query(`DROP SCHEMA "${schema}" CASCADE`); await db.destroy(); } };
}

export async function prepareReviews(db: DataSource, reviews: readonly EvalReview[], embeddings: EmbeddingClient) {
  const recorder = new SearchIndexRecorder(new ConfigService());
  const store = new ReviewIndexStore(db, recorder);
  const table = (name: Parameters<typeof searchTable>[1]) => searchTable(db.manager, name);
  for (const id of new Set(reviews.map(review => review.productId))) await db.query(`INSERT INTO ${table('products')} VALUES ($1,1) ON CONFLICT (id) DO NOTHING`, [id]);
  for (const review of reviews) {
    const document = reviewDocument(review.comment);
    const response = document.chunks.length ? await embeddings.embed(document.chunks.map(chunk => chunk.input)) : { vectors: [] };
    await db.transaction(async manager => {
      await manager.query(`INSERT INTO ${table('reviews')} (id,product_id,rating,comment,"createdAt") VALUES ($1,$2,$3,$4,$5::timestamptz AT TIME ZONE 'UTC')`,
        [review.id, review.productId, review.rating, review.comment, review.createdAt]);
      await recorder.recordReview(manager, review.id, true);
    });
    const job = await store.claim(); if (!job || job.review_id !== review.id) throw new SearchError('INDEX_STORAGE_FAILED');
    if (!await store.complete(job, document, response.vectors)) throw new SearchError('INDEX_STORAGE_FAILED');
  }
  const [{ count }] = await db.query(`SELECT count(*)::int AS count FROM ${table('review_search_chunks')}`);
  return count as number;
}

export async function prepareInquiries(db: DataSource, inquiries: readonly EvalInquiry[], embeddings: EmbeddingClient) {
  const recorder = new SearchIndexRecorder(new ConfigService());
  const store = new InquiryIndexStore(db, recorder);
  const table = (name: Parameters<typeof searchTable>[1]) => searchTable(db.manager, name);
  for (const id of new Set(inquiries.map(source => source.productId))) await db.query(`INSERT INTO ${table('products')} VALUES ($1,1) ON CONFLICT (id) DO NOTHING`, [id]);
  for (const source of inquiries) {
    await db.transaction(async manager => {
      await manager.query(`INSERT INTO ${table('inquiries')} (id,product_id,title,content,answer,is_secret,status,"createdAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz AT TIME ZONE 'UTC')`,
        [source.id, source.productId, source.title, source.content, source.answer, source.isSecret, source.status, source.createdAt]);
      await recorder.recordInquiry(manager, source.id, true);
    });
    const document = inquiryDocument(source);
    if (!document) continue;
    const job = await store.claim(); if (!job || job.inquiry_id !== source.id) throw new SearchError('INDEX_STORAGE_FAILED');
    const response = document.chunks.length ? await embeddings.embed(document.chunks.map(chunk => chunk.input)) : { vectors: [] };
    if (!await store.complete(job, document, response.vectors)) throw new SearchError('INDEX_STORAGE_FAILED');
  }
  const [{ count }] = await db.query(`SELECT count(*)::int AS count FROM ${table('inquiry_search_chunks')}`);
  return count as number;
}

export function score(ids: number[], relevant: number[]) {
  const matches = ids.slice(0, 5).filter(id => relevant.includes(id)).length;
  return { hitAt5: relevant.length ? Number(matches > 0) : null, recallAt5: relevant.length ? matches / relevant.length : null,
    precisionAt5: relevant.length ? matches / 5 : null, relevantReturned: matches, returnedSourceCount: ids.length };
}
