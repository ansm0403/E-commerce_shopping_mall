/* eslint-disable */
import Redis from 'ioredis';

/**
 * 로그인 레이트리밋 초기화.
 *
 * 로그인은 IP당 10회/5분으로 제한된다(auth.service.ts login → checkRateLimit).
 * 이 스위트도 로그인을 여러 번 하므로, 초기화하지 않으면 **연속 두 번째 실행부터 429** 로 죽는다.
 * 테스트가 스스로 만든 상태이므로 스스로 지우는 게 맞다 — 안 그러면 5분을 기다려야 한다.
 *
 * 지우는 키:
 *   rate:login:*      — IP 기준 레이트리밋 카운터(RedisService.checkRateLimit → `rate:${identifier}`)
 *   login:attempts:*  — 이메일 기준 로그인 실패 누적(계정 잠금 트리거)
 */
export async function resetLoginRateLimits(): Promise<void> {
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB) || 0,
    maxRetriesPerRequest: 2,
  });

  try {
    for (const pattern of ['rate:login:*', 'login:attempts:*']) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) await redis.del(...keys);
    }
  } finally {
    await redis.quit();
  }
}
