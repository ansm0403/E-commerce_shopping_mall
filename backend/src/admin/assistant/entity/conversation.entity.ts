import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseModel } from '../../../common/entity/base.entity';
import { AssistantMessageEntity } from './message.entity';

/**
 * 관리자 AI 어시스턴트의 대화 1건. (Phase 2.5 — 인메모리 Map → TypeORM 영속화)
 *
 * - 멀티턴 복원: conversationId(=id)로 messages를 시간순 로드해 LLM에 다시 전송.
 * - 감사 관점: "어떤 admin이 무엇을 물었는가"가 이 테이블 + messages에 남는다.
 * - 소유권: adminUserId(JWT sub)로 본인 대화만 이어가게 검증한다.
 */
@Entity('assistant_conversations')
export class AssistantConversationEntity extends BaseModel {
  /** 대화를 소유한 관리자(JWT sub). 다른 admin의 대화는 이어갈 수 없다. */
  @Index()
  @Column()
  adminUserId: number;

  /** 첫 사용자 메시지 앞부분으로 채우는 라벨(선택). 목록 표시용. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  title: string | null;

  @OneToMany(() => AssistantMessageEntity, (m) => m.conversation)
  messages: AssistantMessageEntity[];
}
