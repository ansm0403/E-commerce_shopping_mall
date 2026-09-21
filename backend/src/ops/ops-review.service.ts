import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpsAnalysisEntity } from './entity/ops-analysis.entity';
import { OpsReviewEntity } from './entity/ops-review.entity';
import type { AiAnalysis } from './dto/analysis.dto';
import {
  CreateReviewDto,
  FewShotExample,
  PendingReviewItem,
  ReviewResponse,
  ReviewStats,
  ReviewVersionStats,
} from './dto/review.dto';

/**
 * 평가 루프(설계 §1.4 ③④ · §9 Phase 4) — 사람의 판정을 저장하고, 그 판정으로 다음 프롬프트의 예시를 고른다.
 *
 *   앱 S5  GET  /ops/analyses/pending      → listPending   : 이 평가자가 아직 채점하지 않은 ok 분석(블라인드 — 버전 없음)
 *   앱 S5  POST /ops/analyses/:id/review   → submitReview  : verdict·rating·comment upsert
 *   집계   GET  /ops/analyses/stats        → getStats      : promptVersion 별 승인율 (DoD 의 숫자)
 *   파이프라인 OpsAnalysisService.generate → selectFewShot : 승인된 분석 상위 N개 (대상 인시던트 자신은 제외)
 *
 * 목록·집계·예시 선정은 SQL 로 직접 쓴다. NOT EXISTS · FILTER · GROUP BY 가 얽힌 질의를 QueryBuilder 로 옮기면
 * 읽기만 어려워지고, `result_json` 을 jsonb 로 둔 이유가 "집계를 SQL 로 바로 뽑기 위해서"였다(엔티티 주석).
 * 단위 테스트는 upsert 규칙·입력 검증·응답 변환을 고정하고, SQL 자체는 e2e(실 DB) 가 고정한다.
 *
 * `model = 'simulated'` 행(강제 실패 테스트)은 세 경로 모두에서 뺀다 — 통계도, 예시도, 평가 대상도 아니다.
 */
@Injectable()
export class OpsReviewService {
  private readonly logger = new Logger(OpsReviewService.name);

  /** few-shot 예시 수(Phase 4 결정 ④). 3개면 입력 토큰이 약 1.5배 */
  static readonly FEW_SHOT_N = 3;
  /** 한 번에 내려주는 평가 대기 상한. 스와이프 화면이 한 자리에서 소화할 만큼 */
  static readonly PENDING_LIMIT = 50;

  /** 평가 대상·예시·집계 공통 — 시뮬레이션 행 제외 */
  private static readonly NOT_SIMULATED = `(a.model IS NULL OR a.model <> 'simulated')`;

  constructor(
    @InjectRepository(OpsReviewEntity)
    private readonly reviews: Repository<OpsReviewEntity>,
    @InjectRepository(OpsAnalysisEntity)
    private readonly analyses: Repository<OpsAnalysisEntity>,
  ) {}

  /**
   * 이 평가자가 아직 채점하지 않은, 구조화에 성공한 분석.
   *
   * 순서는 `md5(id:reviewerId)` — 평가자마다 고정된 **뒤섞기**다. 시간순이면 스크립트가 만든 v1·v2 가
   * 번갈아 나와 평가자가 패턴을 눈치챈다(블라인드 붕괴). 진짜 난수면 화면을 다시 당길 때마다 카드가 재배열된다.
   * 해시는 둘 다 피한다.
   */
  async listPending(reviewerId: number): Promise<PendingReviewItem[]> {
    const rows: Array<{
      id: number;
      incident_id: string;
      incident_title: string | null;
      exception_text: string | null;
      result_json: AiAnalysis;
      model: string | null;
      createdAt: Date;
    }> = await this.analyses.query(
      `SELECT a.id, a.incident_id, a.incident_title, a.exception_text, a.result_json, a.model, a."createdAt"
         FROM ops_analyses a
        WHERE a.status = 'ok' AND a.result_json IS NOT NULL
          AND ${OpsReviewService.NOT_SIMULATED}
          AND NOT EXISTS (
                SELECT 1 FROM ops_reviews r WHERE r.analysis_id = a.id AND r.reviewer_id = $1
              )
        ORDER BY md5(a.id::text || ':' || $2)
        LIMIT $3`,
      [reviewerId, String(reviewerId), OpsReviewService.PENDING_LIMIT],
    );

    return rows.map((r) => ({
      analysisId: r.id,
      incidentId: r.incident_id,
      incidentTitle: r.incident_title,
      exceptionText: r.exception_text,
      result: r.result_json,
      model: r.model,
      createdAt: OpsReviewService.iso(r.createdAt),
    }));
  }

  /**
   * 판정 저장. 같은 (analysis, reviewer) 가 있으면 **통째로** 덮어쓴다(rating·comment 도 이번 값으로 —
   * 안 보내면 null). "최신 판정이 곧 그 사람의 판정"이라는 뜻이다(Phase 4 결정 ⑤).
   *
   * 평가 대상은 status=ok · 비시뮬레이션 행뿐이다. parse_failed 는 카드가 없으니 판정할 내용이 없고,
   * 구조화 실패 자체는 stats 의 parseFailedRate 로 따로 센다.
   */
  async submitReview(
    reviewerId: number,
    analysisId: number,
    dto: CreateReviewDto,
  ): Promise<{ item: ReviewResponse; created: boolean }> {
    const analysis = await this.analyses.findOne({ where: { id: analysisId } });
    if (!analysis) throw new NotFoundException('분석을 찾을 수 없습니다.');
    if (analysis.status !== 'ok' || analysis.model === 'simulated') {
      throw new BadRequestException('구조화에 실패했거나 시뮬레이션으로 만든 분석은 평가 대상이 아닙니다.');
    }

    const existing = await this.reviews.findOne({ where: { analysisId, reviewerId } });
    const row = existing ?? this.reviews.create({ analysisId, reviewerId });
    row.verdict = dto.verdict;
    row.rating = dto.rating ?? null;
    row.comment = dto.comment?.trim() || null;

    let saved: OpsReviewEntity;
    try {
      saved = await this.reviews.save(row);
    } catch (e) {
      // 같은 평가자가 같은 카드를 거의 동시에 두 번 보낸 경우(재시도 겹침) — 유니크 위반이면 그 사이 생긴 행에 덮어쓴다.
      if ((e as { code?: string })?.code !== '23505') throw e;
      const raced = await this.reviews.findOne({ where: { analysisId, reviewerId } });
      if (!raced) throw e;
      raced.verdict = row.verdict;
      raced.rating = row.rating;
      raced.comment = row.comment;
      saved = await this.reviews.save(raced);
    }

    this.logger.log(
      `평가 ${existing ? '갱신' : '저장'}: analysis=${analysisId} reviewer=${reviewerId} verdict=${saved.verdict} rating=${saved.rating ?? '-'}`,
    );
    return { item: OpsReviewService.toResponse(saved), created: !existing };
  }

  /**
   * promptVersion 별 집계 — Phase 4 DoD 의 "v1 vs v2 승인율"이 이 숫자다.
   * 평가는 행 단위로 센다(평가자가 여럿이면 분석 하나에 여러 건). 승인율 분모는 approved + rejected.
   */
  async getStats(): Promise<ReviewStats> {
    const rows: Array<{
      prompt_version: string;
      analyses: number;
      ok: number;
      parse_failed: number;
      reviews: number;
      approved: number;
      rejected: number;
      avg_rating: number | null;
      tool_called: number;
    }> = await this.analyses.query(
      `SELECT a.prompt_version,
              COUNT(DISTINCT a.id)::int                                          AS analyses,
              COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'ok')::int           AS ok,
              COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'parse_failed')::int AS parse_failed,
              COUNT(r.id)::int                                                   AS reviews,
              COUNT(r.id) FILTER (WHERE r.verdict = 'approved')::int             AS approved,
              COUNT(r.id) FILTER (WHERE r.verdict = 'rejected')::int             AS rejected,
              AVG(r.rating)::float                                               AS avg_rating,
              COUNT(DISTINCT a.id) FILTER (WHERE jsonb_typeof(a.tool_calls) = 'array' AND jsonb_array_length(a.tool_calls) > 0)::int AS tool_called
         FROM ops_analyses a
         LEFT JOIN ops_reviews r ON r.analysis_id = a.id
        WHERE ${OpsReviewService.NOT_SIMULATED}
        GROUP BY a.prompt_version
        ORDER BY a.prompt_version`,
    );

    const versions: ReviewVersionStats[] = rows.map((r) => {
      const judged = r.approved + r.rejected;
      return {
        promptVersion: r.prompt_version,
        analyses: r.analyses,
        ok: r.ok,
        parseFailed: r.parse_failed,
        parseFailedRate: r.analyses > 0 ? OpsReviewService.round(r.parse_failed / r.analyses) : null,
        reviews: r.reviews,
        approved: r.approved,
        rejected: r.rejected,
        approvalRate: judged > 0 ? OpsReviewService.round(r.approved / judged) : null,
        avgRating: r.avg_rating === null ? null : OpsReviewService.round(r.avg_rating),
        toolCalled: r.tool_called ?? 0,
      };
    });
    return { versions, generatedAt: new Date().toISOString() };
  }

  /**
   * few-shot 예시 — 승인된 ok 분석을 **별점 높은 순 → 최근 승인 순**으로 n개(Phase 4 결정 ④).
   *
   * `excludeIncidentId`: 지금 분석하려는 인시던트 자신의 과거 분석은 뺀다. 넣으면 정답을 보여주고 시험 보는 셈이라
   * v2 가 좋아 보여도 few-shot 효과인지 베끼기인지 가릴 수 없다.
   * 평가자가 여럿이면 같은 분석에 승인이 여러 건일 수 있어 분석 id 로 묶는다(GROUP BY a.id — PK 라 다른 열을 그대로 고를 수 있다).
   */
  async selectFewShot(excludeIncidentId: string, n = OpsReviewService.FEW_SHOT_N): Promise<FewShotExample[]> {
    if (n <= 0) return [];
    const rows: Array<{
      id: number;
      incident_title: string | null;
      exception_text: string | null;
      result_json: AiAnalysis;
    }> = await this.analyses.query(
      `SELECT a.id, a.incident_title, a.exception_text, a.result_json
         FROM ops_reviews r
         JOIN ops_analyses a ON a.id = r.analysis_id
        WHERE r.verdict = 'approved'
          AND a.status = 'ok' AND a.result_json IS NOT NULL
          AND ${OpsReviewService.NOT_SIMULATED}
          AND a.incident_id <> $1
        GROUP BY a.id
        ORDER BY MAX(r.rating) DESC NULLS LAST, MAX(r."createdAt") DESC
        LIMIT $2`,
      [excludeIncidentId, n],
    );
    return rows.map((r) => ({
      analysisId: r.id,
      incidentTitle: r.incident_title,
      exceptionText: r.exception_text,
      result: r.result_json,
    }));
  }

  static toResponse(row: OpsReviewEntity): ReviewResponse {
    return {
      id: row.id,
      analysisId: row.analysisId,
      reviewerId: row.reviewerId,
      verdict: row.verdict,
      rating: row.rating ?? null,
      comment: row.comment ?? null,
      createdAt: OpsReviewService.iso(row.createdAt),
      updatedAt: OpsReviewService.iso(row.updatedAt),
    };
  }

  private static iso(d: Date | string | undefined): string {
    if (d instanceof Date) return d.toISOString();
    return d ? String(d) : new Date(0).toISOString();
  }

  private static round(n: number): number {
    return Math.round(n * 1000) / 1000;
  }
}
