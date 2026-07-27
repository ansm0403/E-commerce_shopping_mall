/* eslint-disable */
import { waitForPortOpen } from '@nx/node/utils';

/**
 * e2e 는 "이미 떠 있는 백엔드"를 대상으로 돈다 — 서버를 직접 띄우지도, 죽이지도 않는다.
 * (개발 중 4000 을 이미 쓰고 있는 경우가 흔해서, serve 를 의존성으로 걸면 EADDRINUSE 로 충돌한다)
 *
 * 사전 조건: postgres·redis + `yarn nx serve backend` 가 떠 있을 것.
 */
module.exports = async function () {
  const host = process.env.HOST ?? 'localhost';
  const port = process.env.PORT ? Number(process.env.PORT) : 4000;

  try {
    await waitForPortOpen(port, { host, retries: 10, retryDelay: 500 });
  } catch {
    throw new Error(
      `\n백엔드에 연결할 수 없습니다 (http://${host}:${port}).\n` +
        `e2e 는 실행 중인 서버를 대상으로 동작합니다. 다음을 먼저 띄워주세요:\n` +
        `  1) docker compose -f docker-compose.local.yaml up -d   (postgres·redis)\n` +
        `  2) yarn nx serve backend\n`,
    );
  }

  console.log(`\n[e2e] 대상 서버: http://${host}:${port}/v1\n`);
};
