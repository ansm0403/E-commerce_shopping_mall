import { Check, Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type { SearchProfile } from '../search-profile';

@Entity('search_embedding_profiles')
@Check('"dimensions" = 768')
export class SearchEmbeddingProfileEntity {
  @PrimaryColumn({ type: 'varchar' }) id: string;
  @Column({ type: 'varchar' }) model: string;
  @Column({ type: 'integer' }) dimensions: number;
  @Column({ type: 'jsonb' }) settings: SearchProfile;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
