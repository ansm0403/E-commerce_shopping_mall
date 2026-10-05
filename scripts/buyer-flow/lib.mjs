/** buyer-flow 확인 스크립트 공용 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** 단색 PNG 를 만든다(업로드 확인용 — 진짜 이미지여야 브라우저가 그린다) */
export function makePng(size = 64, [r, g, b] = [79, 70, 229]) {
  const zlib = require('node:zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
