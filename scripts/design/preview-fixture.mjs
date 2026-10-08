#!/usr/bin/env node
/** 로컬 UI 확인 전용. 이미 조회한 공개 JSON을 사용하며 GET 외 요청은 모두 거절한다. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const readJson = (path) =>
  JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const products = readJson('tmp/ui-public-catalog.json');
const categories = readJson('tmp/ui-public-categories.json');
const descendants = (node) => [node.id, ...node.children.flatMap(descendants)];
const categoryNodes = categories.flatMap((node) => [node, ...node.children]);
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  const send = (value, status = 200) => {
    response.statusCode = status;
    response.end(JSON.stringify(value));
  };
  if (request.method !== 'GET')
    return send({ message: 'Read-only UI preview' }, 405);
  const url = new URL(request.url, 'http://127.0.0.1:4310');
  const path = url.pathname.replace(/^\/v1/, '');
  if (path === '/categories') return send(categories);
  if (path === '/products') {
    const q = url.searchParams;
    const category = categoryNodes.find(
      (node) => node.id === Number(q.get('categoryId'))
    );
    const ids = category ? descendants(category) : null;
    const keyword = (q.get('keyword') || '').toLowerCase();
    const sortBy = q.get('sortBy') || 'createdAt';
    const direction = q.get('sortOrder') === 'ASC' ? 1 : -1;
    const list = products
      .filter(
        (product) =>
          (!ids || ids.includes(product.categoryId)) &&
          (!keyword || product.name.toLowerCase().includes(keyword))
      )
      .sort((a, b) => {
        const first =
          sortBy === 'createdAt' ? Date.parse(a[sortBy]) : Number(a[sortBy]);
        const second =
          sortBy === 'createdAt' ? Date.parse(b[sortBy]) : Number(b[sortBy]);
        return direction * (first - second || a.id - b.id);
      });
    const page = Math.max(1, Number(q.get('page')) || 1);
    const take = Math.max(1, Math.min(100, Number(q.get('take')) || 20));
    return send({
      data: list.slice((page - 1) * take, page * take),
      meta: {
        total: list.length,
        page,
        take,
        lastPage: Math.ceil(list.length / take),
        hasNextPage: page * take < list.length,
        hasPreviousPage: page > 1,
      },
    });
  }
  const detail = path.match(/^\/products\/(\d+)$/);
  if (detail) {
    const product = products.find((item) => item.id === Number(detail[1]));
    return product ? send(product) : send({ message: 'Not found' }, 404);
  }
  if (/^\/products\/\d+\/review-summary$/.test(path))
    return send({ status: 'insufficient_reviews', summary: null });
  if (/^\/reviews\/product\/\d+\/summary$/.test(path))
    return send({
      average: 0,
      count: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  if (/^\/reviews\/product\/\d+$/.test(path))
    return send({
      data: [],
      meta: { total: 0, page: 1, lastPage: 0, take: 10 },
    });
  return send({ message: 'UI preview endpoint unavailable' }, 404);
});
server.listen(4310, '127.0.0.1', () =>
  console.log('Read-only catalog fixture: http://127.0.0.1:4310')
);
const child = spawn(
  process.execPath,
  [
    resolve('node_modules/next/dist/bin/next'),
    process.argv.includes('--production') ? 'start' : 'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    '3100',
  ],
  {
    cwd: resolve('frontend'),
    stdio: 'inherit',
    env: {
      ...process.env,
      API_PROXY_TARGET: 'http://127.0.0.1:4310/v1',
      NEXT_PUBLIC_API_URL: '/api',
      SENTRY_AUTH_TOKEN: '',
      NEXT_PUBLIC_SENTRY_DSN: '',
      SENTRY_DSN: '',
    },
  }
);
child.on('exit', () => server.close());
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    child.kill();
    server.close();
  });
