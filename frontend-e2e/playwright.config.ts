import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * 프론트 브라우저 E2E — 구매자 결제 플로우(장바구니 → 주문서 → 결제창 직전 · 결제 완료 페이지 · 로그인 가드).
 *
 * 전제(백엔드 e2e 와 같은 방식 — 서버를 "띄워 주지" 않는다):
 *   · postgres·redis + 백엔드(4000)가 떠 있을 것 — `docker compose -f docker-compose.local.yaml up -d` · `yarn nx serve backend`
 *   · 프론트는 **운영과 같은 same-origin 프록시로 빌드**돼 있을 것:
 *       NEXT_PUBLIC_API_URL=/api  API_PROXY_TARGET=http://localhost:4000/v1  next build
 *     (Git Bash 는 `/api` 를 `C:/Program Files/Git/api` 로 바꾼다 — Windows 에서는 PowerShell 로 빌드한다)
 *   · 아래 webServer 가 `next start` 를 띄운다. 로컬에서 이미 3100 이 떠 있으면 그대로 쓴다.
 *
 * 실행: `yarn e2e:frontend` (루트). CI: .github/workflows/ci.yml `frontend-e2e` job.
 * 데이터는 global-setup 이 `e2e-fe-checkout-` 접두 계정·상품으로 만들고 teardown 이 전부 지운다(개발 DB 의 다른 데이터는 건드리지 않는다).
 */
const SITE = process.env.E2E_SITE_URL ?? 'http://localhost:3100';
const PORT = new URL(SITE).port || '80';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  globalSetup: './support/global-setup.ts',
  globalTeardown: './support/global-teardown.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 스펙들이 한 구매자 계정의 장바구니를 공유하므로 직렬로 돈다(10건 안팎이라 비용이 작다)
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  outputDir: './test-results',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: SITE,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    cwd: path.join(__dirname, '..', 'frontend'),
    url: `${SITE}/login`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
