import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadGatewayException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { OpsService } from './ops.service';
import { SentryApiClient, SentryApiError, SentryEvent, SentryIssue, SentryIssueDetail } from './sentry-api.client';
import { RedisService } from '../intrastructure/redis/redis.service';
import { OpsDeviceTokenEntity } from './entity/ops-device-token.entity';

/** Sentry 실응답(2026-09-16 실측)에서 필요한 필드만 딴 샘플 — count 가 문자열인 점에 주의 */
const issue = (over: Partial<SentryIssue> = {}): SentryIssue => ({
  id: '7734495591',
  title: 'Error: probe-uncaught-1789514756328',
  level: 'error',
  count: '3',
  lastSeen: '2026-09-15T23:26:03Z',
  ...over,
});

describe('OpsService', () => {
  let service: OpsService;
  let sentry: {
    isEnabled: jest.Mock;
    listIssues: jest.Mock;
    getIssue: jest.Mock;
    getLatestEvent: jest.Mock;
    getSessionsByRelease: jest.Mock;
  };
  let redis: { getCache: jest.Mock; setCache: jest.Mock };
  let deviceTokens: { upsert: jest.Mock };

  beforeEach(async () => {
    sentry = {
      isEnabled: jest.fn().mockReturnValue(true),
      listIssues: jest.fn(),
      getIssue: jest.fn(),
      getLatestEvent: jest.fn(),
      getSessionsByRelease: jest.fn(),
    };
    redis = { getCache: jest.fn().mockResolvedValue(null), setCache: jest.fn() };
    deviceTokens = { upsert: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        OpsService,
        { provide: SentryApiClient, useValue: sentry },
        { provide: RedisService, useValue: redis },
        { provide: getRepositoryToken(OpsDeviceTokenEntity), useValue: deviceTokens },
      ],
    }).compile();
    service = module.get(OpsService);
  });

  it('키 미설정(비활성)이면 Sentry 를 부르지 않고 503', async () => {
    sentry.isEnabled.mockReturnValue(false);
    await expect(service.getIncidents()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sentry.listIssues).not.toHaveBeenCalled();
  });

  it('캐시 MISS: Sentry 조회 → 5개 필드 축약형으로 변환 → Redis 60초 저장', async () => {
    sentry.listIssues.mockResolvedValue([
      // raw 응답에는 permalink 등 40여 필드가 섞여 온다 — 그대로 새면 안 된다
      { ...issue(), permalink: 'https://sentry.io/...', assignedTo: null } as unknown as SentryIssue,
      issue({ id: '7734451568', title: 'AggregateError', count: '1', level: 'fatal' }),
    ]);

    const { items, cached } = await service.getIncidents();

    expect(cached).toBe(false);
    expect(items).toEqual([
      { id: '7734495591', title: 'Error: probe-uncaught-1789514756328', level: 'error', count: 3, lastSeen: '2026-09-15T23:26:03Z' },
      { id: '7734451568', title: 'AggregateError', level: 'error', count: 1, lastSeen: '2026-09-15T23:26:03Z' },
    ]);
    expect(Object.keys(items[0]).sort()).toEqual(['count', 'id', 'lastSeen', 'level', 'title']);
    expect(sentry.listIssues).toHaveBeenCalledWith('24h');
    expect(redis.setCache).toHaveBeenCalledWith('ops:incidents:24h', items, 60);
  });

  it('캐시 HIT: Redis 값을 그대로 돌려주고 Sentry 를 부르지 않는다(pull-to-refresh 연타 보호)', async () => {
    const cachedItems = [OpsService.toSummary(issue())];
    redis.getCache.mockResolvedValue(cachedItems);

    const out = await service.getIncidents();

    expect(out).toEqual({ items: cachedItems, cached: true });
    expect(sentry.listIssues).not.toHaveBeenCalled();
    expect(redis.setCache).not.toHaveBeenCalled();
  });

  it('Sentry 호출 실패는 502 로 감싼다(원문은 로그에만)', async () => {
    sentry.listIssues.mockRejectedValue(new Error('Sentry API responded 401'));
    await expect(service.getIncidents()).rejects.toBeInstanceOf(BadGatewayException);
    expect(redis.setCache).not.toHaveBeenCalled();
  });

  it.each([
    ['fatal', 'error'],
    ['error', 'error'],
    ['warning', 'warning'],
    ['info', 'info'],
    ['debug', 'info'],
    [undefined, 'error'],
  ])('level 매핑 %s → %s', (from, to) => {
    expect(OpsService.toLevel(from as string | undefined)).toBe(to);
  });

  describe('getIncident (상세)', () => {
    const issueDetail = (): SentryIssueDetail => ({
      ...issue({ id: '7742806116', title: 'AxiosError: Network Error', count: '12' }),
      firstSeen: '2026-09-19T19:11:08Z',
      culprit: 'GET /products',
      status: 'unresolved',
      project: { slug: 'e-commerse-frontend' },
      firstRelease: { version: 'f54ba5ec90783a8c9a1722ee56200d6e2f678531' },
    });

    /** 2026-09-20 실측 event 의 모양 — request/user 같은 민감 entry 가 함께 온다 */
    const event = (): SentryEvent =>
      ({
        user: { email: 'buyer@example.com', ip_address: '1.2.3.4' },
        release: { version: 'c6a2c4b1cafa00f67779e34e05e94b105c9d4399' },
        entries: [
          {
            type: 'exception',
            data: {
              values: [
                {
                  type: 'AxiosError',
                  value: 'Network Error (user kim@example.com)',
                  stacktrace: {
                    frames: [
                      { filename: 'node_modules/axios/lib/adapters/xhr.js', function: 'dispatch', lineNo: 10, colNo: 1, inApp: false, vars: { secret: 'x' } },
                      { filename: 'app:///_next/static/chunks/5585.js', function: 'y.onerror', lineNo: 1, colNo: 55048, inApp: true },
                    ],
                  },
                },
              ],
            },
          },
          {
            type: 'breadcrumbs',
            data: {
              values: [
                { type: 'default', timestamp: '2026-09-19T19:11:16.022Z', level: 'info', category: 'console', message: '문의: 010-1234-5678' },
                { type: 'http', timestamp: '2026-09-19T19:11:16.023Z', level: 'info', category: 'xhr', message: null, data: { method: 'GET', status_code: 0, url: '/api/categories?token=abc' } },
              ],
            },
          },
          { type: 'request', data: { headers: [['Cookie', 'refreshToken=...']] } },
        ],
      }) as unknown as SentryEvent;

    it('issue + 최신 event 를 합쳐 축약한다 — 프레임은 최근 호출이 앞, PII 스크럽, request/user 는 버린다', async () => {
      sentry.getIssue.mockResolvedValue(issueDetail());
      sentry.getLatestEvent.mockResolvedValue(event());

      const { item, cached } = await service.getIncident('7742806116');

      expect(cached).toBe(false);
      expect(item).toEqual({
        id: '7742806116',
        title: 'AxiosError: Network Error',
        level: 'error',
        count: 12,
        lastSeen: '2026-09-15T23:26:03Z',
        firstSeen: '2026-09-19T19:11:08Z',
        culprit: 'GET /products',
        project: 'e-commerse-frontend',
        status: 'unresolved',
        release: 'c6a2c4b1cafa00f67779e34e05e94b105c9d4399',
        firstRelease: 'f54ba5ec90783a8c9a1722ee56200d6e2f678531',
        exception: {
          type: 'AxiosError',
          value: 'Network Error (user k***@***)',
          frames: [
            { filename: 'app:///_next/static/chunks/5585.js', function: 'y.onerror', lineNo: 1, colNo: 55048, inApp: true },
            { filename: 'node_modules/axios/lib/adapters/xhr.js', function: 'dispatch', lineNo: 10, colNo: 1, inApp: false },
          ],
        },
        breadcrumbs: [
          { timestamp: '2026-09-19T19:11:16.022Z', category: 'console', level: 'info', message: '문의: ***' },
          { timestamp: '2026-09-19T19:11:16.023Z', category: 'xhr', level: 'info', message: 'GET /api/categories → 0' },
        ],
      });
      expect(JSON.stringify(item)).not.toMatch(/refreshToken|1\.2\.3\.4|secret|token=abc/);
      expect(redis.setCache).toHaveBeenCalledWith('ops:incident:7742806116', item, 60);
    });

    it('프레임·breadcrumb 은 최근 30개로 자른다', async () => {
      const frames = Array.from({ length: 50 }, (_, i) => ({ filename: `f${i}.js`, lineNo: i, inApp: true }));
      const crumbs = Array.from({ length: 43 }, (_, i) => ({ message: `c${i}` }));
      sentry.getIssue.mockResolvedValue(issueDetail());
      sentry.getLatestEvent.mockResolvedValue({
        entries: [
          { type: 'exception', data: { values: [{ type: 'E', value: 'v', stacktrace: { frames } }] } },
          { type: 'breadcrumbs', data: { values: crumbs } },
        ],
      } as unknown as SentryEvent);

      const { item } = await service.getIncident('1');

      expect(item.exception?.frames).toHaveLength(30);
      expect(item.exception?.frames[0].filename).toBe('f49.js'); // 최근 호출이 맨 앞
      expect(item.breadcrumbs).toHaveLength(30);
      expect(item.breadcrumbs[29].message).toBe('c42'); // 시간순 유지, 최근 것이 끝
    });

    it('예외 없는 event(메시지 이벤트)는 exception=null, breadcrumbs=[]', async () => {
      sentry.getIssue.mockResolvedValue(issueDetail());
      sentry.getLatestEvent.mockResolvedValue({ entries: [] });
      const { item } = await service.getIncident('1');
      expect(item.exception).toBeNull();
      expect(item.breadcrumbs).toEqual([]);
      // 릴리즈를 안 적는 프로젝트(Phase 5 이전 백엔드)는 null — 분석은 HEAD 를 읽는다
      expect(item.release).toBeNull();
    });

    it('캐시 HIT 이면 Sentry 를 부르지 않는다', async () => {
      const hit = { id: '1' };
      redis.getCache.mockResolvedValue(hit);
      await expect(service.getIncident('1')).resolves.toEqual({ item: hit, cached: true });
      expect(sentry.getIssue).not.toHaveBeenCalled();
    });

    it.each(['abc', '1/../../projects', '', '123456789012345678901'])(
      'id 형식 오류(%p)는 Sentry 를 부르지 않고 404 — URL 경로 조작 차단',
      async (bad) => {
        await expect(service.getIncident(bad)).rejects.toBeInstanceOf(NotFoundException);
        expect(sentry.getIssue).not.toHaveBeenCalled();
      },
    );

    it('Sentry 404 → 404, 그 밖의 실패 → 502, 미설정 → 503', async () => {
      sentry.getLatestEvent.mockResolvedValue({ entries: [] });
      sentry.getIssue.mockRejectedValue(new SentryApiError(404));
      await expect(service.getIncident('1')).rejects.toBeInstanceOf(NotFoundException);

      sentry.getIssue.mockRejectedValue(new SentryApiError(500));
      await expect(service.getIncident('1')).rejects.toBeInstanceOf(BadGatewayException);

      sentry.isEnabled.mockReturnValue(false);
      await expect(service.getIncident('1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('registerDevice', () => {
    it('(userId, 토큰) 기준 upsert — 앱이 켤 때마다 불러도 행이 늘지 않고 disabled 가 풀린다', async () => {
      await expect(
        service.registerDevice(27, { expoPushToken: 'ExponentPushToken[phone-A]', platform: 'android' }),
      ).resolves.toEqual({ registered: true });

      expect(deviceTokens.upsert).toHaveBeenCalledWith(
        { userId: 27, expoPushToken: 'ExponentPushToken[phone-A]', platform: 'android', disabledAt: null },
        { conflictPaths: ['userId', 'expoPushToken'] },
      );
    });
  });
  describe('getReleaseHealth', () => {
    /** Sentry sessions 실응답(2026-09-20 실측)에서 필요한 모양만 딴 샘플 */
    const sessions = (groups: unknown[]) => ({ groups });

    it('세션이 적어도 최신 빌드(+N 큰 쪽)를 앞에 세운다', () => {
      // 이 순서가 카드의 큰 글씨를 정한다. 세션 수로 세우면 새 빌드는 배포 직후라
      // 세션이 적어 **항상** 아래로 밀리고, 비교하려고 만든 카드가 옛 빌드를 크게 보여준다.
      const result = OpsService.toReleaseHealth(
        sessions([
          { by: { release: 'app@1.0.0+1' }, totals: { 'crash_free_rate(session)': 0.98, 'sum(session)': 420 } },
          { by: { release: 'app@1.0.0+2' }, totals: { 'crash_free_rate(session)': 1, 'sum(session)': 3 } },
        ]),
      );

      expect(result.period).toBe(OpsService.HEALTH_PERIOD);
      expect(result.releases).toEqual([
        { release: 'app@1.0.0+2', crashFreeRate: 1, sessions: 3 },
        { release: 'app@1.0.0+1', crashFreeRate: 0.98, sessions: 420 },
      ]);
    });

    it('+N 을 읽을 수 없는 이름끼리는 세션 수로 되돌아간다', () => {
      // 쇼핑몰 프론트·백엔드의 릴리즈는 커밋 SHA 라 `+N` 이 없다. 앱 프로젝트만 조회하므로
      // 정상 경로에서는 섞이지 않지만, 섞이더라도 순서가 무너지지 않아야 한다.
      const result = OpsService.toReleaseHealth(
        sessions([
          { by: { release: 'f54ba5ec9078' }, totals: { 'crash_free_rate(session)': 1, 'sum(session)': 5 } },
          { by: { release: 'e76791f92bdd' }, totals: { 'crash_free_rate(session)': 1, 'sum(session)': 40 } },
        ]),
      );

      expect(result.releases.map((r) => r.release)).toEqual(['e76791f92bdd', 'f54ba5ec9078']);
    });

    it('buildNumberOf — 끝의 +N 만 읽는다', () => {
      expect(OpsService.buildNumberOf('dev.ansmoon.opscompanion@1.0.0+2')).toBe(2);
      expect(OpsService.buildNumberOf('app@1.2.3+147')).toBe(147);
      expect(OpsService.buildNumberOf('f54ba5ec9078')).toBeNull();
      // 버전 안의 +는 끝이 아니므로 읽지 않는다
      expect(OpsService.buildNumberOf('app@1.0.0+2-rc1')).toBeNull();
    });

    it('릴리즈 이름이 없는 그룹은 버리고, 비율이 null 이면 null 로 통과시킨다', () => {
      // 세션이 0인 릴리즈에 Sentry 는 비율을 null 로 준다. 0 으로 바꾸면 "전부 크래시"로 오해된다.
      const result = OpsService.toReleaseHealth(
        sessions([
          { by: { release: null }, totals: { 'sum(session)': 5 } },
          { by: {}, totals: { 'sum(session)': 3 } },
          { by: { release: 'app@1.0.0+3' }, totals: { 'crash_free_rate(session)': null, 'sum(session)': 0 } },
        ]),
      );

      expect(result.releases).toEqual([{ release: 'app@1.0.0+3', crashFreeRate: null, sessions: 0 }]);
    });

    it('groups 가 비거나 없어도 빈 배열을 준다', () => {
      expect(OpsService.toReleaseHealth({}).releases).toEqual([]);
      expect(OpsService.toReleaseHealth(sessions([])).releases).toEqual([]);
    });

    it('캐시가 있으면 Sentry 를 부르지 않는다', async () => {
      const cachedValue = { period: '14d', releases: [] };
      redis.getCache.mockResolvedValueOnce(cachedValue);

      await expect(service.getReleaseHealth()).resolves.toEqual({ item: cachedValue, cached: true });
      expect(sentry.getSessionsByRelease).not.toHaveBeenCalled();
    });

    it('미설정이면 503, Sentry 실패면 502', async () => {
      sentry.getSessionsByRelease.mockRejectedValueOnce(new Error('boom'));
      await expect(service.getReleaseHealth()).rejects.toBeInstanceOf(BadGatewayException);

      sentry.isEnabled.mockReturnValue(false);
      await expect(service.getReleaseHealth()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
