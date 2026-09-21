import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { REVIEW_VERDICTS, type OpsReviewVerdict } from '../entity/ops-review.entity';
import type { AiAnalysis } from './analysis.dto';

/**
 * POST /v1/ops/analyses/:id/review 의 body (설계 §5.1 Phase 4).
 * verdict 만 필수다 — 스와이프 한 번이 곧 평가이고, 별점·코멘트는 있으면 싣는다.
 */
export class CreateReviewDto {
  @IsIn(REVIEW_VERDICTS)
  verdict: OpsReviewVerdict;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

/**
 * GET /v1/ops/analyses/pending 의 항목 — 이 평가자가 아직 채점하지 않은, 구조화에 성공한 분석.
 *
 * ⚠ promptVersion 을 **일부러 싣지 않는다.** 평가는 블라인드다(Phase 4 결정 ①) — 평가자가 "이건 v2 니까"
 * 하고 후하게 줄 수 있는 정보는 카드에서 숨기는 게 아니라 응답에서 빼야 한다. 버전은 집계(stats)에서만 드러난다.
 */
export interface PendingReviewItem {
  analysisId: number;
  incidentId: string;
  /** 분석 시점에 저장한 제목. Phase 3 시절의 옛 행은 null — 앱은 incidentId 로 대신 그린다 */
  incidentTitle: string | null;
  exceptionText: string | null;
  result: AiAnalysis;
  model: string | null;
  /** ISO 8601 — 분석이 만들어진 시각 */
  createdAt: string;
}

export interface ReviewResponse {
  id: number;
  analysisId: number;
  reviewerId: number;
  verdict: OpsReviewVerdict;
  rating: number | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /v1/ops/analyses/stats — promptVersion 별 집계. Phase 4 DoD("v1 vs v2 승인율")의 숫자가 나오는 경로다.
 * `model = 'simulated'` 행은 제외한다(강제 실패 테스트 행은 통계가 아니다).
 */
export interface ReviewVersionStats {
  promptVersion: string;
  /** 이 버전으로 만든 분석 행 수(ok + parse_failed) */
  analyses: number;
  ok: number;
  parseFailed: number;
  /** 구조화 실패율 = parseFailed / analyses. analyses 가 0이면 null */
  parseFailedRate: number | null;
  /** 평가(행) 수 — 평가자가 여럿이면 분석 하나에 여러 건일 수 있다 */
  reviews: number;
  approved: number;
  rejected: number;
  /** approved / (approved + rejected). 평가가 없으면 null */
  approvalRate: number | null;
  /** 별점을 남긴 평가의 평균. 없으면 null */
  avgRating: number | null;
  /** 소스 읽기 도구를 실제로 1회 이상 호출한 분석 수(Phase 5). v1/v2 는 0 — "v3 중 도구를 실제로 쓴 비율"의 분자 */
  toolCalled: number;
}

export interface ReviewStats {
  versions: ReviewVersionStats[];
  /** ISO 8601 */
  generatedAt: string;
}

/** few-shot 예시 하나 — 프롬프트에 "입력 → 승인된 출력" 으로 들어간다 */
export interface FewShotExample {
  analysisId: number;
  incidentTitle: string | null;
  exceptionText: string | null;
  result: AiAnalysis;
}
