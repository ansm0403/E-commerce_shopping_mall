import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SentryApiClient, SentryIssueListItem } from './sentry-api.client';
import { ExpoPushClient, ExpoPushMessage } from './expo-push.client';
import { OpsDeviceTokenEntity } from './entity/ops-device-token.entity';
import { OpsPollStateEntity } from './entity/ops-poll-state.entity';
import { OpsPushLogEntity } from './entity/ops-push-log.entity';

/** 한 주기의 결과 요약 — 로그와 테스트가 함께 읽는다 */
export interface PollOutcome {
  /** 이번 주기에 한 일. skipped 는 비활성/키 없음, seeded 는 첫 실행(커서만 심음) */
  status: 'skipped' | 'seeded' | 'polled';
  /** 커서보다 새롭고 푸시 기준을 통과한 이슈 수 */
  candidates: number;
  /** 실제로 발송한 알림 통수(기기 수 × 이슈 수) */
  sent: number;
}

/**
 * Sentry 폴링 → 푸시 발송 (설계 §3.3).
 *
 * webhook 이 아니라 폴링인 이유: Sentry 의 서드파티 통합은 Team 플랜 이상이고(무료에서 끊겼다),
 * 폴링은 서명 검증도 공개 수신 엔드포인트도 필요 없다. 잃는 것은 주기만큼의 지연뿐이다.
 *
 * 푸시 기준(2026-09-20 확정):
 *  · level 이 error·fatal 인 것만 — warning·info 로 새벽에 폰이 울릴 이유가 없다.
 *  · 쇼핑몰 프로젝트만. **앱 자신(ops-companion)은 제외** — 앱이 죽어서 푸시가 오고,
 *    그 푸시로 앱을 열어 또 죽는 되먹임을 막는다.
 *  · 우리가 처음 보는 이슈는 즉시. 이미 보낸 이슈는 쿨다운(기본 6시간) 뒤에 다시.
 *    "새 이슈만" 으로 하면 같은 에러로 데모를 두 번 찍을 수 없고, 쿨다운이 없으면
 *    514회 발생한 CORS 이슈 같은 것이 주기마다 울린다.
 */
@Injectable()
export class OpsPollerService {
  private readonly logger = new Logger(OpsPollerService.name);

  /** 폴링이 훑는 기간. 서버가 한참 꺼져 있었어도 24h 안의 것은 따라잡는다 */
  static readonly STATS_PERIOD = '24h';
  static readonly PUSH_LEVELS = new Set(['error', 'fatal']);
  /** 안드로이드 알림 채널 이름 — 앱이 만드는 채널과 같아야 소리·중요도가 적용된다 */
  static readonly CHANNEL_ID = 'incidents';

  private readonly enabled: boolean;
  private readonly projectSlugs: string[];
  private readonly cooldownMs: number;
  private readonly expo: ExpoPushClient;

  constructor(
    private readonly sentry: SentryApiClient,
    config: ConfigService,
    @InjectRepository(OpsPollStateEntity)
    private readonly pollState: Repository<OpsPollStateEntity>,
    @InjectRepository(OpsDeviceTokenEntity)
    private readonly deviceTokens: Repository<OpsDeviceTokenEntity>,
    @InjectRepository(OpsPushLogEntity)
    private readonly pushLog: Repository<OpsPushLogEntity>,
  ) {
    // 기본 off 가 아니라 기본 on 이다 — 운영에서 켜는 것을 잊는 쪽이 더 위험하다.
    // 대신 Sentry 키가 없으면(로컬 대부분) 알아서 아무 일도 하지 않는다.
    this.enabled = (config.get<string>('OPS_PUSH_ENABLED') ?? 'true').trim() !== 'false';
    this.projectSlugs = (
      config.get<string>('OPS_PUSH_PROJECTS') ?? 'e-commerse-frontend,e-commerse-backend'
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.cooldownMs =
      Number(config.get<string>('OPS_PUSH_COOLDOWN_HOURS') ?? 6) * 60 * 60 * 1000;
    this.expo = new ExpoPushClient(config.get<string>('EXPO_ACCESS_TOKEN')?.trim() || undefined);
  }

  /** 2분마다. Sentry 쪽 레이트리밋과는 무관한 빈도이고(§11-1 📌), 온콜 체감으로도 충분하다 */
  @Cron('0 */2 * * * *')
  async handleCron(): Promise<void> {
    try {
      const outcome = await this.poll();
      if (outcome.status === 'polled' && outcome.sent > 0) {
        this.logger.log(`푸시 발송: 이슈 ${outcome.candidates}건 → 알림 ${outcome.sent}통`);
      }
    } catch (err) {
      // 스케줄러에서 던지면 프로세스 미처리 거부가 된다 — 여기서 끊는다.
      this.logger.error(`폴링 실패: ${(err as Error).message}`);
    }
  }

  async poll(now: Date = new Date()): Promise<PollOutcome> {
    if (!this.enabled || !this.sentry.isEnabled() || this.projectSlugs.length === 0) {
      return { status: 'skipped', candidates: 0, sent: 0 };
    }

    const cursor = await this.pollState.findOne({ where: { source: 'sentry' } });
    if (!cursor) {
      // 첫 실행은 커서만 심고 끝낸다. 안 그러면 지난 24시간 이슈가 한꺼번에 폰을 울린다.
      await this.pollState.save(this.pollState.create({ source: 'sentry', lastSeenAt: now }));
      this.logger.log('폴링 커서를 현재 시각으로 초기화했습니다(첫 실행, 발송 없음).');
      return { status: 'seeded', candidates: 0, sent: 0 };
    }

    const issues = await this.sentry.listIssues(OpsPollerService.STATS_PERIOD, {
      query: 'is:unresolved',
      sort: 'date',
      limit: 25,
    });

    const candidates = issues
      .filter((issue) => this.isPushTarget(issue, cursor.lastSeenAt))
      // 오래된 것부터 처리해 커서가 단조 증가하게 한다
      .sort((a, b) => Date.parse(a.lastSeen) - Date.parse(b.lastSeen));

    let sent = 0;
    if (candidates.length > 0) {
      sent = await this.notify(candidates, now);
    }

    // 커서는 "이번에 본 것 중 가장 최근"까지 올린다. 기준에 안 맞아 버린 이슈까지 포함해야
    // 같은 이슈를 매 주기 다시 훑지 않는다(푸시는 push_log 가 막으므로 안전하다).
    const newest = issues.reduce((max, i) => Math.max(max, Date.parse(i.lastSeen) || 0), 0);
    if (newest > cursor.lastSeenAt.getTime()) {
      cursor.lastSeenAt = new Date(newest);
      cursor.lastIssueId = candidates[candidates.length - 1]?.id ?? cursor.lastIssueId;
      await this.pollState.save(cursor);
    }

    return { status: 'polled', candidates: candidates.length, sent };
  }

  /** 커서보다 새로운가 + 레벨 + 프로젝트 화이트리스트 */
  private isPushTarget(issue: SentryIssueListItem, since: Date): boolean {
    if (!OpsPollerService.PUSH_LEVELS.has(issue.level)) return false;
    const slug = issue.project?.slug;
    if (!slug || !this.projectSlugs.includes(slug)) return false;

    const lastSeen = Date.parse(issue.lastSeen);
    return Number.isFinite(lastSeen) && lastSeen > since.getTime();
  }

  /**
   * 후보 이슈들을 기기에 알린다. (이슈, 사용자) 단위로 **먼저 발송 권한을 선점**하고,
   * 전송이 통째로 실패하면 선점을 되돌려 다음 주기에 다시 시도하게 한다.
   */
  private async notify(candidates: SentryIssueListItem[], now: Date): Promise<number> {
    // 데모 계정(is_demo)의 기기는 등록 자체를 막지만(OpsService.registerDevice), 그 전에 등록된 행이 남아 있어도
    // 여기서 한 번 더 거른다 — 외부 방문자의 폰에 운영 장애 알림이 가면 안 된다. TypeORM 은 관계 조건을 자동 JOIN 한다.
    const tokens = await this.deviceTokens.find({ where: { disabledAt: IsNull(), user: { isDemo: false } } });
    if (tokens.length === 0) return 0;

    const byUser = new Map<number, OpsDeviceTokenEntity[]>();
    for (const token of tokens) {
      const list = byUser.get(token.userId) ?? [];
      list.push(token);
      byUser.set(token.userId, list);
    }

    /**
     * 보낼 알림과 그 알림이 대표하는 (이슈, 사용자). **인덱스로 짝짓는다** —
     * 한 기기가 한 주기에 여러 이슈를 받으므로 토큰을 키로 쓰면 앞의 것들이 덮여
     * 전송 실패 시 선점을 되돌리지 못한다(2026-09-20 스모크에서 실제로 밟았다).
     * Expo 응답의 티켓 배열도 보낸 순서와 1:1 이라 인덱스가 공통 키가 된다.
     */
    const messages: ExpoPushMessage[] = [];
    const claims: Array<{ incidentId: string; userId: number }> = [];

    for (const issue of candidates) {
      for (const [userId, userTokens] of byUser) {
        if (!(await this.claimPush(issue.id, userId, now))) continue;
        for (const token of userTokens) {
          messages.push(OpsPollerService.toMessage(issue, token.expoPushToken));
          claims.push({ incidentId: issue.id, userId });
        }
      }
    }

    if (messages.length === 0) return 0;

    const results = await this.expo.send(messages);
    let sent = 0;
    /** (이슈, 사용자) 별로 "한 통이라도 성공했는가" — 기기 2대 중 1대만 성공해도 발송으로 본다 */
    const anySuccess = new Map<string, boolean>();

    for (const [index, result] of results.entries()) {
      const claim = claims[index];
      const key = `${claim.incidentId}:${claim.userId}`;

      if (result.ok) {
        sent += 1;
        anySuccess.set(key, true);
      } else {
        if (!anySuccess.has(key)) anySuccess.set(key, false);
        if (result.error === 'DeviceNotRegistered') {
          // 앱이 지워진 기기. 행은 남기고 발송 대상에서만 뺀다 — 재등록하면 살아난다.
          await this.deviceTokens.update({ expoPushToken: result.token }, { disabledAt: now });
        }
      }
    }

    // 한 통도 못 간 (이슈, 사용자)는 선점을 풀어 다음 주기에 재시도한다.
    for (const [key, ok] of anySuccess) {
      if (ok) continue;
      const [incidentId, userId] = key.split(':');
      await this.releasePush(incidentId, Number(userId));
    }

    return sent;
  }

  /**
   * 발송 권한 선점 — 이 한 문장이 멱등과 쿨다운을 동시에 처리한다.
   * 처음 보는 (이슈, 사용자)는 INSERT 로 잡히고, 이미 있으면 쿨다운이 지났을 때만 UPDATE 된다.
   * 두 워커가 같은 순간에 들어와도 유니크 제약 때문에 한쪽만 RETURNING 을 받는다.
   */
  private async claimPush(incidentId: string, userId: number, now: Date): Promise<boolean> {
    const threshold = new Date(now.getTime() - this.cooldownMs);
    const rows = (await this.pushLog.query(
      `INSERT INTO ops_push_log (incident_id, user_id, last_pushed_at, push_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (incident_id, user_id) DO UPDATE
         SET last_pushed_at = EXCLUDED.last_pushed_at,
             push_count = ops_push_log.push_count + 1,
             "updatedAt" = now()
         WHERE ops_push_log.last_pushed_at < $4
       RETURNING id`,
      [incidentId, userId, now, threshold],
    )) as Array<{ id: number }>;

    return rows.length > 0;
  }

  /** 전송이 통째로 실패했을 때 선점 취소. 첫 발송이었으면 행을 지우고, 재발이었으면 되돌린다. */
  private async releasePush(incidentId: string, userId: number): Promise<void> {
    await this.pushLog.query(
      `WITH deleted AS (
         DELETE FROM ops_push_log
         WHERE incident_id = $1 AND user_id = $2 AND push_count <= 1
         RETURNING id
       )
       UPDATE ops_push_log
         SET push_count = push_count - 1,
             last_pushed_at = "createdAt"
       WHERE incident_id = $1 AND user_id = $2 AND push_count > 1`,
      [incidentId, userId],
    );
  }

  /**
   * 알림 문안과 딥링크. data.url 은 앱이 그대로 router.push 에 넘기는 경로다 —
   * 앱이 payload 를 해석하는 규칙을 백엔드가 정해 주는 셈이라, 앱 쪽 분기 코드가 사라진다.
   */
  static toMessage(issue: SentryIssueListItem, to: string): ExpoPushMessage {
    const project = issue.project?.slug ?? 'unknown';
    const count = Number.parseInt(issue.count, 10) || 0;

    return {
      to,
      title: `${issue.level === 'fatal' ? '🔥' : '🚨'} ${project}`,
      body: count > 1 ? `${issue.title} (${count}회)` : issue.title,
      data: { incidentId: String(issue.id), url: `/incidents/${issue.id}` },
      channelId: OpsPollerService.CHANNEL_ID,
      priority: 'high',
    };
  }
}
