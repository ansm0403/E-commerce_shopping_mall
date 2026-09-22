import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  REVIEW_CHECK_KEYS,
  REVIEW_VERDICTS,
  type OpsReviewCheckKey,
  type OpsReviewChecks,
  type OpsReviewVerdict,
} from '../entity/ops-review.entity';
import type { AiAnalysis } from './analysis.dto';
import type { IncidentNoteView } from './note.dto';

/**
 * 확인 항목 4개의 카드 문구(설계 §9 Phase 7). 서버가 정의를 내려주는 이유: 문구를 고칠 때 앱을 다시 빌드하지 않고,
 * `checks` 의 키가 무슨 뜻인지가 응답 안에 같이 남는다. 초심자가 읽을 수 있게 쓴다 — 채점자가 그 사용자다.
 * `verdictRule` 은 앱이 승인/반려를 **제안**할 때 쓰는 항목(둘 중 하나라도 ✗ → 반려 제안). 평가자가 덮어쓸 수 있다.
 */
export interface ReviewChecklistItem {
  key: OpsReviewCheckKey;
  /** 카드에 보이는 질문. ✓ = 통과 */
  label: string;
  /** 어떻게 확인하나 — 메모의 어느 칸과 대조하는지 */
  howTo: string;
}

export const REVIEW_CHECKLIST: readonly ReviewChecklistItem[] = [
  {
    key: 'causeLocation',
    label: '① 원인으로 짚은 파일·함수가 메모의 "원인 위치"와 같은가?',
    howTo: '메모의 파일 이름·함수 이름을 답의 "원인"에서 찾는다. 파일은 맞는데 이유가 다르면(예: 다른 변수를 탓함) ✗',
  },
  {
    key: 'noInventedIdentifiers',
    label: '② 조치 코드의 이름(변수·함수·환경변수)이 모두 메모의 실제 코드에 있는가?',
    howTo: '조치 코드에 나오는 이름들을 메모의 코드 조각과 대조한다. 코드에 없는 이름이 하나라도 있으면 ✗ (예: CORS 에서 FRONTEND_URL — 실제는 CORS_ORIGINS)',
  },
  {
    key: 'applicableAsIs',
    label: '③ 조치를 그대로 붙여 넣어도 되는가?',
    howTo: '메모의 "정답 조치의 방향"과 같은 방향인가. 다른 곳을 깨거나 원인과 무관한 수정이면 ✗',
  },
  {
    key: 'confidenceFits',
    label: '④ 확신도가 근거에 비해 과하지 않은가?',
    howTo: '메모의 "흔한 오답"과 같은 답을 확신도 높음으로 말하면 ✗. 근거가 얇은데 높음이어도 ✗',
  },
];

/** 승인/반려 제안 규칙 — 이 키들 중 하나라도 false 면 반려 제안, 전부 true 면 승인 제안, 그 밖엔 제안 없음 */
export const REVIEW_VERDICT_RULE_KEYS: readonly OpsReviewCheckKey[] = ['causeLocation', 'noInventedIdentifiers'];

/** body.checks — 키 4개 각각 true|false|null(판단 못 함)·생략 가능. 모르는 키는 whitelist 로 떨어진다 */
export class ReviewChecksDto implements OpsReviewChecks {
  @IsOptional()
  @IsBoolean()
  causeLocation?: boolean | null;

  @IsOptional()
  @IsBoolean()
  noInventedIdentifiers?: boolean | null;

  @IsOptional()
  @IsBoolean()
  applicableAsIs?: boolean | null;

  @IsOptional()
  @IsBoolean()
  confidenceFits?: boolean | null;
}

/**
 * POST /v1/ops/analyses/:id/review 의 body (설계 §5.1 Phase 4 · Phase 7).
 * verdict 만 필수다 — 스와이프 한 번이 곧 평가이고, 별점·코멘트는 있으면 싣는다.
 * Phase 7: guided(안내와 함께 채점했는가, 기본 false) + checks(확인 항목 답). upsert 키에 guided 가 들어가므로
 * 같은 분석에 안내 전 판정과 안내 후 판정이 나란히 남는다.
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

  @IsOptional()
  @IsBoolean()
  guided?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReviewChecksDto)
  checks?: ReviewChecksDto;
}

/** checks 를 키 4개로 정돈한다(모르는 키 버림, 없는 키 null). 저장·응답 양쪽이 같은 꼴을 갖게 */
export function normalizeChecks(input: OpsReviewChecks | null | undefined): Record<OpsReviewCheckKey, boolean | null> {
  const out = {} as Record<OpsReviewCheckKey, boolean | null>;
  for (const key of REVIEW_CHECK_KEYS) {
    const v = input?.[key];
    out[key] = typeof v === 'boolean' ? v : null;
  }
  return out;
}

/**
 * 조치 코드 이름 대조 결과(Phase 8 A) — 확인 항목 ②의 **근거** 칩. 판정이 아니다(승인/반려 제안 규칙에 넣지 않는다).
 * 같은 인시던트의 두 팔은 같은 checkedFiles 를 받는다(인시던트 단위 합집합 — 블라인드).
 * 카드가 그리는 세 상태: unknown 있음 → "실제 코드에 없는 이름" · 없음 → "모두 실제 코드에 있음" · checkedCount 0 → "조치에 코드 이름 없음".
 * 항목 자체가 null 이면 대조할 파일을 하나도 읽지 못한 것("대조할 코드 없음").
 */
export interface IdentifierCheckView {
  /** 대조에 쓴 파일 — `frontend/src/hooks/useCategories.ts@7e3784f` 꼴 */
  checkedFiles: string[];
  /** 조치 코드에서 뽑아 대조한 이름 수(선언한 이름·예약어·내장 제외) */
  checkedCount: number;
  /** 대조 파일 어디에도 없는 이름 */
  unknown: string[];
  /** 없지만 `…Exception`·`…Module` 같은 프레임워크 클래스 꼴 — 라이브러리 이름일 수 있어 약하게 표시 */
  maybeLibrary: string[];
}

/**
 * GET /v1/ops/analyses/pending 의 항목 — 이 평가자가 아직 **안내와 함께** 채점하지 않은, 구조화에 성공한 분석.
 *
 * ⚠ promptVersion 을 **일부러 싣지 않는다.** 평가는 블라인드다(Phase 4 결정 ①) — 평가자가 "이건 v2 니까"
 * 하고 후하게 줄 수 있는 정보는 카드에서 숨기는 게 아니라 응답에서 빼야 한다. 버전은 집계(stats)에서만 드러난다.
 * Phase 7: `result.relatedFiles` 는 저장소 경로로 정규화해 내려준다(팔마다 꼴이 달라 버전이 새던 자리) · `note` 는
 * 인시던트의 사실 메모(없으면 null — 카드는 "메모 없음") · `checklist` 는 확인 항목 정의.
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
  note: IncidentNoteView | null;
  checklist: readonly ReviewChecklistItem[];
  /** Phase 8: 조치 코드 이름 대조. null = 대조할 파일을 읽지 못했다 */
  identifierCheck: IdentifierCheckView | null;
}

export interface ReviewResponse {
  id: number;
  analysisId: number;
  reviewerId: number;
  verdict: OpsReviewVerdict;
  rating: number | null;
  comment: string | null;
  guided: boolean;
  checks: Record<OpsReviewCheckKey, boolean | null> | null;
  createdAt: string;
  updatedAt: string;
}

/** 승인율·별점 묶음 — 전체 · 안내 전 · 안내 후 세 번 같은 꼴로 나온다 */
export interface ReviewRateStats {
  /** 평가(행) 수 — 평가자가 여럿이면 분석 하나에 여러 건일 수 있다 */
  reviews: number;
  approved: number;
  rejected: number;
  /** approved / (approved + rejected). 평가가 없으면 null */
  approvalRate: number | null;
  /** 별점을 남긴 평가의 평균. 없으면 null */
  avgRating: number | null;
}

/** 확인 항목 하나의 답 분포(안내 채점만) */
export interface ReviewCheckStats {
  pass: number;
  fail: number;
  /** null(판단 못 함) 또는 답 없음 */
  unknown: number;
}

/**
 * GET /v1/ops/analyses/stats — promptVersion 별 집계. Phase 4 DoD("v1 vs v2 승인율")의 숫자가 나오는 경로다.
 * `model = 'simulated'` 행은 제외한다(강제 실패 테스트 행은 통계가 아니다).
 * Phase 7: 상단의 reviews·approved·… 는 **전체**(안내 전+후) 그대로 두고, `unguided`·`guided` 로 나눠 다시 낸다.
 * `guided.withNote` 는 메모가 있는 인시던트의 안내 채점 수 — 메모 없는 카드의 채점은 참고 등급이라 따로 센다(인수인계 함정 4).
 */
export interface ReviewVersionStats extends ReviewRateStats {
  promptVersion: string;
  /** 이 버전으로 만든 분석 행 수(ok + parse_failed) */
  analyses: number;
  ok: number;
  parseFailed: number;
  /** 구조화 실패율 = parseFailed / analyses. analyses 가 0이면 null */
  parseFailedRate: number | null;
  /** 소스 읽기 도구를 실제로 1회 이상 호출한 분석 수(Phase 5). v1/v2 는 0 — "v3 중 도구를 실제로 쓴 비율"의 분자 */
  toolCalled: number;
  unguided: ReviewRateStats;
  guided: ReviewRateStats & {
    withNote: number;
    checks: Record<OpsReviewCheckKey, ReviewCheckStats>;
  };
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
