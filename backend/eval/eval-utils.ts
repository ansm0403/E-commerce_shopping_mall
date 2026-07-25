/**
 * Phase 7 eval 공용 유틸 — 429(rate limit) 백오프.
 *
 * run-eval.ts(7-2)에서 추출해 run-judge.ts(7-3)와 공유한다(로직 무변경).
 * 무료티어 실측 근거(§8-13(1)): flash-lite RPM=15/분, 429 응답 본문이
 * "Please retry in 24.6s" / retryDelay:"24s" 형태로 재시도 대기를 명시한다.
 * → 대기 시간 = max(서버 지정 retryDelay + 1초, 지수 백오프 5→15→45초).
 */

export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function is429(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  const msg = String((e as Error)?.message ?? e);
  return status === 429 || /\b429\b|RESOURCE_EXHAUSTED|Too Many Requests/i.test(msg);
}

/**
 * 429 응답 본문에서 서버가 지정한 재시도 대기(초)를 파싱.
 * 파싱 실패 시 null(지수 백오프 폴백).
 */
export function parseRetryDelayMs(e: unknown): number | null {
  const msg = String((e as Error)?.message ?? e);
  const m = /retry in (\d+(?:\.\d+)?)s/i.exec(msg) ?? /"retryDelay"\s*:\s*"(\d+)s"/.exec(msg);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

/**
 * 429 면 최대 3회 재시도. 대기 시간은 max(서버 지정 retryDelay + 1초, 지수 백오프 5→15→45초).
 * (7-2 1차 전체 실행에서 1→2→4초로는 RPM 창이 안 열려 1건이 채점 불가로 남은 교훈.)
 * 그 외 에러는 즉시 throw.
 */
export async function callWithRetry429<T>(fn: () => Promise<T>): Promise<T> {
  const backoffs = [5_000, 15_000, 45_000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      if (!is429(e) || attempt >= backoffs.length) throw e;
      const serverMs = parseRetryDelayMs(e);
      const wait = Math.max(serverMs != null ? serverMs + 1_000 : 0, backoffs[attempt]);
      console.log(
        `    ⏳ 429(rate limit) — ${Math.round(wait / 1000)}초 후 재시도 (${attempt + 1}/${backoffs.length}` +
          `${serverMs != null ? `, 서버 지정 ${Math.round(serverMs / 1000)}s` : ''})`,
      );
      await sleep(wait);
    }
  }
}
