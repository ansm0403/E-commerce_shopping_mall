import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseModel } from '../../common/entity/base.entity';
import type { UserModel } from '../../user/entity/user.entity';

export type OpsDevicePlatform = 'ios' | 'android';

/**
 * RN 운영 앱의 기기별 Expo push token (설계 §5.3).
 *
 * 폴링 스케줄러가 새 인시던트를 찾으면 이 표의 토큰 전부에 발송한다.
 * (userId, expoPushToken) 유니크 — 앱이 켜질 때마다 등록을 재시도해도 행이 늘지 않게(upsert).
 * 같은 사용자가 폰·태블릿을 쓰면 행이 여러 개이고, 둘 다 울린다.
 */
@Entity('ops_device_tokens')
@Unique(['userId', 'expoPushToken'])
export class OpsDeviceTokenEntity extends BaseModel {
  @Column({ name: 'user_id' })
  @Index()
  userId: number;

  @ManyToOne('UserModel', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserModel;

  /** 예: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" */
  @Column({ name: 'expo_push_token', length: 200 })
  expoPushToken: string;

  @Column({ type: 'varchar', length: 10 })
  platform: OpsDevicePlatform;

  /**
   * Expo 가 DeviceNotRegistered 를 돌려준 시각(앱 삭제·토큰 폐기).
   * 행을 지우지 않고 표시만 해 둔다 — 발송 대상에서는 빠지고, 재등록하면 다시 살아난다.
   */
  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  disabledAt: Date | null;
}
