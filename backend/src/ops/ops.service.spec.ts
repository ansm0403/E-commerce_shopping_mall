import { Test } from '@nestjs/testing';
import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { OpsService } from './ops.service';
import { SentryApiClient, SentryIssue } from './sentry-api.client';
import { RedisService } from '../intrastructure/redis/redis.service';

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
  let sentry: { isEnabled: jest.Mock; listIssues: jest.Mock };
  let redis: { getCache: jest.Mock; setCache: jest.Mock };

  beforeEach(async () => {
    sentry = { isEnabled: jest.fn().mockReturnValue(true), listIssues: jest.fn() };
    redis = { getCache: jest.fn().mockResolvedValue(null), setCache: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        OpsService,
        { provide: SentryApiClient, useValue: sentry },
        { provide: RedisService, useValue: redis },
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
});
