import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseModel } from '../../common/entity/base.entity';

/**
 * 푸시 발송 기록 — 멱등과 쿨다운을 동시에 담당한다(설계 §5.3 의 멱등 요구 + 사용자 확정 기준).
 *
 * (incidentId, userId) 유니크. 발송 전에 이 표를 먼저 잡으므로:
 *  - 커서가 틀어져 같은 이슈를 다시 만나도 중복 발송이 한 번으로 눌린다(정산 리스너의 멱등 패턴).
 *  - 재발 이슈는 lastPushedAt 으로부터 쿨다운(기본 6시간)이 지났을 때만 다시 보낸다.
 *    "새 이슈만" 으로 하면 같은 에러로 데모를 다시 찍을 수 없고, 쿨다운이 없으면
 *    514회 발생한 CORS 이슈 같은 것이 주기마다 울린다.
 */
@Entity('ops_push_log')
@Unique(['incidentId', 'userId'])
export class OpsPushLogEntity extends BaseModel {
  /** Sentry issue id(숫자 문자열) */
  @Column({ name: 'incident_id', length: 40 })
  @Index()
  incidentId: string;

  @Column({ name: 'user_id' })
  userId: number;

  @Column({ name: 'last_pushed_at', type: 'timestamptz' })
  lastPushedAt: Date;

  /** 이 이슈로 이 사용자에게 보낸 누적 횟수. 재발이 잦은 이슈를 사후에 알아보기 위한 것 */
  @Column({ name: 'push_count', default: 1 })
  pushCount: number;
}
