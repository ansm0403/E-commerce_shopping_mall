import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../intrastructure/redis/redis.service';
import { SentryApiClient, SentryIssue } from './sentry-api.client';
import { IncidentLevel, IncidentSummary } from './dto/incident-summary.dto';

/**
 * Ops Companion(RN 운영 앱) 백엔드 — Phase 0: 인시던트 목록 조회 프록시.
 *
 * 앱은 Sentry 를 직접 부르지 않고 항상 이 백엔드를 경유한다(설계 §3.2):
 *  · Sentry 토큰이 앱 바이너리에 들어가지 않는다.
 *  · 응답을 축약형으로 가공해 raw JSON 을 노출하지 않는다(§5.2·§7).
 *  · Redis 캐시로 pull-to-refresh 연타가 Sentry 를 직접 때리지 않게 한다.
 *
 * 무상태 — DB 테이블 없음. (device token·분석·평가 테이블은 Phase 1 이후)
 */
@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);

  /** 앱 목록 화면 기준 집계 기간. 설계 §5.1 의 실측 URL 과 동일 */
  static readonly STATS_PERIOD = '24h';
  /** 캐시 TTL. 앱 폴링/새로고침 주기보다 짧게 잡아 "1분 이내 최신"을 보장 */
  static readonly CACHE_TTL_SEC = 60;
  static readonly CACHE_KEY = `ops:incidents:${OpsService.STATS_PERIOD}`;

  constructor(
    private readonly sentry: SentryApiClient,
    private readonly redisService: RedisService,
  ) {}

  isEnabled(): boolean {
    return this.sentry.isEnabled();
  }

  /**
   * 인시던트 목록(축약형). cached=true 면 Redis 에서 나온 것.
   *  - 미설정 → 503 (빈 배열을 주면 "장애 0건"으로 오해하므로 명시적으로 알린다)
   *  - Sentry 실패 → 502 (상태코드/사유는 서버 로그에만)
   */
  async getIncidents(): Promise<{ items: IncidentSummary[]; cached: boolean }> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'Sentry 연동이 설정되지 않았습니다 (SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG).',
      );
    }

    const cached = await this.redisService.getCache<IncidentSummary[]>(OpsService.CACHE_KEY);
    if (Array.isArray(cached)) {
      return { items: cached, cached: true };
    }

    let issues: SentryIssue[];
    try {
      issues = await this.sentry.listIssues(OpsService.STATS_PERIOD);
    } catch (err) {
      this.logger.error(`Sentry 조회 실패: ${(err as Error).message}`);
      throw new BadGatewayException('Sentry API 호출에 실패했습니다.');
    }

    const items = issues.map((i) => OpsService.toSummary(i));
    await this.redisService.setCache(OpsService.CACHE_KEY, items, OpsService.CACHE_TTL_SEC);
    return { items, cached: false };
  }

  /** Sentry issue → IncidentSummary. 정해진 5개 필드만 남긴다(§5.2). */
  static toSummary(issue: SentryIssue): IncidentSummary {
    return {
      id: String(issue.id),
      title: issue.title ?? '',
      level: OpsService.toLevel(issue.level),
      count: Number.parseInt(issue.count, 10) || 0,
      lastSeen: issue.lastSeen,
    };
  }

  /**
   * Sentry level(fatal/error/warning/info/debug) → 앱의 3단계.
   * fatal 은 error 로 올리고 debug 는 info 로 내린다 — 앱 UI 는 세 색만 쓴다.
   */
  static toLevel(level: string | undefined): IncidentLevel {
    switch (level) {
      case 'warning':
        return 'warning';
      case 'info':
      case 'debug':
        return 'info';
      default:
        return 'error';
    }
  }
}
