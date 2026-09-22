import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseModel } from '../../common/entity/base.entity';
import type { UserModel } from '../../user/entity/user.entity';

/**
 * 인시던트별 **사실 메모(ground truth)** — 채점 안내의 재료(설계 §9 Phase 7).
 *
 * 왜 있나: Phase 6 채점 직후 평가자가 "상황과 해답을 몰라 임의로 승인한 건이 많다"고 밝혔다. 카드가 판단 근거를
 * 주지 않으면 채점은 "자신 있고 구체적인 답"에 점수를 준다. 이 표는 사람이 아는 정답(무엇이 깨졌나 · 원인 파일/함수 ·
 * 조치 방향 · 흔한 오답)을 인시던트 단위로 담아, 같은 인시던트의 두 팔(v1.1·v3.1)이 **같은 메모**를 보게 한다.
 *
 * 원인 위치의 실제 코드(code_*)는 사람이 옮겨 적지 않고 seed 스크립트가 SourceReaderService.read 로 그 커밋에서
 * 가져와 저장한다(오타 없음). 확인 항목 ②("지어낸 식별자 없음")의 근거가 이 코드다 — tool_calls 칩은 v3.1 에만 있어
 * 팔을 드러내므로 근거로 쓸 수 없다(인수인계 함정 3).
 *
 * ⚠ 이 표는 **LLM 입력에 절대 들어가지 않는다.** 정답이 프롬프트로 새면 다음 분석이 오염된다(5편 few-shot 누수와 같은
 * 종류). OpsAnalysisService 는 이 엔티티를 import 하지 않고, 단위 테스트가 그 사실을 고정한다.
 */
@Entity('ops_incident_notes')
export class OpsIncidentNoteEntity extends BaseModel {
  /** Sentry issue id. ops_analyses.incident_id 와 같은 폭. 인시던트당 메모는 하나다 */
  @Column({ name: 'incident_id', length: 40, unique: true })
  @Index()
  incidentId: string;

  /** Sentry 프로젝트 slug(e-commerse-frontend 등). 대기 응답의 relatedFiles 정규화 힌트로도 쓴다(옛 분석 행엔 project 가 없다) */
  @Column({ type: 'varchar', length: 80, nullable: true })
  project: string | null;

  /** 무엇이 어떻게 깨졌나 — 초심자가 읽을 수 있는 한두 문장 */
  @Column({ type: 'text' })
  symptom: string;

  /** 원인 파일·함수·줄. 확인 항목 ①의 기준 */
  @Column({ name: 'cause_location', type: 'text' })
  causeLocation: string;

  /** 정답 조치의 방향. 확인 항목 ③의 기준("같은 방향인가") */
  @Column({ name: 'fix_direction', type: 'text' })
  fixDirection: string;

  /** 흔한 오답. 확인 항목 ④("오답을 high 로 말하면 ✗")의 기준. 없으면 null */
  @Column({ name: 'common_mistakes', type: 'text', nullable: true })
  commonMistakes: string | null;

  // ── 원인 위치의 실제 코드(스크립트가 SourceReaderService.read 로 채운다). 넷 다 null 이면 코드 없는 메모 ──

  @Column({ name: 'code_path', type: 'varchar', length: 300, nullable: true })
  codePath: string | null;

  /** 읽은 커밋 SHA 또는 브랜치 */
  @Column({ name: 'code_ref', type: 'varchar', length: 40, nullable: true })
  codeRef: string | null;

  @Column({ name: 'code_start_line', type: 'integer', nullable: true })
  codeStartLine: number | null;

  @Column({ name: 'code_end_line', type: 'integer', nullable: true })
  codeEndLine: number | null;

  /** 줄 번호가 붙은 코드 조각(scrubText 적용, SourceReaderService.read 의 content 그대로) */
  @Column({ name: 'code_text', type: 'text', nullable: true })
  codeText: string | null;

  /** 메모를 쓴 관리자. 스크립트가 넣으면 null */
  @Column({ name: 'author_id', type: 'integer', nullable: true })
  authorId: number | null;

  @ManyToOne('UserModel', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'author_id' })
  author: UserModel | null;
}
