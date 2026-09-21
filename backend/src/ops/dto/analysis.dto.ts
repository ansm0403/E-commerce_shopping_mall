import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import type { OpsAnalysisStatus } from '../entity/ops-analysis.entity';

/** AI 가 지켜야 하는 응답 스키마(설계 §5.4). 앱의 구조화 카드가 이 다섯 필드를 그린다 */
export const ANALYSIS_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const ANALYSIS_CONFIDENCES = ['high', 'medium', 'low'] as const;

export type AnalysisSeverity = (typeof ANALYSIS_SEVERITIES)[number];
export type AnalysisConfidence = (typeof ANALYSIS_CONFIDENCES)[number];

export interface AiAnalysis {
  severity: AnalysisSeverity;
  /** 원인 요약(2~4문장) */
  rootCause: string;
  /** 구체적 조치. 코드 예시 포함 권장 — 앱은 모노스페이스로 그린다 */
  suggestedFix: string;
  /** 스택트레이스에서 추정한 파일들. 비어 있을 수 있다 */
  relatedFiles: string[];
  /** AI 스스로의 확신도 */
  confidence: AnalysisConfidence;
}

/**
 * POST /v1/ops/incidents/:id/analysis 의 body. 둘 다 선택이다.
 * - force: 최근 결과가 있어도 새로 분석한다(앱의 "다시 분석" 버튼). 없으면 최근 행을 그대로 준다
 * - simulate: 'parse_failed' 면 LLM 을 부르지 않고 구조화 실패 행을 만든다 — DoD 의 "강제 실패 테스트".
 *   운영(NODE_ENV=production)에서는 무시된다
 */
export class CreateAnalysisDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsIn(['parse_failed'])
  simulate?: 'parse_failed';
}

/** 응답. 캐시 적중 여부는 다른 ops 엔드포인트와 같이 X-Cache 헤더로 알린다 */
export interface AnalysisResponse {
  id: number;
  incidentId: string;
  status: OpsAnalysisStatus;
  /** status='ok' 일 때만. parse_failed 면 null 이고 앱은 rawText 로 fallback 을 그린다 */
  result: AiAnalysis | null;
  /** status='parse_failed' 일 때 모델 원문(마스킹·절단). ok 면 null */
  rawText: string | null;
  promptVersion: string;
  model: string | null;
  latencyMs: number;
  /** ISO 8601 */
  createdAt: string;
}

/** 스키마 검증 결과. 실패 사유(reason)는 재시도 프롬프트에 그대로 실어 모델이 무엇을 고쳐야 하는지 알게 한다 */
export type ParsedAnalysis = { ok: true; value: AiAnalysis } | { ok: false; reason: string };

/** 본문 필드 상한. 모델이 장황해져도 DB·앱 화면이 감당할 크기로 자른다 */
const MAX_TEXT = 4_000;
const MAX_FILES = 20;

/**
 * 모델 응답 텍스트 → AiAnalysis. AI 는 스키마를 어길 수 있으므로(설계 §3.4 "AI 응답 방어 처리")
 * 관대하게 읽고 엄격하게 검증한다:
 *  - 관대: 코드펜스(```json … ```)·JSON 앞뒤 잡담은 벗겨 낸다. severity/confidence 의 대소문자는 정규화한다.
 *    relatedFiles 는 없거나 형식이 틀리면 빈 배열로 본다(앱이 optional 로 그리는 필드).
 *  - 엄격: severity·confidence 가 허용값 밖이거나 rootCause·suggestedFix 가 비어 있으면 실패다.
 *    여기서 통과한 값만 status='ok' 로 저장되므로, 앱은 result 가 있으면 다섯 필드를 믿어도 된다.
 * eval 의 judge 응답 파서(backend/eval/run-judge.ts parseVerdict)와 같은 벗기기 순서다.
 */
export function parseAnalysis(text: string): ParsedAnalysis {
  let t = (text ?? '').trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(t);
  if (fence) t = fence[1].trim();
  if (!t.startsWith('{') || !t.endsWith('}')) {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s === -1 || e <= s) return { ok: false, reason: 'JSON 객체를 찾을 수 없다' };
    t = t.slice(s, e + 1);
  }

  // 여기서 t 는 항상 `{ … }` 꼴이라 JSON.parse 결과는 객체이거나 예외다.
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(t) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, reason: `JSON 파싱 실패: ${(e as Error).message}` };
  }

  const severity = normalizeEnum(obj.severity, ANALYSIS_SEVERITIES);
  if (!severity) return { ok: false, reason: `severity 는 ${ANALYSIS_SEVERITIES.join('|')} 중 하나여야 한다` };

  const confidence = normalizeEnum(obj.confidence, ANALYSIS_CONFIDENCES);
  if (!confidence) return { ok: false, reason: `confidence 는 ${ANALYSIS_CONFIDENCES.join('|')} 중 하나여야 한다` };

  const rootCause = nonEmptyText(obj.rootCause);
  if (!rootCause) return { ok: false, reason: 'rootCause 는 비어 있지 않은 문자열이어야 한다' };

  const suggestedFix = nonEmptyText(obj.suggestedFix);
  if (!suggestedFix) return { ok: false, reason: 'suggestedFix 는 비어 있지 않은 문자열이어야 한다' };

  const relatedFiles = Array.isArray(obj.relatedFiles)
    ? Array.from(
        new Set(
          obj.relatedFiles
            .filter((f): f is string => typeof f === 'string')
            .map((f) => f.trim())
            .filter((f) => f.length > 0 && f.length <= 300),
        ),
      ).slice(0, MAX_FILES)
    : [];

  return { ok: true, value: { severity, rootCause, suggestedFix, relatedFiles, confidence } };
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase() as T;
  return allowed.includes(v) ? v : null;
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v.slice(0, MAX_TEXT) : null;
}
