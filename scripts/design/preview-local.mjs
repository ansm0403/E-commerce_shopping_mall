#!/usr/bin/env node
/** 로컬 PostgreSQL/Redis를 사용하는 실제 API 프리뷰. 먼저 backend/frontend를 빌드한다. */
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const backend = process.argv.includes('--backend');
const load = (path) => existsSync(path) ? parse(readFileSync(path)) : {};
const env = {
  ...load('.env'), ...load('backend/.env'), ...process.env,
  NODE_ENV: 'development', NODE_SEED: 'false', SEED_PRODUCTS: 'false',
  SENTRY_DSN: '', NEXT_PUBLIC_SENTRY_DSN: '', SENTRY_AUTH_TOKEN: '',
  GEMINI_API_KEY: '', OPS_PUSH_ENABLED: 'false',
  API_PROXY_TARGET: 'http://127.0.0.1:4000/v1', NEXT_PUBLIC_API_URL: '/api',
  FRONTEND_URL: 'http://127.0.0.1:3100',
  CORS_ORIGINS: 'http://127.0.0.1:3100,http://localhost:3100',
};
if (backend && !['localhost', '127.0.0.1', '::1'].includes(env.POSTGRES_HOST || 'localhost')) {
  throw new Error('로컬 DB 호스트만 사용할 수 있습니다.');
}
const child = spawn(process.execPath,
  backend ? ['dist/main.js'] : [resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3100'],
  { cwd: resolve(backend ? 'backend' : 'frontend'), stdio: 'inherit', env: { ...env, ...(backend ? { PORT: '4000' } : { NODE_ENV: 'production' }) } },
);
child.on('exit', (code) => { process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
