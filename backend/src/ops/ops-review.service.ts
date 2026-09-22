import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpsAnalysisEntity } from './entity/ops-analysis.entity';
import { OpsReviewEntity, REVIEW_CHECK_KEYS, type OpsReviewCheckKey } from './entity/ops-review.entity';
import type { OpsIncidentNoteEntity } from './entity/ops-incident-note.entity';
import { SourceReaderService } from './source-reader.service';
import type { AiAnalysis } from './dto/analysis.dto';
import { toNoteView } from './dto/note.dto';
import {
  CreateReviewDto,
  FewShotExample,
  PendingReviewItem,
  REVIEW_CHECKLIST,
  ReviewCheckStats,
  ReviewRateStats,
  ReviewResponse,
  ReviewStats,
  ReviewVersionStats,
  normalizeChecks,
} from './dto/review.dto';

/**
 * 평가 루프(설계 §1.4 ③④ · §9 Phase 4 · Phase 7) — 사람의 판정을 저장하고, 그 판정으로 다음 프롬프트의 예시를 고른다.
 *
 *   앱 S5  GET  /ops/analyses/pending      → listPending   : 이 평가자의 **안내 채점**이 없는 ok 분석(블라인드 — 버전 없음) + 사실 메모
 *   앱 S5  POST /ops/analyses/:id/review   → submitReview  : verdict·rating·comment(+guided·checks) upsert
 *   집계   GET  /ops/analyses/stats        → getStats      : promptVersion 별 승인율 — 전체 · 안내 전 · 안내 후 (DoD 의 숫자)
 *   파이프라인 OpsAnalysisService.generate → selectFewShot : 승인된 분석 상위 N개 (대상 인시던트 자신은 제외)
 *
 * 목록·집계·예시 선정은 SQL 로 직접 쓴다. NOT EXISTS · FILTER · GROUP BY 가 얽힌 질의를 QueryBuilder 로 옮기면
 * 읽기만 어려워지고, `result_json` 을 jsonb 로 둔 이유가 "집계를 SQL 로 바로 뽑기 위해서"였다(엔티티 주석).
 * 단위 테스트는 upsert 규칙·입력 검증·응답 변환을 고정하고, SQL 자체는 e2e(실 DB) 가 고정한다.
 *
 * `model = 'simulated'` 행(강제 실패 테스트)은 세 경로 모두에서 뺀다 — 통계도, 예시도, 평가 대상도 아니다.
 *
 * ⚠ selectFewShot 은 ops_incident_notes 를 읽지 않는다(LLM 입력 오염 금지 — 엔티티 주석). 단위 테스트가 SQL 문자열로 고정한다.
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
   * 이 평가자가 아직 **안내와 함께** 채점하지 않은, 구조화에 성공한 분석.
   *
   * Phase 7 에서 조건이 `NOT EXISTS(… r.guided = true)` 로 바뀌었다 — Phase 6 까지의 채점(guided=false)은 그대로 두고
   * 같은 분석을 안내와 함께 한 번 더 채점하기 위해서다(인수인계 함정 1). 옛 판정은 stats 의 unguided 열이 된다.
   * 그 순간 옛 채점 51건이 전부 대기로 돌아와 실기기에서 같은 인시던트가 열 번씩 나왔다(CORS 10행) → 규칙 둘을 더했다:
   *  - **같은 인시던트·같은 프롬프트 버전은 최신 분석 한 장만.** 재분석(force)으로 대체된 옛 행을 채점하는 것은 의미가 없다.
   *    prompt_version 은 여기서 비교에만 쓰이고 응답에는 여전히 없다(블라인드 유지).
   *  - **재채점은 메모가 있는 카드만.** 이 평가자의 판정이 이미 있는데 메모가 없으면 다시 묻지 않는다(그 판정이 그대로 선다).
   *    아직 판정이 없는 새 분석은 메모 유무와 무관하게 나온다 — 평가 탭의 원래 역할(순환 고리 ③)은 그대로다.
   *
   * 순서는 **메모 있는 카드 먼저**, 그 안에서 `md5(id:reviewerId)` — 평가자마다 고정된 **뒤섞기**다. 시간순이면 스크립트가
   * 만든 v1·v2 가 번갈아 나와 평가자가 패턴을 눈치챈다(블라인드 붕괴). 진짜 난수면 화면을 다시 당길 때마다 카드가 재배열된다.
   * 해시는 둘 다 피한다. 메모 우선은 팔을 드러내지 않는다(같은 인시던트의 두 팔이 같은 메모를 본다) — Phase 7 재채점 대상
   * 14장이 메모 없는 옛 카드 36장 뒤에 흩어지지 않게 하기 위해서다.
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
      project: string | null;
      note_id: number | null;
      note_project: string | null;
      symptom: string | null;
      cause_location: string | null;
      fix_direction: string | null;
      common_mistakes: string | null;
      code_path: string | null;
      code_ref: string | null;
      code_start_line: number | null;
      code_end_line: number | null;
      code_text: string | null;
      note_updated_at: Date | null;
    }> = await this.analyses.query(
      `SELECT a.id, a.incident_id, a.incident_title, a.exception_text, a.result_json, a.model, a."createdAt",
              COALESCE(a.project, n.project) AS project,
              n.id AS note_id, n.project AS note_project, n.symptom, n.cause_location, n.fix_direction, n.common_mistakes,
              n.code_path, n.code_ref, n.code_start_line, n.code_end_line, n.code_text, n."updatedAt" AS note_updated_at
         FROM ops_analyses a
         LEFT JOIN ops_incident_notes n ON n.incident_id = a.incident_id
        WHERE a.status = 'ok' AND a.result_json IS NOT NULL
          AND ${OpsReviewService.NOT_SIMULATED}
          AND NOT EXISTS (
                SELECT 1 FROM ops_reviews r WHERE r.analysis_id = a.id AND r.reviewer_id = $1 AND r.guided = true
              )
          AND a.id = (
                SELECT MAX(b.id) FROM ops_analyses b
                 WHERE b.incident_id = a.incident_id AND b.prompt_version = a.prompt_version
                   AND b.status = 'ok' AND (b.model IS NULL OR b.model <> 'simulated')
              )
          AND (n.id IS NOT NULL OR NOT EXISTS (
                SELECT 1 FROM ops_reviews r2 WHERE r2.analysis_id = a.id AND r2.reviewer_id = $1
              ))
        ORDER BY (n.id IS NULL), md5(a.id::text || ':' || $2)
        LIMIT $3`,
      [reviewerId, String(reviewerId), OpsReviewService.PENDING_LIMIT],
    );

    return rows.map((r) => ({
      analysisId: r.id,
      incidentId: r.incident_id,
      incidentTitle: r.incident_title,
      exceptionText: r.exception_text,
      result: OpsReviewService.blindResult(r.result_json, r.project),
      model: r.model,
      createdAt: OpsReviewService.iso(r.createdAt),
      note:
        r.note_id === null
          ? null
          : toNoteView({
              incidentId: r.incident_id,
              project: r.note_project,
              symptom: r.symptom ?? '',
              causeLocation: r.cause_location ?? '',
              fixDirection: r.fix_direction ?? '',
              commonMistakes: r.common_mistakes,
              codePath: r.code_path,
              codeRef: r.code_ref,
              codeStartLine: r.code_start_line,
              codeEndLine: r.code_end_line,
              codeText: r.code_text,
              updatedAt: r.note_updated_at ?? undefined,
            } as unknown as OpsIncidentNoteEntity),
      checklist: REVIEW_CHECKLIST,
    }));
  }

  /**
   * 카드용 결과 — relatedFiles 를 저장소 경로로 **정규화**한다(Phase 7, 인수인계 함정 2).
   * v3.1 은 도구가 읽은 경로(`frontend/src/hooks/…`)를, v1.1 은 프레임 문자열(`./src/hooks/…`)을 그대로 적어 꼴만 보고도
   * 팔이 드러났다. normalizeFramePath 로 둘을 같은 꼴로 만들고, 바꿀 수 없는 것은 앞의 `./` 만 떼어 둔다.
   * S4 분석 상세는 정규화하지 않는다(블라인드 대상이 아니다). DB 의 result_json 은 그대로다.
   */
  static blindResult(result: AiAnalysis, project: string | null): AiAnalysis {
    if (!result || typeof result !== 'object') return result;
    const files = Array.isArray(result.relatedFiles) ? result.relatedFiles : [];
    const seen = new Set<string>();
    const relatedFiles: string[] = [];
    for (const f of files) {
      if (typeof f !== 'string') continue;
      const normalized = SourceReaderService.normalizeFramePath(f, project) ?? f.replace(/^\.\//, '');
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      relatedFiles.push(normalized);
    }
    return { ...result, relatedFiles };
  }

  /**
   * 판정 저장. 같은 (analysis, reviewer, guided) 가 있으면 **통째로** 덮어쓴다(rating·comment·checks 도 이번 값으로 —
   * 안 보내면 null). "최신 판정이 곧 그 사람의 판정"이라는 뜻이다(Phase 4 결정 ⑤).
   * guided 가 다르면 다른 행이다 — 안내 전 판정은 안내 후 판정이 덮어쓰지 않는다(Phase 7).
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

    const guided = dto.guided === true;
    const existing = await this.reviews.findOne({ where: { analysisId, reviewerId, guided } });
    const row = existing ?? this.reviews.create({ analysisId, reviewerId, guided });
    const apply = (target: OpsReviewEntity) => {
      target.verdict = dto.verdict;
      target.rating = dto.rating ?? null;
      target.comment = dto.comment?.trim() || null;
      target.guided = guided;
      target.checks = dto.checks ? normalizeChecks(dto.checks) : null;
    };
    apply(row);

    let saved: OpsReviewEntity;
    try {
      saved = await this.reviews.save(row);
    } catch (e) {
      // 같은 평가자가 같은 카드를 거의 동시에 두 번 보낸 경우(재시도 겹침) — 유니크 위반이면 그 사이 생긴 행에 덮어쓴다.
      if ((e as { code?: string })?.code !== '23505') throw e;
      const raced = await this.reviews.findOne({ where: { analysisId, reviewerId, guided } });
      if (!raced) throw e;
      apply(raced);
      saved = await this.reviews.save(raced);
    }

    this.logger.log(
      `평가 ${existing ? '갱신' : '저장'}: analysis=${analysisId} reviewer=${reviewerId} verdict=${saved.verdict} rating=${saved.rating ?? '-'}${guided ? ' guided' : ''}`,
    );
    return { item: OpsReviewService.toResponse(saved), created: !existing };
  }

  /**
   * promptVersion 별 집계 — Phase 4 DoD 의 "v1 vs v2 승인율"이 이 숫자다.
   * 평가는 행 단위로 센다(평가자가 여럿이면 분석 하나에 여러 건). 승인율 분모는 approved + rejected.
   *
   * `minAnalysisId`(Phase 6): 이 id 이상인 분석만 센다. 같은 버전 이름표(v1.1·v3.1)가 Phase 5 의 CORS 재현·부작용 측정에도
   * 쓰였으므로, 새 평가 세트만 보려면 세트의 첫 분석 id 로 자른다(스크립트 `stats --after`). 없으면 전체(옛 동작).
   *
   * Phase 7: 같은 FILTER 를 guided 로 한 번 더 나눈다(안내 전/후). 확인 항목은 `checks->>'키'` 를 boolean 으로 읽어
   * 통과/실패를 세고, 나머지(null·답 없음)는 unknown 이다. 메모 유무는 ops_incident_notes 를 LEFT JOIN 해서 본다
   * (incident_id 가 유니크라 행이 불어나지 않는다).
   */
  async getStats(filter: { minAnalysisId?: number } = {}): Promise<ReviewStats> {
    const params: unknown[] = [];
    let extraWhere = '';
    if (typeof filter.minAnalysisId === 'number' && Number.isFinite(filter.minAnalysisId)) {
      params.push(Math.floor(filter.minAnalysisId));
      extraWhere = ` AND a.id >= $${params.length}`;
    }
    // 키는 상수 배열(REVIEW_CHECK_KEYS)에서만 온다 — 사용자 입력이 SQL 에 들어가지 않는다.
    // ⚠ 별칭은 반드시 큰따옴표로 — Postgres 는 따옴표 없는 식별자를 소문자로 접어 `chk_causelocation_pass` 가 되고,
    //    아래 매핑이 camelCase 키로 읽어 전부 0(unknown)이 된다(e2e 로 잡힌 함정, 2026-09-22).
    const checkColumns = REVIEW_CHECK_KEYS.map(
      (k) =>
        `COUNT(r.id) FILTER (WHERE r.guided AND (r.checks->>'${k}')::boolean = true)::int  AS "chk_${k}_pass",
              COUNT(r.id) FILTER (WHERE r.guided AND (r.checks->>'${k}')::boolean = false)::int AS "chk_${k}_fail"`,
    ).join(',\n              ');

    const rows: Array<
      {
        prompt_version: string;
        analyses: number;
        ok: number;
        parse_failed: number;
        reviews: number;
        approved: number;
        rejected: number;
        avg_rating: number | null;
        tool_called: number;
        ug_reviews: number;
        ug_approved: number;
        ug_rejected: number;
        ug_avg_rating: number | null;
        g_reviews: number;
        g_approved: number;
        g_rejected: number;
        g_avg_rating: number | null;
        g_with_note: number;
      } & Record<string, unknown>
    > = await this.analyses.query(
      `SELECT a.prompt_version,
              COUNT(DISTINCT a.id)::int                                          AS analyses,
              COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'ok')::int           AS ok,
              COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'parse_failed')::int AS parse_failed,
              COUNT(r.id)::int                                                   AS reviews,
              COUNT(r.id) FILTER (WHERE r.verdict = 'approved')::int             AS approved,
              COUNT(r.id) FILTER (WHERE r.verdict = 'rejected')::int             AS rejected,
              AVG(r.rating)::float                                               AS avg_rating,
              COUNT(DISTINCT a.id) FILTER (WHERE jsonb_typeof(a.tool_calls) = 'array' AND jsonb_array_length(a.tool_calls) > 0)::int AS tool_called,
              COUNT(r.id) FILTER (WHERE NOT r.guided)::int                                 AS ug_reviews,
              COUNT(r.id) FILTER (WHERE NOT r.guided AND r.verdict = 'approved')::int      AS ug_approved,
              COUNT(r.id) FILTER (WHERE NOT r.guided AND r.verdict = 'rejected')::int      AS ug_rejected,
              (AVG(r.rating) FILTER (WHERE NOT r.guided))::float                           AS ug_avg_rating,
              COUNT(r.id) FILTER (WHERE r.guided)::int                                     AS g_reviews,
              COUNT(r.id) FILTER (WHERE r.guided AND r.verdict = 'approved')::int          AS g_approved,
              COUNT(r.id) FILTER (WHERE r.guided AND r.verdict = 'rejected')::int          AS g_rejected,
              (AVG(r.rating) FILTER (WHERE r.guided))::float                               AS g_avg_rating,
              COUNT(r.id) FILTER (WHERE r.guided AND n.id IS NOT NULL)::int                AS g_with_note,
              ${checkColumns}
         FROM ops_analyses a
         LEFT JOIN ops_reviews r ON r.analysis_id = a.id
         LEFT JOIN ops_incident_notes n ON n.incident_id = a.incident_id
        WHERE ${OpsReviewService.NOT_SIMULATED}${extraWhere}
        GROUP BY a.prompt_version
        ORDER BY a.prompt_version`,
      params,
    );

    const versions: ReviewVersionStats[] = rows.map((r) => {
      const guidedReviews = OpsReviewService.int(r.g_reviews);
      const checks = {} as Record<OpsReviewCheckKey, ReviewCheckStats>;
      for (const k of REVIEW_CHECK_KEYS) {
        const pass = OpsReviewService.int(r[`chk_${k}_pass`]);
        const fail = OpsReviewService.int(r[`chk_${k}_fail`]);
        checks[k] = { pass, fail, unknown: Math.max(0, guidedReviews - pass - fail) };
      }
      return {
        promptVersion: r.prompt_version,
        analyses: r.analyses,
        ok: r.ok,
        parseFailed: r.parse_failed,
        parseFailedRate: r.analyses > 0 ? OpsReviewService.round(r.parse_failed / r.analyses) : null,
        ...OpsReviewService.rate(r.reviews, r.approved, r.rejected, r.avg_rating),
        toolCalled: r.tool_called ?? 0,
        unguided: OpsReviewService.rate(r.ug_reviews, r.ug_approved, r.ug_rejected, r.ug_avg_rating),
        guided: {
          ...OpsReviewService.rate(r.g_reviews, r.g_approved, r.g_rejected, r.g_avg_rating),
          withNote: OpsReviewService.int(r.g_with_note),
          checks,
        },
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
   * 안내 전/후 판정을 가리지 않는다 — 어느 쪽이든 사람이 승인한 분석이다. 메모(ops_incident_notes)는 읽지 않는다.
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
      guided: row.guided === true,
      checks: row.checks ? normalizeChecks(row.checks) : null,
      createdAt: OpsReviewService.iso(row.createdAt),
      updatedAt: OpsReviewService.iso(row.updatedAt),
    };
  }

  private static rate(reviews: unknown, approved: unknown, rejected: unknown, avg: unknown): ReviewRateStats {
    const a = OpsReviewService.int(approved);
    const rj = OpsReviewService.int(rejected);
    const judged = a + rj;
    return {
      reviews: OpsReviewService.int(reviews),
      approved: a,
      rejected: rj,
      approvalRate: judged > 0 ? OpsReviewService.round(a / judged) : null,
      avgRating: typeof avg === 'number' && Number.isFinite(avg) ? OpsReviewService.round(avg) : null,
    };
  }

  private static int(v: unknown): number {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  }

  private static iso(d: Date | string | undefined): string {
    if (d instanceof Date) return d.toISOString();
    return d ? String(d) : new Date(0).toISOString();
  }

  private static round(n: number): number {
    return Math.round(n * 1000) / 1000;
  }
}
