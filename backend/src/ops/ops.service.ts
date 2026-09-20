import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../intrastructure/redis/redis.service';
import { scrubText } from '../common/utils/scrub-text';
import {
  SentryApiClient,
  SentryApiError,
  SentryBreadcrumb,
  SentryEvent,
  SentryIssue,
  SentryIssueDetail,
} from './sentry-api.client';
import { IncidentLevel, IncidentSummary } from './dto/incident-summary.dto';
import { IncidentBreadcrumb, IncidentDetail, IncidentException } from './dto/incident-detail.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { OpsDeviceTokenEntity } from './entity/ops-device-token.entity';

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
  static readonly DETAIL_CACHE_PREFIX = 'ops:incident:';
  /** 상세 화면에 내려보낼 상한. 모바일 화면에서 그 이상은 읽지 않는다 — payload 다이어트 */
  static readonly MAX_FRAMES = 30;
  static readonly MAX_BREADCRUMBS = 30;
  /** Sentry issue id 는 숫자 문자열. 그 외는 Sentry URL 에 끼워 넣지 않는다(경로 조작 차단) */
  private static readonly ISSUE_ID = /^\d{1,20}$/;

  constructor(
    private readonly sentry: SentryApiClient,
    private readonly redisService: RedisService,
    @InjectRepository(OpsDeviceTokenEntity)
    private readonly deviceTokens: Repository<OpsDeviceTokenEntity>,
  ) {}

  /**
   * 기기 push token 등록. 앱은 켤 때마다 호출하므로 **upsert** 다 —
   * (userId, expoPushToken) 유니크에 걸려 행이 늘지 않고, 앱을 지웠다 다시 깔아
   * disabledAt 이 찍혀 있던 토큰도 되살아난다.
   */
  async registerDevice(userId: number, dto: RegisterDeviceDto): Promise<{ registered: true }> {
    await this.deviceTokens.upsert(
      {
        userId,
        expoPushToken: dto.expoPushToken,
        platform: dto.platform,
        disabledAt: null,
      },
      { conflictPaths: ['userId', 'expoPushToken'] },
    );
    this.logger.log(`push token 등록: user=${userId} platform=${dto.platform}`);
    return { registered: true };
  }

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

  /**
   * 인시던트 상세 = issue 단건 + 최신 event 를 합쳐 축약한 것(설계 §4.3 S3).
   *  - id 형식 오류·없는 이슈 → 404 (푸시 딥링크가 지워진 이슈를 가리킬 수 있다)
   *  - 그 밖의 Sentry 실패 → 502
   */
  async getIncident(id: string): Promise<{ item: IncidentDetail; cached: boolean }> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'Sentry 연동이 설정되지 않았습니다 (SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG).',
      );
    }
    if (!OpsService.ISSUE_ID.test(id)) {
      throw new NotFoundException('인시던트를 찾을 수 없습니다.');
    }

    const cacheKey = `${OpsService.DETAIL_CACHE_PREFIX}${id}`;
    const cached = await this.redisService.getCache<IncidentDetail>(cacheKey);
    if (cached && typeof cached === 'object') {
      return { item: cached, cached: true };
    }

    let issue: SentryIssueDetail;
    let event: SentryEvent;
    try {
      [issue, event] = await Promise.all([this.sentry.getIssue(id), this.sentry.getLatestEvent(id)]);
    } catch (err) {
      if (err instanceof SentryApiError && err.status === 404) {
        throw new NotFoundException('인시던트를 찾을 수 없습니다.');
      }
      this.logger.error(`Sentry 상세 조회 실패(${id}): ${(err as Error).message}`);
      throw new BadGatewayException('Sentry API 호출에 실패했습니다.');
    }

    const item = OpsService.toDetail(issue, event);
    await this.redisService.setCache(cacheKey, item, OpsService.CACHE_TTL_SEC);
    return { item, cached: false };
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

  /**
   * issue + 최신 event → IncidentDetail. 화이트리스트 방식 — 적은 필드만 옮기고 나머지는 버린다.
   * event 의 request(헤더·쿠키)·user(IP·이메일)·contexts 는 읽지도 않는다(§7 ⑤).
   * 자유 텍스트(예외 메시지·breadcrumb)는 scrubText 로 이메일·전화를 마스킹한다 —
   * 이 응답은 직렬화 인터셉터의 @Exclude 가 닿지 않는 외부 데이터다.
   */
  static toDetail(issue: SentryIssueDetail, event: SentryEvent): IncidentDetail {
    const entries = Array.isArray(event?.entries) ? event.entries : [];

    let exception: IncidentException | null = null;
    let breadcrumbs: IncidentBreadcrumb[] = [];

    for (const entry of entries) {
      if (entry.type === 'exception') {
        // chained exception 이면 마지막 값이 실제로 던져진 것이다.
        const values = (entry.data as { values?: unknown[] } | undefined)?.values ?? [];
        const last = values[values.length - 1] as
          | {
              type?: string | null;
              value?: string | null;
              stacktrace?: { frames?: Array<Record<string, unknown>> | null } | null;
            }
          | undefined;
        if (last) {
          const frames = last.stacktrace?.frames ?? [];
          exception = {
            type: last.type ?? null,
            value: scrubText(last.value),
            frames: frames
              .slice(-OpsService.MAX_FRAMES)
              .reverse()
              .map((f) => ({
                filename: typeof f.filename === 'string' ? f.filename : null,
                function: typeof f.function === 'string' ? f.function : null,
                lineNo: typeof f.lineNo === 'number' ? f.lineNo : null,
                colNo: typeof f.colNo === 'number' ? f.colNo : null,
                inApp: f.inApp === true,
              })),
          };
        }
      } else if (entry.type === 'breadcrumbs') {
        const values = ((entry.data as { values?: SentryBreadcrumb[] } | undefined)?.values ?? []) as SentryBreadcrumb[];
        breadcrumbs = values.slice(-OpsService.MAX_BREADCRUMBS).map((b) => OpsService.toBreadcrumb(b));
      }
    }

    return {
      ...OpsService.toSummary(issue),
      firstSeen: issue.firstSeen,
      culprit: issue.culprit || null,
      project: issue.project?.slug ?? null,
      status: issue.status ?? 'unresolved',
      exception,
      breadcrumbs,
    };
  }

  /**
   * http 류 breadcrumb 은 message 가 null 이고 data 에 method/url/status_code 가 있다(실측).
   * 앱이 data 를 해석하지 않아도 되게 "GET /api/categories → 0" 한 줄로 합성한다.
   * url 의 쿼리스트링은 뗀다 — 검색어·토큰이 실릴 수 있다.
   */
  static toBreadcrumb(b: SentryBreadcrumb): IncidentBreadcrumb {
    let message = b.message ?? null;
    const data = b.data;
    if (!message && data && typeof data.url === 'string') {
      const method = typeof data.method === 'string' ? data.method : 'GET';
      const status = data.status_code ?? data.statusCode;
      const path = data.url.split('?')[0];
      message = `${method} ${path}${status !== undefined && status !== null ? ` → ${String(status)}` : ''}`;
    }
    return {
      timestamp: b.timestamp ?? null,
      category: b.category ?? null,
      level: b.level ?? null,
      message: message ? (scrubText(message) as string).slice(0, 300) : null,
    };
  }
}
