import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { InquiryEntity } from '../../inquiry/entity/inquiry.entity';
import { SearchEmbeddingProfileEntity } from './search-embedding-profile.entity';

@Entity('inquiry_search_chunks')
@Unique('inquiry_search_chunks_source_profile_chunk', ['inquiryId', 'profileId', 'chunkIndex'])
@Check('"source_version" > 0')
@Check('"chunk_index" BETWEEN 0 AND 31')
export class InquirySearchChunkEntity {
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'BY DEFAULT' }) id: string;
  @Column({ name: 'inquiry_id', type: 'integer' }) inquiryId: number;
  @ManyToOne('InquiryEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inquiry_id' }) inquiry: InquiryEntity;
  @Column({ name: 'profile_id', type: 'varchar' }) profileId: string;
  @ManyToOne(() => SearchEmbeddingProfileEntity)
  @JoinColumn({ name: 'profile_id' }) profile: SearchEmbeddingProfileEntity;
  @Column({ name: 'source_version', type: 'bigint' }) sourceVersion: string;
  @Column({ name: 'chunk_index', type: 'integer' }) chunkIndex: number;
  @Column({ type: 'text' }) text: string;
  @Column({ name: 'content_hash', type: 'varchar', length: 64 }) contentHash: string;
  @Column({ type: 'vector', length: 768 }) embedding: number[];
}
