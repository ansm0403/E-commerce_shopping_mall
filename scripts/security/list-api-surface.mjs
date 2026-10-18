#!/usr/bin/env node
/**
 * API 경계 점검의 분모 — "화면이 호출하는 API 목록"과 "백엔드 전체 라우트"를 뽑아 대응표를 만든다.
 * (docs/roadmap/ex-security-api-boundary.md §4 시나리오 구성 · §6 "점검 대상 API 수")
 *
 * 공격자가 화면에서 얻는 목록과 같은 목록이어야 하므로, 클라이언트 코드에서 실제 호출을 읽는다.
 *   클라이언트: frontend/src/{service,hook,lib,app/api,app/(admin)/admin/assistant}/**, ops-companion/src/lib/api.ts
 *     - axios 인스턴스 `.get|post|patch|put|delete(<T>)?('path' | `tmpl`)` (여러 줄·제네릭 포함)
 *     - `api.request({ method, url })`, `fetch(\`${base}/path\`)` 형태
 *     - 템플릿의 ${...} 는 :param 으로, 같은 파일의 `const X = '...'` 상수는 치환
 *   백엔드: backend/src/**\/*.controller.ts 의 @Controller + @Get/@Post/... + @Roles/@UseGuards 를 TS AST 로 읽는다.
 *
 * 출력: 마크다운(표준출력). `--json <file>` 로 기계용 JSON 도 남긴다.
 * 사용: node scripts/security/list-api-surface.mjs [--json out.json]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(p) && !/\.(spec|test)\.tsx?$/.test(p) && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// ───────────────────────── 1. 클라이언트 호출 ─────────────────────────
// 프론트 전체(service 가 원칙이지만 컴포넌트·페이지에서 직접 부르는 곳이 있으면 그것도 화면이 노출하는 API 다)
const CLIENT_DIRS = ['frontend/src'].map((d) => join(ROOT, d));
const CLIENT_FILES = [...CLIENT_DIRS.flatMap((d) => walk(d)), join(ROOT, 'ops-companion/src/lib/api.ts')];

const HTTP_METHODS = new Set(['get', 'post', 'patch', 'put', 'delete']);

function normalizePath(raw) {
  // 맨 앞의 ${baseURL} 같은 호스트 변수는 경로가 아니다 — 떼어낸다
  let p = raw.trim().replace(/^\$\{[^}]*\}/, '').replace(/\$\{[^}]*\}/g, ':p');
  p = p.split('?')[0];
  if (/^https?:\/\//.test(p)) p = p.replace(/^https?:\/\/[^/]+/, '');
  p = p.replace(/^\/api(?=\/|$)/, '').replace(/^\/v1(?=\/|$)/, '');
  if (!p.startsWith('/')) p = '/' + p;
  return p.replace(/\/+$/, '') || '/';
}

function constantsOf(sf) {
  const map = new Map();
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
        (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))) {
      map.set(n.name.text, n.initializer.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return map;
}

function stringOf(node, consts) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const span of node.templateSpans) {
      const e = span.expression;
      if (ts.isIdentifier(e) && consts.has(e.text)) s += consts.get(e.text);
      else s += '${' + e.getText() + '}';
      s += span.literal.text;
    }
    return s;
  }
  if (ts.isIdentifier(node) && consts.has(node.text)) return consts.get(node.text);
  return null;
}

const clientCalls = []; // { method, path, file, line }
for (const file of CLIENT_FILES) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const consts = constantsOf(sf);
  const push = (method, raw, node) => {
    if (!raw || !raw.includes('/')) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    clientCalls.push({ method: method.toUpperCase(), path: normalizePath(raw), file: rel(file), line: line + 1 });
  };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // x.get('/path') · x.post<T>('/path', body)
      if (ts.isPropertyAccessExpression(callee) && HTTP_METHODS.has(callee.name.text)) {
        const recv = callee.expression.getText();
        if (/client|api|axios|http/i.test(recv)) push(callee.name.text, stringOf(node.arguments[0], consts), node);
      }
      // api.request({ method: 'POST', url: '...' })
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'request' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        let m = 'GET', u = null;
        for (const prop of node.arguments[0].properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = prop.name.getText();
          if (key === 'method') m = stringOf(prop.initializer, consts) ?? m;
          if (key === 'url') u = stringOf(prop.initializer, consts);
        }
        push(m, u, node);
      }
      // fetch(`${base}/v1/...`, { method }) · fetchWithAuth(...) · serverGet('/products…')(RSC) — BFF·RSC·SSE
      if (ts.isIdentifier(callee) && /^(fetch|server(Get|Fetch|Api))/i.test(callee.text)) {
        const u = stringOf(node.arguments[0], consts);
        let m = 'GET';
        const init = node.arguments[1];
        if (init && ts.isObjectLiteralExpression(init)) {
          for (const prop of init.properties) if (ts.isPropertyAssignment(prop) && prop.name.getText() === 'method') m = stringOf(prop.initializer, consts) ?? m;
        }
        const stripped = u ? u.replace(/^\$\{[^}]*\}/, '') : null;
        if (stripped && (stripped.startsWith('/') || /\/(v1|api)\//.test(stripped))) push(m, u, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// 중복 제거(메서드+경로). 이 키 수가 리포트의 "화면이 부르는 API" 수다(2026-10-18 실행 95).
// 라우트 수와 1:1 이 아니다 — 서로 다른 키가 같은 핸들러에 붙을 수 있다
// (GET /products/:p 와 GET /products/all 이 둘 다 ProductController.findOne → 서로 다른 라우트로는 94).
// 근거: docs/roadmap/ex-security-api-surface.md
const clientMap = new Map();
for (const c of clientCalls) {
  const key = `${c.method} ${c.path}`;
  if (!clientMap.has(key)) clientMap.set(key, { ...c, callers: [] });
  clientMap.get(key).callers.push(`${c.file}:${c.line}`);
}

// ───────────────────────── 2. 백엔드 라우트 ─────────────────────────
const CONTROLLERS = walk(join(ROOT, 'backend/src')).filter((f) => f.endsWith('.controller.ts'));
const routes = []; // { method, path, controller, handler, roles, guards, file }

function decoratorsOf(node) { return ts.getDecorators?.(node) ?? node.decorators ?? []; }
function decoName(d) { const e = d.expression; return ts.isCallExpression(e) ? e.expression.getText() : e.getText(); }
function decoArgs(d) { const e = d.expression; return ts.isCallExpression(e) ? e.arguments : []; }

for (const file of CONTROLLERS) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isClassDeclaration(node)) {
      const cdecos = decoratorsOf(node);
      const ctrl = cdecos.find((d) => decoName(d) === 'Controller');
      if (ctrl) {
        const prefixArg = decoArgs(ctrl)[0];
        const prefix = prefixArg && ts.isStringLiteral(prefixArg) ? prefixArg.text : '';
        const classRoles = roleNames(cdecos);
        const classGuards = guardNames(cdecos);
        for (const m of node.members) {
          if (!ts.isMethodDeclaration(m)) continue;
          const mdecos = decoratorsOf(m);
          for (const d of mdecos) {
            const n = decoName(d);
            if (!['Get', 'Post', 'Patch', 'Put', 'Delete'].includes(n)) continue;
            const a = decoArgs(d)[0];
            const sub = a && ts.isStringLiteral(a) ? a.text : '';
            const path = '/' + [prefix, sub].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\//, '');
            routes.push({
              method: n.toUpperCase(),
              path: path.replace(/:(\w+)/g, ':p'),
              rawPath: path,
              controller: node.name?.text ?? '?',
              handler: m.name.getText(),
              roles: [...new Set([...classRoles, ...roleNames(mdecos)])],
              guards: [...new Set([...classGuards, ...guardNames(mdecos)])],
              file: rel(file),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
function roleNames(decos) {
  const out = [];
  for (const d of decos) if (decoName(d) === 'Roles') for (const a of decoArgs(d)) out.push(a.getText().replace(/^Role\./, '').toLowerCase());
  return out;
}
function guardNames(decos) {
  const out = [];
  for (const d of decos) if (decoName(d) === 'UseGuards') for (const a of decoArgs(d)) out.push(a.getText());
  return out;
}

// ───────────────────────── 3. 대응 ─────────────────────────
/**
 * 라우트 매칭 — 리터럴끼리는 반드시 같아야 하고, 와일드카드 짝(:p↔:p)을 가장 높게 친다.
 * 클라이언트 `/products/${id}` 가 라우트 `/products/my` 에 붙지 않도록(그건 리터럴 'my' 와 와일드카드 → 최저점).
 */
function matchRoute(method, path) {
  const segs = path.split('/');
  let best = null, bestScore = -1;
  for (const r of routes) {
    if (r.method !== method) continue;
    const rs = r.path.split('/');
    if (rs.length !== segs.length) continue;
    let score = 0, ok = true;
    for (let i = 0; i < rs.length; i++) {
      const a = rs[i], b = segs[i];
      if (a === ':p' && b === ':p') score += 3;
      else if (a === ':p') score += 1; // 라우트 파라미터에 클라이언트 리터럴(예: /products/all → /products/:id)
      else if (b === ':p') score += 0; // 클라이언트 변수에 라우트 리터럴 — 가능하지만 최저
      else if (a === b) score += 2;
      else { ok = false; break; }
    }
    if (ok && score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

const rows = [...clientMap.values()].map((c) => ({ ...c, route: matchRoute(c.method, c.path) }))
  .sort((a, b) => (a.route?.file ?? '~').localeCompare(b.route?.file ?? '~') || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const matched = rows.filter((r) => r.route);
const unmatched = rows.filter((r) => !r.route);
const calledKeys = new Set(matched.map((r) => `${r.route.method} ${r.route.path}`));
const uncalled = routes.filter((r) => !calledKeys.has(`${r.method} ${r.path}`));

const guardLabel = (r) => {
  const bits = [];
  if (r.roles.length) bits.push(r.roles.join('|'));
  else if (r.guards.some((g) => /JwtAuthGuard/.test(g))) bits.push('로그인');
  else bits.push('공개');
  if (r.guards.some((g) => /Demo/.test(g))) bits.push('데모 차단');
  return bits.join(' · ');
};

console.log(`# API 표면 (${new Date().toISOString().slice(0, 10)})\n`);
console.log(`- 클라이언트가 호출하는 API(메서드+경로 기준): **${clientMap.size}개** (호출 지점 ${clientCalls.length}곳)`);
console.log(`- 그중 백엔드 라우트와 대응된 것: ${matched.length}개 · 대응 안 됨: ${unmatched.length}개`);
console.log(`- 백엔드 전체 라우트: ${routes.length}개 · 클라이언트가 부르지 않는 라우트: ${uncalled.length}개\n`);

console.log('## 1. 클라이언트가 호출하는 API (= 점검 대상)\n');
console.log('| # | 메서드 | 경로 | 가드 | 컨트롤러 | 호출 지점 |');
console.log('| --- | --- | --- | --- | --- | --- |');
matched.forEach((r, i) => console.log(`| ${i + 1} | ${r.method} | \`${r.path}\` | ${guardLabel(r.route)} | ${r.route.controller}.${r.route.handler} | ${r.callers[0]}${r.callers.length > 1 ? ` (+${r.callers.length - 1})` : ''} |`));

if (unmatched.length) {
  console.log('\n## 2. 백엔드 라우트와 대응되지 않은 호출 (BFF·외부·오탐)\n');
  console.log('| 메서드 | 경로 | 호출 지점 |');
  console.log('| --- | --- | --- |');
  unmatched.forEach((r) => console.log(`| ${r.method} | \`${r.path}\` | ${r.callers.join(', ')} |`));
}

console.log('\n## 3. 클라이언트가 부르지 않는 백엔드 라우트 (화면 밖 — 공격자는 알 수 없지만 존재한다)\n');
console.log('| 메서드 | 경로 | 가드 | 컨트롤러 |');
console.log('| --- | --- | --- | --- |');
uncalled.sort((a, b) => a.file.localeCompare(b.file) || a.path.localeCompare(b.path)).forEach((r) => console.log(`| ${r.method} | \`${r.rawPath}\` | ${guardLabel(r)} | ${r.controller}.${r.handler} |`));

const jsonIdx = process.argv.indexOf('--json');
if (jsonIdx > -1 && process.argv[jsonIdx + 1]) {
  writeFileSync(process.argv[jsonIdx + 1], JSON.stringify({ called: rows, routes, uncalled }, null, 2));
}
