#!/usr/bin/env node
/**
 * Claude Code `headersHelper` 용 — 로컬 관리자로 로그인해 `{"Authorization":"Bearer <access>"}` 를 stdout 에 쓴다.
 * (docs/roadmap/ex-mcp-practice.md §4 순서 4, D5)
 *
 *   SHOP_MCP_EMAIL=<관리자 이메일> SHOP_MCP_PASSWORD=<비밀번호> node scripts/mcp/admin-token-header.mjs
 *
 * - Claude Code 는 연결·재연결 때마다 이 스크립트를 셸에서 새로 돌리고(10초 제한), 도구 호출이 401/403 이면
 *   한 번 더 돌려 재시도한다 → access 15분 만료를 따로 처리하지 않는다. 캐시도 하지 않는다(매번 로그인).
 * - stdout 에는 헤더 JSON 한 줄만 쓴다(문자열 키·값 객체여야 한다). 실패 사유는 stderr 로.
 * - API 주소: Claude Code 가 넘기는 CLAUDE_CODE_MCP_SERVER_URL 의 origin → 없으면 SHOP_MCP_API → 기본 http://localhost:4000.
 * - 로그인 레이트리밋(IP당 10회/5분)에 걸리면 실패한다 — 연습 빈도로는 닿지 않는다.
 */

const email = process.env.SHOP_MCP_EMAIL;
const password = process.env.SHOP_MCP_PASSWORD;
if (!email || !password) {
  console.error('SHOP_MCP_EMAIL / SHOP_MCP_PASSWORD 환경변수가 필요합니다.');
  process.exit(1);
}

const serverUrl = process.env.CLAUDE_CODE_MCP_SERVER_URL;
const origin = serverUrl ? new URL(serverUrl).origin : (process.env.SHOP_MCP_API ?? 'http://localhost:4000');

try {
  const res = await fetch(`${origin}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.accessToken !== 'string') {
    console.error(`로그인 실패: HTTP ${res.status} ${body.message ?? ''}`.trim());
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ Authorization: `Bearer ${body.accessToken}` }));
} catch (error) {
  console.error(`로그인 요청 실패(${origin}): ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
