import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { ReviewEntity } from '../../review/entity/review.entity';
import type { InquiryEntity } from '../../inquiry/entity/inquiry.entity';
import { SearchEmbeddingProfileEntity } from './search-embedding-profile.entity';

export type SearchJobStatus = 'pending' | 'running' | 'done' | 'superseded' | 'failed';

@Entity('search_index_jobs')
@Unique('search_index_jobs_review_version', ['reviewId', 'sourceVersion', 'profileId'])
@Unique('search_index_jobs_inquiry_version', ['inquiryId', 'sourceVersion', 'profileId'])
@Check('("review_id" IS NULL) <> ("inquiry_id" IS NULL)')
@Check('"source_version" > 0')
@Check('"attempts" >= 0')
@Check('"chunk_count" BETWEEN 0 AND 32')
@Check("\"status\" IN ('pending','running','done','superseded','failed')")
@Check("\"status\" <> 'running' OR (\"lease_token\" IS NOT NULL AND \"lease_expires_at\" IS NOT NULL)")
@Check("\"status\" <> 'done' OR (\"content_hash\" IS NOT NULL AND \"chunk_count\" IS NOT NULL AND \"completed_at\" IS NOT NULL)")
@Index('search_index_jobs_pending', ['nextRunAt', 'id'], { where: "status='pending'" })
@Index('search_index_jobs_expired', ['leaseExpiresAt', 'id'], { where: "status='running'" })
@Index('search_index_jobs_review_coverage', ['reviewId', 'profileId', 'sourceVersion', 'status'])
@Index('search_index_jobs_inquiry_coverage', ['inquiryId', 'profileId', 'sourceVersion', 'status'])
export class SearchIndexJobEntity {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'BY DEFAULT' }) id: string;
  @Column({ name: 'review_id', type: 'integer', nullable: true }) reviewId: number | null;
  @ManyToOne('ReviewEntity', { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'review_id' }) review: ReviewEntity | null;
  @Column({ name: 'inquiry_id', type: 'integer', nullable: true }) inquiryId: number | null;
  @ManyToOne('InquiryEntity', { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'inquiry_id' }) inquiry: InquiryEntity | null;
  @Column({ name: 'profile_id', type: 'varchar' }) profileId: string;
  @ManyToOne(() => SearchEmbeddingProfileEntity)
  @JoinColumn({ name: 'profile_id' }) profile: SearchEmbeddingProfileEntity;
  @Column({ name: 'source_version', type: 'bigint' }) sourceVersion: string;
  @Column({ type: 'varchar', default: 'pending' }) status: SearchJobStatus;
  @Column({ type: 'integer', default: 0 }) attempts: number;
  @Column({ name: 'next_run_at', type: 'timestamptz', default: () => 'now()' }) nextRunAt: Date;
  @Column({ name: 'lease_token', type: 'uuid', nullable: true }) leaseToken: string | null;
  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true }) leaseExpiresAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true }) errorCode: string | null;
  @Column({ name: 'content_hash', type: 'varchar', length: 64, nullable: true }) contentHash: string | null;
  @Column({ name: 'chunk_count', type: 'integer', nullable: true }) chunkCount: number | null;
}
