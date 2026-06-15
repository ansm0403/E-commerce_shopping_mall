import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseModel } from '../../../common/entity/base.entity';
import { AssistantConversationEntity } from './conversation.entity';

/** 대화 한 턴의 발화 주체. LlmMessage.role과 1:1 대응(프로바이더 무관 중립 표기). */
export type AssistantMessageRole = 'user' | 'assistant';

/**
 * 대화에 누적되는 메시지 한 턴. (Phase 2.5)
 *
 * - 저장 대상은 "최종 user/assistant 텍스트 턴"뿐이다.
 *   도구 호출 중간 parts(functionCall/functionResponse, thoughtSignature 포함)는
 *   프로바이더 고유 포맷이라 영속화하지 않는다(인메모리 시절과 동일 — 멀티턴 복원에 불필요).
 * - 다음 턴에 createdAt 오름차순으로 로드해 LlmMessage[]로 재구성 → LLM에 통째로 재전송.
 */
@Entity('assistant_messages')
export class AssistantMessageEntity extends BaseModel {
  @Index()
  @Column()
  conversationId: number;

  @ManyToOne(() => AssistantConversationEntity, (c) => c.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversationId' })
  conversation: AssistantConversationEntity;

  @Column({ type: 'varchar', length: 16 })
  role: AssistantMessageRole;

  @Column({ type: 'text' })
  content: string;
}
