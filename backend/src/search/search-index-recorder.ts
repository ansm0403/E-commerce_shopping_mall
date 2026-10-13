import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { INITIAL_SEARCH_PROFILE as PROFILE } from './search-profile';
import { SearchError } from './search-error';
import { searchTable } from './search-sql';

/** Leaf dependency of source services/seed code. No LLM, source-service or admin imports. */
@Injectable()
export class SearchIndexRecorder {
  constructor(private readonly config: ConfigService) {}

  reviewsEnabled(): boolean { return this.config.get('AI_SEARCH_REVIEW_INDEX_ENABLED') === 'true'; }
  inquiriesEnabled(): boolean { return this.config.get('AI_SEARCH_INQUIRY_INDEX_ENABLED') === 'true'; }

  async assertProfile(manager: EntityManager): Promise<void> {
    if (this.config.get('AI_SEARCH_PROFILE_ID', PROFILE.id) !== PROFILE.id) throw new SearchError('PROFILE_MISMATCH');
    const [profile] = await manager.query(`SELECT model,dimensions,settings FROM ${searchTable(manager, 'search_embedding_profiles')} WHERE id=$1`, [PROFILE.id]);
    if (!profile || profile.model !== PROFILE.model || profile.dimensions !== PROFILE.dimensions ||
      Object.entries(PROFILE).some(([key, value]) => profile.settings?.[key] !== value)) throw new SearchError('PROFILE_MISMATCH');
  }

  /** Caller must use the same transaction as the source change and hold its source lock. */
  async recordReview(manager: EntityManager, reviewId: number, force = false): Promise<boolean> {
    if (!force && !this.reviewsEnabled()) return false;
    if (!manager.queryRunner?.isTransactionActive) throw new Error('SEARCH_JOB_REQUIRES_TRANSACTION');
    await this.assertProfile(manager);
    const rows = await manager.query(`INSERT INTO ${searchTable(manager, 'search_index_jobs')} (review_id,source_version,profile_id)
      SELECT id,search_version,$2 FROM ${searchTable(manager, 'reviews')} WHERE id=$1
      ON CONFLICT (review_id,source_version,profile_id) DO NOTHING RETURNING id`, [reviewId, PROFILE.id]);
    return rows.length > 0;
  }

  async advanceReview(manager: EntityManager, reviewId: number): Promise<void> {
    if (!this.reviewsEnabled()) return;
    await manager.query(`UPDATE ${searchTable(manager, 'reviews')} SET search_version=search_version+1 WHERE id=$1`, [reviewId]);
    await this.recordReview(manager, reviewId);
  }

  /** Secret sources never acquire an indexing job, including forced backfills. */
  async recordInquiry(manager: EntityManager, inquiryId: number, force = false): Promise<boolean> {
    if (!force && !this.inquiriesEnabled()) return false;
    if (!manager.queryRunner?.isTransactionActive) throw new Error('SEARCH_JOB_REQUIRES_TRANSACTION');
    await this.assertProfile(manager);
    const [source] = await manager.query(`SELECT is_secret FROM ${searchTable(manager, 'inquiries')} WHERE id=$1 FOR UPDATE`, [inquiryId]);
    if (!source) return false;
    if (source.is_secret) {
      await this.clearSecretInquiryEvidence(manager, inquiryId);
      return false;
    }
    const rows = await manager.query(`INSERT INTO ${searchTable(manager, 'search_index_jobs')} (inquiry_id,source_version,profile_id)
      SELECT id,search_version,$2 FROM ${searchTable(manager, 'inquiries')} WHERE id=$1 AND is_secret=false
      ON CONFLICT (inquiry_id,source_version,profile_id) DO NOTHING RETURNING id`, [inquiryId, PROFILE.id]);
    return rows.length > 0;
  }

  /** Keep a migrated source fresh and purge secret evidence even while indexing is disabled. */
  async advanceInquiry(manager: EntityManager, inquiryId: number): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) throw new Error('SEARCH_JOB_REQUIRES_TRANSACTION');
    if (!this.inquiriesEnabled()) {
      // A disabled feature must still permit writes on a DB without the optional foundation.
      // No exception recovery inside the transaction: a missing-table error would abort it.
      const [foundation] = await manager.query('SELECT to_regclass($1) IS NOT NULL AS available',
        [searchTable(manager, 'inquiry_search_chunks')]);
      if (!foundation?.available) return;
    }
    await manager.query(`UPDATE ${searchTable(manager, 'inquiries')} SET search_version=search_version+1 WHERE id=$1`, [inquiryId]);
    if (this.inquiriesEnabled()) await this.recordInquiry(manager, inquiryId);
    else await this.clearSecretInquiryEvidence(manager, inquiryId);
  }

  private async clearSecretInquiryEvidence(manager: EntityManager, inquiryId: number): Promise<void> {
    await manager.query(`DELETE FROM ${searchTable(manager, 'inquiry_search_chunks')} c USING ${searchTable(manager, 'inquiries')} i
      WHERE c.inquiry_id=i.id AND i.id=$1 AND i.is_secret=true`, [inquiryId]);
    await manager.query(`UPDATE ${searchTable(manager, 'search_index_jobs')} j SET status='superseded',lease_token=NULL,
      lease_expires_at=NULL,completed_at=now(),error_code='SOURCE_CHANGED' FROM ${searchTable(manager, 'inquiries')} i
      WHERE j.inquiry_id=i.id AND i.id=$1 AND i.is_secret=true AND j.status IN ('pending','running')`, [inquiryId]);
  }
}
