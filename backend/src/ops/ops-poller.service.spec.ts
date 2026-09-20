import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OpsPollerService } from './ops-poller.service';
import { SentryApiClient, SentryIssueListItem } from './sentry-api.client';
import { OpsDeviceTokenEntity } from './entity/ops-device-token.entity';
import { OpsPollStateEntity } from './entity/ops-poll-state.entity';
import { OpsPushLogEntity } from './entity/ops-push-log.entity';

/**
 * 폴링 → 푸시 판정. 여기서 틀리면 새벽에 폰이 쉬지 않고 울거나, 반대로 장애를 놓친다.
 * 실제 Sentry 응답 모양(2026-09-20 실측)을 그대로 쓴다 — count 는 문자열, project 는 중첩 객체.
 */
const issue = (over: Partial<SentryIssueListItem> = {}): SentryIssueListItem => ({
  id: '7742806178',
  title: 'AxiosError: Network Error',
  level: 'error',
  count: '4',
  lastSeen: '2026-09-20T12:05:00Z',
  project: { slug: 'e-commerse-frontend' },
  substatus: 'new',
  ...over,
});

const NOW = new Date('2026-09-20T12:10:00Z');
/** 커서: 이 시각 이후에 발생한 것만 후보가 된다 */
const CURSOR = new Date('2026-09-20T12:00:00Z');

describe('OpsPollerService', () => {
  let service: OpsPollerService;
  let sentry: { isEnabled: jest.Mock; listIssues: jest.Mock };
  let pollState: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let deviceTokens: { find: jest.Mock; update: jest.Mock };
  let pushLog: { query: jest.Mock };
  let sendSpy: jest.SpyInstance;
  let env: Record<string, string>;

  /** 기본: Sentry 켜짐 · 커서 있음 · 기기 1대 · 선점 성공 · 전송 성공 */
  const build = async (overrides: Record<string, string> = {}) => {
    env = { ...overrides };
    sentry = { isEnabled: jest.fn().mockReturnValue(true), listIssues: jest.fn().mockResolvedValue([]) };
    pollState = {
      findOne: jest.fn().mockResolvedValue({ source: 'sentry', lastSeenAt: CURSOR, lastIssueId: null }),
      save: jest.fn(),
      create: jest.fn((v) => v),
    };
    deviceTokens = {
      find: jest.fn().mockResolvedValue([
        { userId: 27, expoPushToken: 'ExponentPushToken[phone-A]', disabledAt: null },
      ]),
      update: jest.fn(),
    };
    pushLog = { query: jest.fn().mockResolvedValue([{ id: 1 }]) };

    const module = await Test.createTestingModule({
      providers: [
        OpsPollerService,
        { provide: SentryApiClient, useValue: sentry },
        { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
        { provide: getRepositoryToken(OpsPollStateEntity), useValue: pollState },
        { provide: getRepositoryToken(OpsDeviceTokenEntity), useValue: deviceTokens },
        { provide: getRepositoryToken(OpsPushLogEntity), useValue: pushLog },
      ],
    }).compile();

    service = module.get(OpsPollerService);
    // ExpoPushClient 는 service 가 직접 new 한다(설정값 주입) — 전송만 가로챈다.
    sendSpy = jest
      .spyOn(Object.getPrototypeOf(service['expo']) as { send: () => unknown }, 'send')
      .mockImplementation(async (messages: unknown) =>
        (messages as Array<{ to: string }>).map((m) => ({ token: m.to, ok: true })),
      );
    return service;
  };

  afterEach(() => jest.restoreAllMocks());

  describe('발송 여부', () => {
    it('커서보다 새로운 error 이슈는 보낸다', async () => {
      await build();
      sentry.listIssues.mockResolvedValue([issue()]);

      const out = await service.poll(NOW);

      expect(out).toEqual({ status: 'polled', candidates: 1, sent: 1 });
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const [messages] = sendSpy.mock.calls[0] as [Array<Record<string, unknown>>];
      expect(messages[0]).toEqual({
        to: 'ExponentPushToken[phone-A]',
        title: '🚨 e-commerse-frontend',
        body: 'AxiosError: Network Error (4회)',
        data: { incidentId: '7742806178', url: '/incidents/7742806178' },
        channelId: 'incidents',
        priority: 'high',
      });
    });

    it.each([
      ['warning', 'warning'],
      ['info', 'info'],
    ])('level %s 은 폰을 울리지 않는다', async (_label, level) => {
      await build();
      sentry.listIssues.mockResolvedValue([issue({ level })]);

      const out = await service.poll(NOW);

      expect(out.candidates).toBe(0);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('앱 자신(ops-companion)의 이슈는 제외한다 — 푸시→앱 열기→또 죽는 되먹임 차단', async () => {
      await build();
      sentry.listIssues.mockResolvedValue([issue({ project: { slug: 'ops-companion' } })]);

      expect((await service.poll(NOW)).candidates).toBe(0);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('커서보다 오래된 이슈는 이미 본 것이라 다시 보내지 않는다', async () => {
      await build();
      sentry.listIssues.mockResolvedValue([issue({ lastSeen: '2026-09-20T11:59:00Z' })]);

      expect((await service.poll(NOW)).candidates).toBe(0);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('fatal 은 🔥 로 구분하고, 1회 발생이면 횟수를 붙이지 않는다', async () => {
      await build();
      sentry.listIssues.mockResolvedValue([issue({ level: 'fatal', count: '1' })]);

      await service.poll(NOW);

      const [messages] = sendSpy.mock.calls[0] as [Array<{ title: string; body: string }>];
      expect(messages[0].title).toBe('🔥 e-commerse-frontend');
      expect(messages[0].body).toBe('AxiosError: Network Error');
    });
  });

  describe('멱등과 쿨다운', () => {
    it('선점(claim)에 실패하면(쿨다운 중) 전송하지 않는다', async () => {
      await build();
      sentry.listIssues.mockResolvedValue([issue()]);
      pushLog.query.mockResolvedValue([]); // ON CONFLICT ... WHERE 가 걸러 RETURNING 이 비었다

      const out = await service.poll(NOW);

      expect(out).toEqual({ status: 'polled', candidates: 1, sent: 0 });
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('선점 SQL 에 쿨다운 기준 시각(6시간 전)이 들어간다', async () => {
      await build();
      sentry.listIssues.mockResolvedValue([issue()]);

      await service.poll(NOW);

      const [sql, params] = pushLog.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/ON CONFLICT \(incident_id, user_id\) DO UPDATE/);
      expect(params[0]).toBe('7742806178');
      expect(params[1]).toBe(27);
      expect(params[3]).toEqual(new Date('2026-09-20T06:10:00Z'));
    });

    it('쿨다운 시간은 환경변수로 바꿀 수 있다', async () => {
      await build({ OPS_PUSH_COOLDOWN_HOURS: '1' });
      sentry.listIssues.mockResolvedValue([issue()]);

      await service.poll(NOW);

      const [, params] = pushLog.query.mock.calls[0] as [string, unknown[]];
      expect(params[3]).toEqual(new Date('2026-09-20T11:10:00Z'));
    });

    it('전송이 통째로 실패하면 선점을 되돌린다 — 다음 주기에 다시 시도', async () => {
      await build();
      sentry.listIssues.mockResolvedValue([issue()]);
      sendSpy.mockResolvedValue([{ token: 'ExponentPushToken[phone-A]', ok: false, error: 'request_failed' }]);

      const out = await service.poll(NOW);

      expect(out.sent).toBe(0);
      const release = pushLog.query.mock.calls[1]?.[0] as string;
      expect(release).toMatch(/DELETE FROM ops_push_log/);
      expect(deviceTokens.update).not.toHaveBeenCalled();
    });

    it('DeviceNotRegistered 토큰은 발송 대상에서 빼고(disabled) 선점도 되돌린다', async () => {
      await build();
      sentry.listIssues.mockResolvedValue([issue()]);
      sendSpy.mockResolvedValue([
        { token: 'ExponentPushToken[phone-A]', ok: false, error: 'DeviceNotRegistered' },
      ]);

      await service.poll(NOW);

      expect(deviceTokens.update).toHaveBeenCalledWith(
        { expoPushToken: 'ExponentPushToken[phone-A]' },
        { disabledAt: NOW },
      );
      expect(pushLog.query.mock.calls[1]?.[0]).toMatch(/DELETE FROM ops_push_log/);
    });

    it('한 기기에 여러 이슈를 보냈다가 전부 실패하면 선점을 이슈마다 되돌린다', async () => {
      // 2026-09-20 스모크에서 밟은 버그: 토큰을 키로 짝지어 마지막 이슈만 되돌려졌고
      // 앞의 이슈들은 발송 기록이 남아 쿨다운 6시간 동안 다시 울리지 않았다.
      await build();
      sentry.listIssues.mockResolvedValue([
        issue({ id: 'A', lastSeen: '2026-09-20T12:02:00Z' }),
        issue({ id: 'B', lastSeen: '2026-09-20T12:04:00Z' }),
        issue({ id: 'C', lastSeen: '2026-09-20T12:06:00Z' }),
      ]);
      sendSpy.mockImplementation(async (messages: unknown) =>
        (messages as Array<{ to: string }>).map((m) => ({
          token: m.to,
          ok: false,
          error: 'DeviceNotRegistered',
        })),
      );

      const out = await service.poll(NOW);

      expect(out).toEqual({ status: 'polled', candidates: 3, sent: 0 });
      // 선점 3건(A·B·C) + 되돌림 3건
      const released = pushLog.query.mock.calls
        .filter((c) => (c[0] as string).includes('DELETE FROM ops_push_log'))
        .map((c) => (c[1] as unknown[])[0]);
      expect(released.sort()).toEqual(['A', 'B', 'C']);
    });

    it('기기 2대 중 한 대만 성공하면 선점을 유지한다(중복 발송 방지)', async () => {
      await build();
      deviceTokens.find.mockResolvedValue([
        { userId: 27, expoPushToken: 'ExponentPushToken[phone-A]', disabledAt: null },
        { userId: 27, expoPushToken: 'ExponentPushToken[tablet-B]', disabledAt: null },
      ]);
      sentry.listIssues.mockResolvedValue([issue()]);
      sendSpy.mockResolvedValue([
        { token: 'ExponentPushToken[phone-A]', ok: true },
        { token: 'ExponentPushToken[tablet-B]', ok: false, error: 'MessageRateExceeded' },
      ]);

      const out = await service.poll(NOW);

      expect(out.sent).toBe(1);
      expect(pushLog.query).toHaveBeenCalledTimes(1); // 선점만, 되돌림 없음
    });
  });

  describe('커서', () => {
    it('첫 실행은 커서만 심고 아무것도 보내지 않는다 — 지난 24시간이 한꺼번에 울리는 것을 막는다', async () => {
      await build();
      pollState.findOne.mockResolvedValue(null);

      const out = await service.poll(NOW);

      expect(out).toEqual({ status: 'seeded', candidates: 0, sent: 0 });
      expect(pollState.save).toHaveBeenCalledWith({ source: 'sentry', lastSeenAt: NOW });
      expect(sentry.listIssues).not.toHaveBeenCalled();
    });

    it('기준에 안 맞아 버린 이슈까지 포함해 가장 최근 lastSeen 으로 전진한다', async () => {
      await build();
      sentry.listIssues.mockResolvedValue([
        issue({ id: '1', lastSeen: '2026-09-20T12:09:00Z', level: 'warning' }), // 후보 아님
        issue({ id: '2', lastSeen: '2026-09-20T12:04:00Z' }),
      ]);

      await service.poll(NOW);

      expect(pollState.save).toHaveBeenCalledWith(
        expect.objectContaining({ lastSeenAt: new Date('2026-09-20T12:09:00Z'), lastIssueId: '2' }),
      );
    });

    it('새 것이 없으면 커서를 저장하지 않는다', async () => {
      await build();
      sentry.listIssues.mockResolvedValue([issue({ lastSeen: '2026-09-20T11:00:00Z' })]);

      await service.poll(NOW);

      expect(pollState.save).not.toHaveBeenCalled();
    });

    it('오래된 이슈부터 처리한다(커서 단조 증가)', async () => {
      await build();
      sentry.listIssues.mockResolvedValue([
        issue({ id: 'newer', lastSeen: '2026-09-20T12:08:00Z' }),
        issue({ id: 'older', lastSeen: '2026-09-20T12:02:00Z' }),
      ]);

      await service.poll(NOW);

      expect(pushLog.query.mock.calls.map((c) => (c[1] as unknown[])[0])).toEqual(['older', 'newer']);
    });
  });

  describe('비활성 경로 — 아무 일도 하지 않는다', () => {
    it('Sentry 키가 없으면 건너뛴다(로컬 기본)', async () => {
      await build();
      sentry.isEnabled.mockReturnValue(false);

      expect(await service.poll(NOW)).toEqual({ status: 'skipped', candidates: 0, sent: 0 });
      expect(pollState.findOne).not.toHaveBeenCalled();
    });

    it('OPS_PUSH_ENABLED=false 면 건너뛴다', async () => {
      await build({ OPS_PUSH_ENABLED: 'false' });
      expect((await service.poll(NOW)).status).toBe('skipped');
    });

    it('등록된 기기가 없으면 전송을 시도하지 않는다', async () => {
      await build();
      deviceTokens.find.mockResolvedValue([]);
      sentry.listIssues.mockResolvedValue([issue()]);

      const out = await service.poll(NOW);

      expect(out).toEqual({ status: 'polled', candidates: 1, sent: 0 });
      expect(pushLog.query).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('cron 은 폴링 예외를 삼킨다 — 스케줄러에서 던지면 미처리 거부가 된다', async () => {
      await build();
      sentry.listIssues.mockRejectedValue(new Error('Sentry API responded 500'));

      await expect(service.handleCron()).resolves.toBeUndefined();
      expect(pollState.save).not.toHaveBeenCalled();
    });
  });
});
