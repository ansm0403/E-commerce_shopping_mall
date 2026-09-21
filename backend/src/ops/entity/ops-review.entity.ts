import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseModel } from '../../common/entity/base.entity';
import type { UserModel } from '../../user/entity/user.entity';
import type { OpsAnalysisEntity } from './ops-analysis.entity';

/** 사람의 판정 두 가지(설계 §5.3). 별점·코멘트는 판정에 딸린 보조 정보다 */
export const REVIEW_VERDICTS = ['approved', 'rejected'] as const;
export type OpsReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/**
 * AI 분석에 대한 사람의 평가 — 설계 §1.4 순환 고리의 ③(사람 평가)이자 ④(few-shot 재료)(설계 §5.3 `ops_reviews`).
 *
 * (analysisId, reviewerId) 유니크: 한 사람이 한 분석에 남기는 판정은 하나다. 다시 평가하면 **덮어쓴다**(upsert) —
 * 스와이프 실수를 정정할 수 있어야 하고, 이 유니크 키가 그대로 upsert 키가 된다(Phase 4 결정 ⑤).
 *
 * 분석 행(ops_analyses)이 지워지면 평가도 함께 지운다(CASCADE) — 대상 없는 판정은 집계를 오염시킬 뿐이다.
 * 평가자(users)가 지워질 때도 같다.
 */
@Entity('ops_reviews')
@Unique(['analysisId', 'reviewerId'])
export class OpsReviewEntity extends BaseModel {
  @Column({ name: 'analysis_id' })
  @Index()
  analysisId: number;

  @ManyToOne('OpsAnalysisEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'analysis_id' })
  analysis: OpsAnalysisEntity;

  @Column({ name: 'reviewer_id' })
  @Index()
  reviewerId: number;

  @ManyToOne('UserModel', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reviewer_id' })
  reviewer: UserModel;

  @Column({ type: 'varchar', length: 10 })
  verdict: OpsReviewVerdict;

  /** 1~5. 스와이프만 하고 별점을 안 고르면 null — 판정과 별점은 독립이다 */
  @Column({ type: 'smallint', nullable: true })
  rating: number | null;

  /** 반려 사유 등. 앱 v1 UI 는 아직 입력칸이 없고 API 만 받는다 */
  @Column({ type: 'text', nullable: true })
  comment: string | null;
}
