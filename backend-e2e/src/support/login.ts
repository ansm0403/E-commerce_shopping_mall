import axios, { AxiosResponse } from 'axios';
import { resetLoginRateLimits } from './redis';
import { E2E_PASSWORD } from './db';

/**
 * 공용 로그인 헬퍼 — 429 이면 레이트리밋을 비우고 재시도한다.
 *
 * 로그인은 IP당 10회/5분 제한인데, jest 가 스펙 파일들을 병렬 실행하면 각 스펙의
 * beforeAll 로그인이 한 창구(IP)로 몰려 스펙 수가 늘수록 429 가 난다. 스펙마다
 * beforeAll 에서 resetLoginRateLimits() 를 불러도, "모든 스펙이 먼저 리셋 → 그 뒤
 * 로그인이 몰리는" 인터리빙이면 소용없다. 그래서 리셋을 로그인 실패 시점으로 옮겼다.
 * (개발 DB 전용 하네스라 리밋 초기화가 안전하다 — support/redis.ts 참고)
 */

/** 로그인 원응답(쿠키 등 헤더가 필요한 스펙용). 201 이 아닐 때까지 최대 3회 재시도. */
export async function loginRaw(email: string): Promise<AxiosResponse> {
  for (let attempt = 0; ; attempt++) {
    const res = await axios.post('/auth/login', { email, password: E2E_PASSWORD });
    if (res.status === 201) return res;
    if (res.status === 429 && attempt < 3) {
      await resetLoginRateLimits();
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }
    throw new Error(`e2e 로그인 실패(${email}): HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
}

export async function login(email: string): Promise<{ accessToken: string }> {
  const res = await loginRaw(email);
  return { accessToken: res.data.accessToken as string };
}
