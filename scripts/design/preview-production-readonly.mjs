#!/usr/bin/env node
// Public catalog checks only. No cookies, bearer tokens or write requests are forwarded.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const upstream = 'https://api.ansmoon.dev/v1';
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1:4312');
  if (request.method !== 'GET' || !/^\/v1\/(categories(?:\/\d+)?|products(?:\/\d+(?:\/reviews)?)?)$/.test(path.pathname)) {
    response.writeHead(403, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ message: 'Public catalog GET requests only' }));
  }
  try {
    const result = await fetch(`${upstream}${path.pathname.slice(3)}${path.search}`, { signal: AbortSignal.timeout(15000) });
    response.writeHead(result.status, { 'content-type': result.headers.get('content-type') || 'application/json' });
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'Public catalog upstream unavailable' }));
  }
}).listen(4312, '127.0.0.1', () => console.log('Read-only public catalog proxy: http://127.0.0.1:4312/v1'));

if (process.argv.includes('--preview')) {
  const manifest = JSON.parse(readFileSync('frontend/.next/routes-manifest.json', 'utf8'));
  const rewrites = Array.isArray(manifest.rewrites) ? manifest.rewrites : Object.values(manifest.rewrites).flat();
  const api = rewrites.find((rule) => rule.source === '/api/:path*');
  if (api?.destination !== 'http://127.0.0.1:4312/v1/:path*') throw new Error('Build must target the read-only proxy');
  spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3100'], {
    cwd: resolve('frontend'), stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', API_PROXY_TARGET: 'http://127.0.0.1:4312/v1', NEXT_PUBLIC_API_URL: '/api', SENTRY_AUTH_TOKEN: '', SENTRY_DSN: '', NEXT_PUBLIC_SENTRY_DSN: '' },
  }).on('exit', () => process.exit());
}
