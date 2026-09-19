import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisService } from '../intrastructure/redis/redis.service';

export type DependencyStatus = 'ok' | 'down';

export interface ReadinessResult {
  ready: boolean;
  checks: { database: DependencyStatus; redis: DependencyStatus };
}

/**
 * 의존성 하나당 확인 제한시간.
 * Redis 가 죽으면 ioredis 는 명령을 오프라인 큐에 쌓아 두고 재연결을 기다린다 — 즉 PING 이 에러 없이
 * 매달린다. compose healthcheck 의 timeout(10s) 안에 반드시 답이 나가도록 여기서 끊는다.
 */
export const READINESS_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function probe(check: () => Promise<unknown>): Promise<DependencyStatus> {
  try {
    await withTimeout(check(), READINESS_TIMEOUT_MS);
    return 'ok';
  } catch {
    return 'down';
  }
}

@Injectable()
export class AppService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  getData(): { message: string } {
    return { message: 'Hello API' };
  }

  /**
   * readiness — "요청을 받아 처리할 수 있는가".
   * 프로세스가 살아 있는지(liveness)만 보면 postgres 가 죽어도 health 가 200 이라 UptimeRobot 이
   * 못 잡는다(docs/roadmap/ex-observability-map.md §3 ⑥ 실측). 그래서 DB·Redis 를 실제로 한 번 찔러 본다.
   * 두 확인은 병렬 — 둘 다 죽어도 응답은 제한시간 한 번(2초) 안에 나간다.
   */
  async checkReadiness(): Promise<ReadinessResult> {
    const [database, redis] = await Promise.all([
      probe(() => this.dataSource.query('SELECT 1')),
      probe(() => this.redis.ping()),
    ]);
    return { ready: database === 'ok' && redis === 'ok', checks: { database, redis } };
  }
}
