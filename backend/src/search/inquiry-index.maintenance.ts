import { InquiryIndexStore } from './inquiry-index.store';
import { inquiryDocument } from './search-document';
import { mutationRows, searchTable } from './search-sql';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';
import { SearchError } from './search-error';

export class InquiryIndexMaintenance {
  constructor(readonly store: InquiryIndexStore) {}

  /** ID cursor and bounded transactions; no API calls, including in seed processes. */
  async backfill(batchSize = 100): Promise<{ scanned: number; queued: number }> {
    assertBatchSize(batchSize);
    let cursor = 0;
    let scanned = 0;
    let queued = 0;
    const [{ upper }] = await this.store.db.manager.query(`SELECT COALESCE(max(id),0) AS upper FROM ${searchTable(this.store.db.manager, 'inquiries')}`);
    for (;;) {
      const page = await this.store.db.transaction(async manager => {
        const rows: { id: number }[] = await manager.query(`SELECT id FROM ${searchTable(manager, 'inquiries')}
          WHERE id>$1 AND id <= $3 AND is_secret=false ORDER BY id LIMIT $2 FOR UPDATE`, [cursor, batchSize, upper]);
        for (const row of rows) if (await this.store.recorder.recordInquiry(manager, row.id, true)) queued++;
        return rows;
      });
      if (!page.length) break;
      scanned += page.length;
      cursor = page[page.length - 1].id;
    }
    return { scanned, queued };
  }

  /** Hash reconciliation also repairs direct SQL edits which didn't advance the version. */
  async reconcile(batchSize = 100): Promise<{ scanned: number; queued: number; repaired: number; failed: number }> {
    assertBatchSize(batchSize);
    let cursor = 0;
    const result = { scanned: 0, queued: 0, repaired: 0, failed: 0 };
    const [{ upper }] = await this.store.db.manager.query(`SELECT COALESCE(max(id),0) AS upper FROM ${searchTable(this.store.db.manager, 'inquiries')}`);
    for (;;) {
      const page = await this.store.db.manager.query(`SELECT id FROM ${searchTable(this.store.db.manager, 'inquiries')} WHERE id>$1 AND id <= $3 ORDER BY id LIMIT $2`, [cursor, batchSize, upper]);
      if (!page.length) break;
      for (const { id } of page) {
        await this.store.db.transaction(async manager => {
          const [source] = await manager.query(`SELECT search_version,title,content,answer,is_secret AS "isSecret" FROM ${searchTable(manager, 'inquiries')} WHERE id=$1 FOR UPDATE`, [id]);
          if (!source) return;
          result.scanned++;
          if (source.isSecret) {
            // Never requeue secret data. Also repair legacy/direct SQL visibility changes.
            await this.store.recorder.recordInquiry(manager, id, true);
            return;
          }
          const [job] = await manager.query(`SELECT status,content_hash,chunk_count FROM ${searchTable(manager, 'search_index_jobs')}
            WHERE inquiry_id=$1 AND profile_id=$2 AND source_version=$3`, [id, PROFILE.id, source.search_version]);
          if (job?.status === 'pending' || job?.status === 'running') return;
          if (job?.status === 'failed') { result.failed++; return; }
          let repair = job?.status === 'superseded';
          if (job?.status === 'done') {
            try {
              const document = inquiryDocument(source);
              if (!document) return;
              const chunks = await manager.query(`SELECT chunk_index,text,source_version,content_hash,vector_norm(embedding)>0 AS valid_embedding FROM ${searchTable(manager, 'inquiry_search_chunks')}
                WHERE inquiry_id=$1 AND profile_id=$2 ORDER BY chunk_index`, [id, PROFILE.id]);
              repair = job.content_hash !== document.contentHash || job.chunk_count !== document.chunks.length || chunks.length !== document.chunks.length ||
                chunks.some((chunk: { chunk_index: number; text: string; source_version: string; content_hash: string; valid_embedding: boolean }, index: number) =>
                  !chunk.valid_embedding || chunk.chunk_index !== index || chunk.text !== document.chunks[index].text || chunk.source_version !== source.search_version || chunk.content_hash !== document.contentHash);
            } catch (error) {
              if (!(error instanceof SearchError) || error.code !== 'SOURCE_TOO_LARGE') throw error;
              repair = true;
            }
          }
          if (repair) {
            await manager.query(`UPDATE ${searchTable(manager, 'inquiries')} SET search_version=search_version+1 WHERE id=$1`, [id]);
            result.repaired++;
          }
          if ((!job || repair) && await this.store.recorder.recordInquiry(manager, id, true)) result.queued++;
        });
      }
      cursor = page[page.length - 1].id;
    }
    return result;
  }

  async retryFailed(inquiryId?: number): Promise<number> {
    if (inquiryId !== undefined && (!Number.isInteger(inquiryId) || inquiryId < 1 || inquiryId > 2147483647)) throw new SearchError('INVALID_INPUT');
    return this.store.db.transaction(async manager => {
      // Source -> job lock order, matching normal source updates and result commits.
      const rows = await manager.query(`SELECT id FROM ${searchTable(manager, 'inquiries')} WHERE is_secret=false AND ($1::int IS NULL OR id=$1) ORDER BY id FOR UPDATE`, [inquiryId ?? null]);
      let count = 0;
      for (const row of rows) {
        const retried = await manager.query(`UPDATE ${searchTable(manager, 'search_index_jobs')} j SET status='pending',attempts=0,
          next_run_at=clock_timestamp(),completed_at=NULL,error_code=NULL,lease_token=NULL,lease_expires_at=NULL
          FROM ${searchTable(manager, 'inquiries')} r WHERE j.inquiry_id=r.id AND r.id=$1 AND j.source_version=r.search_version
            AND j.profile_id=$2 AND j.status='failed' RETURNING j.id`, [row.id, PROFILE.id]);
        count += mutationRows(retried).length;
      }
      return count;
    });
  }

  async cleanup(): Promise<number> {
    const manager = this.store.db.manager;
    const rows = await manager.query(`DELETE FROM ${searchTable(manager, 'search_index_jobs')} j USING ${searchTable(manager, 'inquiries')} r
      WHERE j.inquiry_id=r.id AND j.source_version<>r.search_version AND j.status IN ('done','failed','superseded')
        AND COALESCE(j.completed_at,j.created_at) < clock_timestamp()-interval '14 days' RETURNING j.id`);
    return mutationRows(rows).length;
  }
}

function assertBatchSize(size: number): void {
  if (!Number.isInteger(size) || size < 1 || size > 1000) throw new SearchError('INVALID_INPUT');
}
