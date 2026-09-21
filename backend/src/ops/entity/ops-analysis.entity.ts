import { Column, Entity, Index } from 'typeorm';
import { BaseModel } from '../../common/entity/base.entity';

/** 분석 결과의 두 상태(설계 §5.3). ok = 스키마 검증 통과, parse_failed = 재시도 후에도 JSON 이 아니었다 */
export type OpsAnalysisStatus = 'ok' | 'parse_failed';

/**
 * AI 분석 결과 — 캐시이자 Phase 4 평가(ops_reviews)의 대상(설계 §5.3 `ops_analyses`).
 *
 * 한 인시던트에 여러 행이 쌓일 수 있다(재시도·프롬프트 버전 변경). "지금 보여줄 것"은
 * 같은 incidentId 중 가장 최근 행이다 — UNIQUE 를 걸지 않는 이유다. 옛 행은 지우지 않는다.
 * Phase 4 가 "프롬프트 v1 vs v2 승인율"을 비교하려면 v1 시절 행이 남아 있어야 한다.
 */
@Entity('ops_analyses')
export class OpsAnalysisEntity extends BaseModel {
  /** Sentry issue id(숫자 문자열). ops_push_log 와 같은 폭 */
  @Column({ name: 'incident_id', length: 40 })
  @Index()
  incidentId: string;

  @Column({ length: 20 })
  status: OpsAnalysisStatus;

  /**
   * 검증을 통과한 §5.4 스키마(AiAnalysis). parse_failed 면 null.
   * jsonb 로 두는 이유: Phase 4 에서 severity 별 승인율 같은 집계를 SQL 로 바로 뽑기 위해서다.
   */
  @Column({ name: 'result_json', type: 'jsonb', nullable: true })
  resultJson: Record<string, unknown> | null;

  /**
   * 모델이 실제로 뱉은 원문(마스킹·4,000자 절단). parse_failed 일 때 앱의 fallback UI 가 이걸 보여준다 —
   * "구조화는 못 했지만 읽을 수는 있다"가 아무것도 없는 것보다 낫다. 설계 §5.3 에 없던 컬럼이다.
   */
  // 타입을 명시해야 한다 — `string | null` 은 리플렉션으로 Object 로 보여 generate 가 거부한다(Phase 1 함정).
  @Column({ name: 'raw_text', type: 'text', nullable: true })
  rawText: string | null;

  /**
   * ⚠ 반드시 저장한다. Phase 4 의 "프롬프트 v1 vs v2 승인율" 비교가 이 값에 걸려 있다(설계 §5.3).
   */
  @Column({ name: 'prompt_version', length: 20 })
  promptVersion: string;

  /** 응답을 만든 모델 id(예: gemini-3.1-flash-lite). 시뮬레이션 행은 'simulated' */
  @Column({ type: 'varchar', length: 80, nullable: true })
  model: string | null;

  /** LLM 왕복에 든 시간(재시도 포함, ms). Sentry span 과 같은 값을 DB 에도 남긴다 */
  @Column({ name: 'latency_ms', type: 'integer' })
  latencyMs: number;

  // ── Phase 4 (평가 루프) 에서 더한 세 컬럼. 옛 행(Phase 3)은 전부 null 이다 ──

  /**
   * 분석 시점의 인시던트 제목(scrubText 적용, 300자). 평가 카드의 머리글이자 few-shot 예시의 "입력" 쪽이다.
   * Sentry 를 다시 부르지 않고 행만으로 카드를 그리기 위해 저장한다 — 평가 화면은 대기 목록을 한 번에 수십 건 받는다.
   */
  @Column({ name: 'incident_title', type: 'varchar', length: 300, nullable: true })
  incidentTitle: string | null;

  /** "AxiosError: Network Error" 꼴의 예외 한 줄(scrubText, 500자). 예외가 없는 이벤트면 null */
  @Column({ name: 'exception_text', type: 'varchar', length: 500, nullable: true })
  exceptionText: string | null;

  /**
   * 이 분석의 프롬프트에 few-shot 예시로 들어간 분석 행의 id 목록. 예시가 없었으면(v1) null.
   * "왜 이렇게 답했나"를 되짚을 수 있게 남긴다 — 어시스턴트 eval 이 결과 JSON 을 보존하는 것과 같은 발상(Phase 4 결정 ④).
   */
  @Column({ name: 'few_shot_ids', type: 'jsonb', nullable: true })
  fewShotIds: number[] | null;
}
