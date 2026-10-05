/** buyer-flow 확인 스크립트 공용 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * 로컬 Redis 의 로그인 횟수 제한을 비운다(backend-e2e/src/support/redis.ts 와 같은 키).
 *
 * 로그인은 IP 당 10회/5분이라, 확인 스크립트를 몇 개 이어 돌리면 429 가 난다.
 * 특히 비밀번호 변경 스크립트는 끝에서 다시 로그인해 비밀번호를 **복원**해야 하므로 429 면 계정이 임시 비밀번호로 남는다.
 * ⚠ 루트 .env 의 Redis(=로컬 개발용)만 건드린다. 운영에는 쓰지 않는다.
 */
export async function resetLoginRateLimits() {
  require('dotenv').config({ path: join(ROOT, '.env') });
  const Redis = require('ioredis');
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB) || 0,
    maxRetriesPerRequest: 2,
  });
  try {
    let removed = 0;
    for (const pattern of ['rate:login:*', 'login:attempts:*']) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) removed += await redis.del(...keys);
    }
    return removed;
  } finally {
    await redis.quit();
  }
}
