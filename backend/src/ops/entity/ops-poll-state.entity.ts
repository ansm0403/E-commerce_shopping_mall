import { Column, Entity, Unique } from 'typeorm';
import { BaseModel } from '../../common/entity/base.entity';

/**
 * 폴링 커서 — "Sentry 를 어디까지 봤는가" (설계 §5.3 · §3.3).
 *
 * ⚠ 이 표가 없으면 폴링이 성립하지 않는다. 매 주기마다 같은 이슈를 새 인시던트로 오인해
 * 푸시가 무한 반복된다. Redis 에만 두는 것도 위험하다 — 재시작하면 커서를 잃고 같은 사고가 난다.
 * 그래서 DB 에 둔다. source 유니크라 행은 'sentry' 하나뿐이다.
 */
@Entity('ops_poll_state')
@Unique(['source'])
export class OpsPollStateEntity extends BaseModel {
  @Column({ length: 30, default: 'sentry' })
  source: string;

  /**
   * 마지막으로 처리한 이슈의 lastSeen. 다음 주기는 이 시각 이후로 갱신된 이슈만 후보로 본다.
   * 첫 실행(행 없음)에는 그 순간을 커서로 심고 아무것도 보내지 않는다 —
   * 안 그러면 과거 24시간 이슈가 한꺼번에 푸시된다.
   */
  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  /** 같은 lastSeenAt 을 가진 이슈가 둘일 때 어느 쪽까지 봤는지 구분하는 보조 정보 */
  // 타입을 명시해야 한다 — `string | null` 은 리플렉션으로 Object 로 보여 드라이버가 거부한다.
  @Column({ name: 'last_issue_id', type: 'varchar', length: 40, nullable: true })
  lastIssueId: string | null;
}
