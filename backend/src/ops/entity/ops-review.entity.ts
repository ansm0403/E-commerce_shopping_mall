import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseModel } from '../../common/entity/base.entity';
import type { UserModel } from '../../user/entity/user.entity';
import type { OpsAnalysisEntity } from './ops-analysis.entity';

/** 사람의 판정 두 가지(설계 §5.3). 별점·코멘트는 판정에 딸린 보조 정보다 */
export const REVIEW_VERDICTS = ['approved', 'rejected'] as const;
export type OpsReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/**
 * 확인 항목 4개의 키(설계 §9 Phase 7). 카드의 체크박스 하나가 키 하나다. 값은 true(통과) · false(실패) · null(판단 못 함).
 *  ① causeLocation          원인으로 짚은 파일·함수가 메모의 "원인 위치"와 같은가
 *  ② noInventedIdentifiers  조치 코드의 이름(변수·함수·환경변수)이 모두 메모의 실제 코드에 있는가(지어낸 것 없음)
 *  ③ applicableAsIs         조치를 그대로 적용해도 되는가(메모의 조치 방향과 같은 방향)
 *  ④ confidenceFits         확신도가 근거에 비해 과하지 않은가
 * 승인/반려는 ①② 에서 파생 제안한다(둘 중 하나라도 false → 반려 제안). ③④ 는 별점에 반영하라고 안내만.
 */
export const REVIEW_CHECK_KEYS = ['causeLocation', 'noInventedIdentifiers', 'applicableAsIs', 'confidenceFits'] as const;
export type OpsReviewCheckKey = (typeof REVIEW_CHECK_KEYS)[number];
export type OpsReviewChecks = Partial<Record<OpsReviewCheckKey, boolean | null>>;

/**
 * AI 분석에 대한 사람의 평가 — 설계 §1.4 순환 고리의 ③(사람 평가)이자 ④(few-shot 재료)(설계 §5.3 `ops_reviews`).
 *
 * (analysisId, reviewerId, guided) 유니크: 한 사람이 한 분석에 남기는 판정은 **안내 없이 하나, 안내와 함께 하나**다.
 * 다시 평가하면 같은 guided 의 행을 **덮어쓴다**(upsert) — 스와이프 실수를 정정할 수 있어야 하고, 이 유니크 키가 그대로
 * upsert 키가 된다(Phase 4 결정 ⑤). Phase 7 에서 guided 가 키에 들어간 이유: Phase 6 의 14장을 안내와 함께 다시 채점할 때
 * 안내 전 판정을 **지우지 않고** 옆에 두어야 전/후를 비교할 수 있다(인수인계 함정 1).
 *
 * 분석 행(ops_analyses)이 지워지면 평가도 함께 지운다(CASCADE) — 대상 없는 판정은 집계를 오염시킬 뿐이다.
 * 평가자(users)가 지워질 때도 같다.
 */
@Entity('ops_reviews')
@Unique(['analysisId', 'reviewerId', 'guided'])
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

  // ── Phase 7 (채점 안내) ──

  /**
   * 카드에 사실 메모 + 확인 항목이 붙은 채로 채점했는가. 마이그레이션 이전의 행은 전부 false(안내 없는 채점).
   * 집계는 이 값으로 "안내 전/후"를 가른다 — Phase 7 DoD ② 의 축.
   */
  @Column({ type: 'boolean', default: false })
  guided: boolean;

  /**
   * 확인 항목 4개의 답 `{causeLocation, noInventedIdentifiers, applicableAsIs, confidenceFits}` — 각각 true|false|null.
   * guided=false 행은 null. jsonb 로 두는 이유는 tool_calls 와 같다 — 항목별 통과율을 SQL FILTER 로 바로 뽑는다.
   */
  @Column({ type: 'jsonb', nullable: true })
  checks: OpsReviewChecks | null;
}
