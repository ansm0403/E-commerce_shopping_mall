import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { SearchFoundation1791936000000 } from '../database/migrations/1791936000000-SearchFoundation';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';
import { ReviewSearchChunkEntity } from './entity/review-search-chunk.entity';
import { InquirySearchChunkEntity } from './entity/inquiry-search-chunk.entity';
import { SearchIndexJobEntity } from './entity/search-index-job.entity';
import { SearchEmbeddingProfileEntity } from './entity/search-embedding-profile.entity';
import { ROLE_DEMO_ENTITIES } from '../seed/role-demo.entities';

/** Isolated schema on the dedicated probe DB; never drop/reset an application's schema. */
describe('search foundation (real PostgreSQL)', () => {
  let db: DataSource;
  let runner: QueryRunner;
  const schema = `search_probe_${randomUUID().replace(/-/g, '')}`;
  const migration = new SearchFoundation1791936000000();
  const embedding = JSON.stringify([1, ...Array(767).fill(0)]);
  const hash = 'a'.repeat(64);

  beforeAll(async () => {
    db = new DataSource({ type: 'postgres', host: '127.0.0.1',
      port: Number(process.env.SEARCH_TEST_POSTGRES_PORT || 15433), username: 'search_probe', password: 'search_probe', database: 'shopping_mall_search_probe',
      schema, installExtensions: false,
      entities: [...ROLE_DEMO_ENTITIES, ReviewSearchChunkEntity, InquirySearchChunkEntity, SearchIndexJobEntity, SearchEmbeddingProfileEntity] });
    await db.initialize();
    runner = db.createQueryRunner();
    await runner.connect();
    await runner.query('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public');
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET search_path TO "${schema}", public`);
    await runner.query('CREATE TABLE reviews (id int PRIMARY KEY, comment text NOT NULL)');
    await runner.query('CREATE TABLE inquiries (id int PRIMARY KEY, is_secret boolean NOT NULL DEFAULT false)');
    await runner.query("INSERT INTO reviews VALUES (1,'원문'),(2,'다른 원문')");
    await runner.query('INSERT INTO inquiries VALUES (1,false)');
    await migration.up(runner);
  });

  afterAll(async () => {
    if (runner && !runner.isReleased) {
      await runner.query('SET search_path TO public');
      await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await runner.release();
    }
    if (db?.isInitialized) await db.destroy();
  });

  it('installs the profile, positive bigint source versions and native vector(768)', async () => {
    const [profile] = await runner.query('SELECT * FROM search_embedding_profiles');
    expect(profile.settings).toEqual(PROFILE);
    const [review] = await runner.query('SELECT search_version FROM reviews WHERE id=1');
    expect(review.search_version).toBe('1');
    const [type] = await runner.query("SELECT format_type(atttypid,atttypmod) AS type FROM pg_attribute WHERE attrelid='review_search_chunks'::regclass AND attname='embedding'");
    expect(type.type).toBe('vector(768)');
    await expect(runner.query('UPDATE reviews SET search_version=0 WHERE id=1')).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects missing/both job sources, duplicate jobs and incomplete done state', async () => {
    await expect(runner.query('INSERT INTO search_index_jobs (profile_id,source_version) VALUES ($1,1)', [PROFILE.id])).rejects.toMatchObject({ code: '23514' });
    await expect(runner.query('INSERT INTO search_index_jobs (review_id,inquiry_id,profile_id,source_version) VALUES (1,1,$1,1)', [PROFILE.id])).rejects.toMatchObject({ code: '23514' });
    await runner.query('INSERT INTO search_index_jobs (review_id,profile_id,source_version) VALUES (1,$1,1)', [PROFILE.id]);
    await expect(runner.query('INSERT INTO search_index_jobs (review_id,profile_id,source_version) VALUES (1,$1,1)', [PROFILE.id])).rejects.toMatchObject({ code: '23505' });
    await expect(runner.query("UPDATE search_index_jobs SET status='done' WHERE review_id=1")).rejects.toMatchObject({ code: '23514' });
    await runner.query("UPDATE search_index_jobs SET status='done',content_hash=$1,chunk_count=0,completed_at=now() WHERE review_id=1", [hash]);
  });

  it('round-trips vectors through TypeORM and filters by profile and current source version', async () => {
    const repo = runner.manager.getRepository(ReviewSearchChunkEntity);
    const saved = await repo.save({ reviewId: 1, profileId: PROFILE.id, sourceVersion: '1', chunkIndex: 0,
      text: '마스킹한 근거', contentHash: hash, embedding: JSON.parse(embedding) });
    const loaded = await repo.findOneByOrFail({ id: saved.id });
    expect(loaded.embedding).toEqual(JSON.parse(embedding));
    expect(loaded.sourceVersion).toBe('1');
    await runner.query('UPDATE search_index_jobs SET chunk_count=1 WHERE review_id=1');
    const [match] = await runner.query(`SELECT c.review_id, c.embedding <=> $1::vector AS distance FROM review_search_chunks c
      JOIN reviews r ON r.id=c.review_id JOIN search_index_jobs j ON j.review_id=r.id AND j.profile_id=c.profile_id
        AND j.source_version=r.search_version AND j.status='done'
      WHERE c.profile_id=$2 AND c.source_version=r.search_version ORDER BY distance, c.review_id, c.chunk_index`, [embedding, PROFILE.id]);
    expect(match.distance).toBe(0);
    await runner.query('UPDATE reviews SET search_version=search_version+1 WHERE id=1');
    const stale = await runner.query('SELECT c.id FROM review_search_chunks c JOIN reviews r ON r.id=c.review_id WHERE c.source_version=r.search_version');
    expect(stale).toEqual([]);
  });

  it('rejects invalid job state, retry count and chunk count at the DB boundary', async () => {
    for (const statement of [
      "UPDATE search_index_jobs SET status='running' WHERE review_id=1",
      'UPDATE search_index_jobs SET attempts=-1 WHERE review_id=1',
      'UPDATE search_index_jobs SET chunk_count=33 WHERE review_id=1',
    ]) await expect(runner.query(statement)).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces chunk index, vector dimension, source/profile references and uniqueness', async () => {
    const insert = (source: number, profile: string, index: number, values = embedding) => runner.query(
      'INSERT INTO review_search_chunks (review_id,profile_id,source_version,chunk_index,text,content_hash,embedding) VALUES ($1,$2,1,$3,$4,$5,$6::vector)',
      [source, profile, index, 'probe', hash, values]);
    await expect(insert(2, PROFILE.id, 32)).rejects.toMatchObject({ code: '23514' });
    await expect(insert(2, PROFILE.id, -1)).rejects.toMatchObject({ code: '23514' });
    await expect(insert(2, PROFILE.id, 0, '[1,0]')).rejects.toMatchObject({ code: '22000' });
    await expect(insert(999, PROFILE.id, 0)).rejects.toMatchObject({ code: '23503' });
    await expect(insert(2, 'missing-profile', 0)).rejects.toMatchObject({ code: '23503' });
    await insert(2, PROFILE.id, 0);
    await expect(insert(2, PROFILE.id, 0)).rejects.toMatchObject({ code: '23505' });
  });

  it('keeps versions beyond Number.MAX_SAFE_INTEGER lossless and cascades source deletion', async () => {
    await runner.query("UPDATE reviews SET search_version='9007199254740993' WHERE id=1");
    const [review] = await runner.query('SELECT search_version FROM reviews WHERE id=1');
    expect(review.search_version).toBe('9007199254740993');
    await runner.query('DELETE FROM reviews WHERE id=1');
    expect(await runner.query('SELECT id FROM review_search_chunks WHERE review_id=1')).toEqual([]);
    expect(await runner.query('SELECT id FROM search_index_jobs WHERE review_id=1')).toEqual([]);
  });

  it('reverts derived objects while retaining original values and shared extension', async () => {
    await migration.down(runner);
    expect((await runner.query('SELECT comment FROM reviews WHERE id=2'))[0].comment).toBe('다른 원문');
    expect((await runner.query("SELECT extversion FROM pg_extension WHERE extname='vector'"))[0]).toBeDefined();
    await migration.up(runner);
  });
});
