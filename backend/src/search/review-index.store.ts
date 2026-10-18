import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { SearchIndexRecorder } from './search-index-recorder';
import { SearchError } from './search-error';
import type { SearchDocument } from './search-document';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';
import { mutationRows, searchTable } from './search-sql';
import { assertSearchVector } from './search-vector';

export interface ClaimedReviewJob {
  id: string; review_id: number; source_version: string; profile_id: string; attempts: number; lease_token: string;
}
export interface ReviewIndexOptions { leaseMs: number; maxAttempts: number; }
export const REVIEW_INDEX_DEFAULTS: ReviewIndexOptions = { leaseMs: 120000, maxAttempts: 5 };

export class ReviewIndexStore {
  constructor(readonly db: DataSource, readonly recorder: SearchIndexRecorder,
    readonly options: ReviewIndexOptions = REVIEW_INDEX_DEFAULTS) {}

  async claim(): Promise<ClaimedReviewJob | null> {
    return this.db.transaction(async manager => {
      const jobs = searchTable(manager, 'search_index_jobs');
      // Expired final attempts are terminal, without a sixth provider request.
      await manager.query(`WITH exhausted AS (SELECT id FROM ${jobs}
        WHERE profile_id=$1 AND review_id IS NOT NULL AND attempts >= $2
          AND ((status='running' AND lease_expires_at <= clock_timestamp()) OR status='pending')
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100)
        UPDATE ${jobs} j SET status='failed',error_code='ATTEMPTS_EXHAUSTED',completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL
        FROM exhausted e WHERE j.id=e.id`, [PROFILE.id, this.options.maxAttempts]);
      const rows = await manager.query(`WITH candidate AS (
        SELECT id FROM ${jobs} WHERE profile_id=$1 AND review_id IS NOT NULL AND attempts < $2
          AND ((status='pending' AND next_run_at <= clock_timestamp()) OR (status='running' AND lease_expires_at <= clock_timestamp()))
        ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE ${jobs} j SET status='running',attempts=j.attempts+1,lease_token=$3,
          lease_expires_at=clock_timestamp()+$4 * interval '1 millisecond',error_code=NULL,completed_at=NULL
        FROM candidate c WHERE j.id=c.id RETURNING j.*`, [PROFILE.id, this.options.maxAttempts, randomUUID(), this.options.leaseMs]);
      return mutationRows<ClaimedReviewJob>(rows)[0] ?? null;
    });
  }

  async heartbeat(job: ClaimedReviewJob): Promise<boolean> {
    const rows = await this.db.manager.query(`UPDATE ${searchTable(this.db.manager, 'search_index_jobs')}
      SET lease_expires_at=clock_timestamp()+$3 * interval '1 millisecond'
      WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_expires_at > clock_timestamp()
        AND review_id=$4 AND profile_id=$5 AND profile_id=$6 AND source_version=$7 RETURNING id`,
    [job.id, job.lease_token, this.options.leaseMs, job.review_id, job.profile_id, PROFILE.id, job.source_version]);
    return mutationRows(rows).length === 1;
  }

  async source(job: ClaimedReviewJob): Promise<{ comment: string; search_version: string }> {
    const manager = this.db.manager;
    const [source] = await manager.query(`SELECT r.comment,r.search_version,j.review_id,j.profile_id,j.source_version,j.status,j.lease_token,
      j.lease_expires_at > clock_timestamp() AS leased FROM ${searchTable(manager, 'reviews')} r
      LEFT JOIN ${searchTable(manager, 'search_index_jobs')} j ON j.id=$2 WHERE r.id=$1`, [job.review_id, job.id]);
    if (!source) throw new SearchError('SOURCE_DELETED');
    if (source.status !== 'running' || source.lease_token !== job.lease_token || !source.leased || !sameClaim(source, job)) throw new SearchError('LEASE_LOST');
    if (source.search_version !== job.source_version) throw new SearchError('SOURCE_CHANGED');
    return source;
  }

  /** Reuse is checked and committed under the same source -> job locks as a fresh result. */
  async complete(job: ClaimedReviewJob, document: SearchDocument, vectors?: number[][]): Promise<boolean> {
    return this.db.transaction(async manager => {
      if (!(await this.lockCurrent(manager, job))) return false;
      const chunks = searchTable(manager, 'review_search_chunks');
      const jobs = searchTable(manager, 'search_index_jobs');
      if (vectors === undefined && document.chunks.length) {
        const [previous] = await manager.query(`SELECT source_version,content_hash,chunk_count FROM ${jobs}
          WHERE review_id=$1 AND profile_id=$2 AND status='done' ORDER BY source_version DESC LIMIT 1`, [job.review_id, PROFILE.id]);
        const stored = await manager.query(`SELECT source_version,chunk_index,text,content_hash,vector_norm(embedding)>0 AS valid_embedding FROM ${chunks}
          WHERE review_id=$1 AND profile_id=$2 ORDER BY chunk_index`, [job.review_id, PROFILE.id]);
        if (!previous || previous.content_hash !== document.contentHash || previous.chunk_count !== document.chunks.length ||
          stored.length !== document.chunks.length || stored.some((chunk: { source_version: string; chunk_index: number; text: string; content_hash: string; valid_embedding: boolean }, index: number) =>
            !chunk.valid_embedding || chunk.source_version !== previous.source_version || chunk.chunk_index !== index || chunk.text !== document.chunks[index].text || chunk.content_hash !== document.contentHash)) return false;
        await manager.query(`UPDATE ${chunks} SET source_version=$3 WHERE review_id=$1 AND profile_id=$2`, [job.review_id, PROFILE.id, job.source_version]);
      } else {
        if (vectors !== undefined) {
          if (!Array.isArray(vectors) || vectors.length !== document.chunks.length) throw new SearchError('INVALID_EMBEDDING');
          for (const vector of vectors) assertSearchVector(vector);
        }
        await manager.query(`DELETE FROM ${chunks} WHERE review_id=$1 AND profile_id=$2`, [job.review_id, PROFILE.id]);
        for (const [index, chunk] of document.chunks.entries()) {
          await manager.query(`INSERT INTO ${chunks} (review_id,profile_id,source_version,chunk_index,text,content_hash,embedding)
            VALUES ($1,$2,$3,$4,$5,$6,$7::vector)`, [job.review_id, PROFILE.id, job.source_version, index, chunk.text, document.contentHash, JSON.stringify(vectors?.[index])]);
        }
      }
      const completed = await manager.query(`UPDATE ${jobs} SET status='done',content_hash=$2,chunk_count=$3,completed_at=clock_timestamp(),
        lease_token=NULL,lease_expires_at=NULL,error_code=NULL WHERE id=$1 AND lease_token=$4 AND lease_expires_at > clock_timestamp() RETURNING id`,
      [job.id, document.contentHash, document.chunks.length, job.lease_token]);
      if (mutationRows(completed).length !== 1) throw new SearchError('LEASE_LOST');
      return true;
    });
  }

  async fail(job: ClaimedReviewJob, error: SearchError): Promise<void> {
    await this.db.transaction(async manager => {
      if (!(await this.lockCurrent(manager, job))) return;
      const retry = error.retryable && job.attempts < this.options.maxAttempts;
      const delay = Math.max(error.retryAfterMs ?? 0, Math.min(60000, 1000 * 2 ** (job.attempts - 1)) * (0.5 + Math.random()));
      await manager.query(`UPDATE ${searchTable(manager, 'search_index_jobs')} SET status=$2::varchar,error_code=$3,
        next_run_at=clock_timestamp()+$4 * interval '1 millisecond',completed_at=CASE WHEN $2::varchar='failed' THEN clock_timestamp() ELSE NULL END,
        lease_token=NULL,lease_expires_at=NULL WHERE id=$1 AND lease_token=$5 AND lease_expires_at > clock_timestamp()`,
      [job.id, retry ? 'pending' : 'failed', error.code, delay, job.lease_token]);
    });
  }

  async discard(job: ClaimedReviewJob): Promise<void> {
    await this.db.transaction(async manager => { await this.lockCurrent(manager, job); });
  }

  // 임베딩은 트랜잭션 밖에서 기다린다(요청 제한 15초). 그 사이 원본이 수정됐거나(search_version 증가)
  // 점유가 만료돼 다른 처리기가 같은 작업을 다시 잡았으면, 손에 든 벡터는 옛 본문·남의 작업 결과다.
  // 그래서 저장·실패 기록 직전에 원본 → 작업 순서로 잠그고 버전·점유 토큰·만료를 다시 본다(버전이 다르면 superseded).
  // 이 검사가 없으면 늦게 도착한 옛 결과가 저장돼 원본과 색인이 어긋난다.
  // 근거: docs/roadmap/ex-ai-vector-search.md §5-2 · review-index.integration.spec.ts "discards the late old result"
  private async lockCurrent(manager: EntityManager, job: ClaimedReviewJob): Promise<boolean> {
    const [source] = await manager.query(`SELECT search_version FROM ${searchTable(manager, 'reviews')} WHERE id=$1 FOR UPDATE`, [job.review_id]);
    if (!source) return false;
    const [current] = await manager.query(`SELECT *,lease_expires_at > clock_timestamp() AS leased
      FROM ${searchTable(manager, 'search_index_jobs')} WHERE id=$1 FOR UPDATE`, [job.id]);
    if (!current || current.status !== 'running' || current.lease_token !== job.lease_token || !current.leased || !sameClaim(current, job)) return false;
    if (source.search_version !== job.source_version) {
      await manager.query(`UPDATE ${searchTable(manager, 'search_index_jobs')} SET status='superseded',completed_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL WHERE id=$1`, [job.id]);
      return false;
    }
    return true;
  }
}

function sameClaim(current: Pick<ClaimedReviewJob, 'review_id' | 'profile_id' | 'source_version'>, job: ClaimedReviewJob): boolean {
  return current.review_id === job.review_id && current.profile_id === PROFILE.id && current.profile_id === job.profile_id && current.source_version === job.source_version;
}
