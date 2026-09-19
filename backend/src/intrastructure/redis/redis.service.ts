import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.module';

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // ===== 연결 확인 (GET /v1/health readiness) =====
  /** 연결이 끊겨 있으면 ioredis 는 에러 대신 재연결까지 대기한다 — 제한시간은 호출하는 쪽이 건다. */
  async ping(): Promise<string> {
    return this.redis.ping();
  }

  // ===== 로그인 시도 횟수 관리 =====
  async incrementLoginAttempts(email: string): Promise<number> {
    const key = `login:attempts:${email}`;
    const attempts = await this.redis.incr(key);

    if (attempts === 1) {
      await this.redis.expire(key, 900); // 15분
    }

    return attempts;
  }

  async getLoginAttempts(email: string): Promise<number> {
    const key = `login:attempts:${email}`;
    const attempts = await this.redis.get(key);
    return attempts ? parseInt(attempts) : 0;
  }

  async resetLoginAttempts(email: string): Promise<void> {
    await this.redis.del(`login:attempts:${email}`);
  }

  async getLoginAttemptsRemainingTime(email: string): Promise<number> {
    const key = `login:attempts:${email}`;
    return await this.redis.ttl(key);
  }

  // ===== Access Token 블랙리스트 =====
  async addToBlacklist(token: string, expiresIn: number): Promise<void> {
    const key = `blacklist:${token}`;
    await this.redis.setex(key, expiresIn, '1');
  }

  async isBlacklisted(token: string): Promise<boolean> {
    const key = `blacklist:${token}`;
    const result = await this.redis.get(key);
    return result === '1';
  }

  // ===== Refresh Token 저장 (빠른 검증용) =====
  async storeRefreshToken(
    userId: number,
    tokenId: string,
    expiresIn: number,
  ): Promise<void> {
    const key = `refresh:${userId}:${tokenId}`;
    await this.redis.setex(key, expiresIn, '1');
  }

  async isRefreshTokenValid(userId: number, tokenId: string): Promise<boolean> {
    const key = `refresh:${userId}:${tokenId}`;
    const result = await this.redis.get(key);
    return result === '1';
  }

  async revokeRefreshToken(userId: number, tokenId: string): Promise<void> {
    const key = `refresh:${userId}:${tokenId}`;
    await this.redis.del(key);
  }

  async revokeAllUserRefreshTokens(userId: number): Promise<void> {
    const pattern = `refresh:${userId}:*`;
    const keys = await this.redis.keys(pattern);

    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  // ===== 사용자 세션 관리 =====
  async getUserActiveSessions(userId: number): Promise<string[]> {
    const pattern = `refresh:${userId}:*`;
    return await this.redis.keys(pattern);
  }

  // ===== 이메일 인증 토큰 =====
  async storeEmailVerificationToken(
    userId: number,
    token: string,
    expiresIn = 3600,
  ): Promise<void> {
    const key = `email:verify:${token}`;
    await this.redis.setex(key, expiresIn, userId.toString());
  }

  async getEmailVerificationUserId(token: string): Promise<number | null> {
    const key = `email:verify:${token}`;
    const userId = await this.redis.get(key);

    if (userId) {
      await this.redis.del(key); // 일회용
      return parseInt(userId);
    }

    return null;
  }

  // ===== 이메일 인증 쿨다운 =====
  async setEmailVerificationCooldown(userId: number, cooldownSeconds = 180): Promise<void> {
    const key = `email:cooldown:${userId}`;
    await this.redis.setex(key, cooldownSeconds, '1');
  }

  async getEmailVerificationCooldown(userId: number): Promise<number> {
    const key = `email:cooldown:${userId}`;
    const ttl = await this.redis.ttl(key);
    return ttl > 0 ? ttl : 0;
  }

  // ===== OTP (2FA) 관리 =====
  async storeOTP(userId: number, code: string, expiresIn = 300): Promise<void> {
    const key = `otp:${userId}`;
    await this.redis.setex(key, expiresIn, code);
  }

  async verifyOTP(userId: number, code: string): Promise<boolean> {
    const key = `otp:${userId}`;
    const storedCode = await this.redis.get(key);

    if (storedCode === code) {
      await this.redis.del(key);
      return true;
    }

    return false;
  }

  // ===== Rate Limiting (특정 IP/User) =====
  async checkRateLimit(
    identifier: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const key = `rate:${identifier}`;
    const current = await this.redis.incr(key);

    if (current === 1) {
      await this.redis.expire(key, windowSeconds);
    }

    return current <= limit;
  }

  // ===== 캐싱 =====
  async getCache<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  }

  async setCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
  }

  async delCache(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async delCacheByPattern(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
