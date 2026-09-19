import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { RedisService } from '../intrastructure/redis/redis.service';
import { AppService, READINESS_TIMEOUT_MS } from './app.service';

describe('AppService', () => {
  let service: AppService;
  const dataSource = { query: jest.fn() };
  const redis = { ping: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const app = await Test.createTestingModule({
      providers: [
        AppService,
        { provide: DataSource, useValue: dataSource },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = app.get<AppService>(AppService);
  });

  afterEach(() => jest.useRealTimers());

  describe('getData', () => {
    it('should return "Hello API"', () => {
      expect(service.getData()).toEqual({ message: 'Hello API' });
    });
  });

  describe('checkReadiness', () => {
    it('DB·Redis 가 모두 응답하면 ready', async () => {
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
      redis.ping.mockResolvedValue('PONG');

      await expect(service.checkReadiness()).resolves.toEqual({
        ready: true,
        checks: { database: 'ok', redis: 'ok' },
      });
      expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('DB 쿼리가 실패하면 database=down 이고 ready 가 아니다', async () => {
      dataSource.query.mockRejectedValue(new Error('connect ECONNREFUSED'));
      redis.ping.mockResolvedValue('PONG');

      await expect(service.checkReadiness()).resolves.toEqual({
        ready: false,
        checks: { database: 'down', redis: 'ok' },
      });
    });

    it('Redis PING 이 응답 없이 매달려도 제한시간 뒤 redis=down 으로 끝난다', async () => {
      // ioredis 는 연결이 끊기면 명령을 오프라인 큐에 쌓아 두고 기다린다 — 에러가 아니라 무응답이다.
      jest.useFakeTimers();
      dataSource.query.mockResolvedValue([]);
      redis.ping.mockReturnValue(new Promise(() => undefined));

      const pending = service.checkReadiness();
      await jest.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);

      await expect(pending).resolves.toEqual({
        ready: false,
        checks: { database: 'ok', redis: 'down' },
      });
    });
  });
});
