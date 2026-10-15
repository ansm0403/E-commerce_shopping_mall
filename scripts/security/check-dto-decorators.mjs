#!/usr/bin/env node
/**
 * whitelist 회귀 점검 — @Body()/@Query() 로 받는 클래스의 모든 속성에 class-validator 데코레이터가 있는가.
 *
 * 왜: ValidationPipe({ whitelist: true }) 는 class-validator 메타데이터가 **없는** 속성을 "모르는 필드"로 보고
 * 조용히 버린다. `@Type()`·`@Transform()`(class-transformer) 만 붙은 속성도 버려진다. 즉 데코레이터가 빠진
 * 정상 필드가 있으면 whitelist 를 켠 순간 그 필드가 서버에 도착하지 않는 회귀가 생긴다.
 * (docs/roadmap/ex-security-api-boundary.md §3 회귀 위험표 "데코레이터 없는 속성")
 *
 * 하는 일:
 *   1. backend/src/**\/*.controller.ts 에서 `@Body(...) x: Foo` / `@Query(...) x: Foo` 의 클래스 이름을 모은다.
 *   2. 각 클래스 선언을 backend/src 에서 찾아 TypeScript AST 로 읽고, 상속(extends Bar / extends PartialType(Bar))을 따라간다.
 *   3. 속성마다 데코레이터의 import 출처를 보고 분류한다.
 *        class-validator 에서 온 것         → OK (whitelist 통과)
 *        class-transformer 만 있는 것        → 버려짐 (실패)
 *        데코레이터 없음                      → 버려짐 (실패)
 *        프로젝트 내부 데코레이터(상대 경로)  → 확인 필요(registerDecorator 를 쓰면 OK)
 *
 * 사용: node scripts/security/check-dto-decorators.mjs   (종료 코드: 실패 속성이 있으면 1)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'backend/src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const sources = new Map(files.map((f) => [f, ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true)]));

// 1. 컨트롤러에서 @Body/@Query 로 바인딩되는 클래스 이름
const boundTypes = new Map(); // name -> Set<controller file>
for (const [file, sf] of sources) {
  if (!file.endsWith('.controller.ts')) continue;
  const visit = (node) => {
    if (ts.isParameter(node) && node.type && ts.isTypeReferenceNode(node.type)) {
      const decos = ts.getDecorators?.(node) ?? node.decorators ?? [];
      const isBound = decos.some((d) => {
        const expr = d.expression;
        const name = ts.isCallExpression(expr) ? expr.expression.getText(sf) : expr.getText(sf);
        return name === 'Body' || name === 'Query';
      });
      if (isBound) {
        const typeName = node.type.typeName.getText(sf);
        if (/^[A-Z]/.test(typeName) && !['Record', 'Partial', 'Object', 'String', 'Number', 'Boolean', 'Array'].includes(typeName)) {
          if (!boundTypes.has(typeName)) boundTypes.set(typeName, new Set());
          boundTypes.get(typeName).add(file.replace(ROOT + '\\', '').replace(ROOT + '/', ''));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// 2. 클래스 선언 찾기
function findClass(name) {
  for (const [file, sf] of sources) {
    let found = null;
    const visit = (node) => {
      if (found) return;
      if (ts.isClassDeclaration(node) && node.name?.text === name) found = { file, sf, node };
      else ts.forEachChild(node, visit);
    };
    visit(sf);
    if (found) return found;
  }
  return null;
}

function importSourceOf(sf, identifier) {
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings) continue;
    const nb = st.importClause.namedBindings;
    if (ts.isNamedImports(nb) && nb.elements.some((e) => e.name.text === identifier)) {
      return st.moduleSpecifier.text;
    }
  }
  return null; // 같은 파일에서 정의됐거나 import 를 못 찾음
}

const results = []; // { cls, prop, verdict, detail, file }
const seen = new Set();
const nestedTargets = []; // [className, via] — @Type(() => X) 로 발견한 중첩 DTO

function analyze(name, via) {
  if (seen.has(name)) return;
  seen.add(name);
  const hit = findClass(name);
  if (!hit) {
    results.push({ cls: name, prop: '(클래스 선언을 backend/src 에서 못 찾음)', verdict: 'CHECK', detail: via, file: '' });
    return;
  }
  const { file, sf, node } = hit;
  const rel = file.replace(ROOT + '\\', '').replace(ROOT + '/', '');

  for (const member of node.members) {
    if (!ts.isPropertyDeclaration(member)) continue;
    const prop = member.name.getText(sf);
    const decos = ts.getDecorators?.(member) ?? member.decorators ?? [];
    let hasValidator = false;
    let hasTransformerOnly = false;
    const unknown = [];
    for (const d of decos) {
      const expr = d.expression;
      const id = ts.isCallExpression(expr) ? expr.expression.getText(sf) : expr.getText(sf);
      const src = importSourceOf(sf, id);
      if (src === 'class-validator') hasValidator = true;
      else if (src === 'class-transformer') hasTransformerOnly = true;
      else unknown.push(`${id}←${src ?? 'local'}`);
    }
    // 중첩 DTO: @Type(() => Foo) 가 있으면 Foo 안에서도 whitelist 가 돌므로(ValidateNested) Foo 도 분석한다.
    for (const d of decos) {
      const expr = d.expression;
      if (!ts.isCallExpression(expr) || expr.expression.getText(sf) !== 'Type') continue;
      const arg = expr.arguments[0];
      if (arg && ts.isArrowFunction(arg)) {
        const body = arg.body;
        const target = ts.isIdentifier(body) ? body.text : null;
        if (target && /^[A-Z]/.test(target) && !['Number', 'String', 'Boolean', 'Date', 'Array', 'Object'].includes(target)) {
          nestedTargets.push([target, `${name}.${prop} @Type`]);
        }
      }
    }
    if (hasValidator) continue;
    if (unknown.length) results.push({ cls: name, prop, verdict: 'CHECK', detail: `프로젝트 데코레이터 ${unknown.join(', ')}`, file: rel });
    else if (hasTransformerOnly) results.push({ cls: name, prop, verdict: 'FAIL', detail: 'class-transformer 만 — whitelist 가 버린다', file: rel });
    else results.push({ cls: name, prop, verdict: 'FAIL', detail: '데코레이터 없음 — whitelist 가 버린다', file: rel });
  }

  // 상속: extends Foo | extends PartialType(Foo) | extends IntersectionType(A, B) …
  for (const hc of node.heritageClauses ?? []) {
    if (hc.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const t of hc.types) {
      const expr = t.expression;
      if (ts.isIdentifier(expr)) analyze(expr.text, `${name} extends`);
      else if (ts.isCallExpression(expr)) {
        for (const arg of expr.arguments) if (ts.isIdentifier(arg)) analyze(arg.text, `${name} extends ${expr.expression.getText(sf)}(…)`);
      }
    }
  }
}

for (const name of [...boundTypes.keys()].sort()) analyze(name, [...boundTypes.get(name)].join(', '));
// 중첩 DTO 는 큐가 비울 때까지 따라간다(중첩 안의 중첩 포함)
let nestedCount = 0;
while (nestedTargets.length) {
  const [target, via] = nestedTargets.shift();
  if (seen.has(target)) continue;
  nestedCount++;
  analyze(target, via);
}

// 3. 출력
const fails = results.filter((r) => r.verdict === 'FAIL');
const checks = results.filter((r) => r.verdict === 'CHECK');
console.log(`@Body/@Query 로 바인딩되는 클래스 ${boundTypes.size}개, 상속 포함 분석 ${seen.size}개 (그중 @Type 중첩 DTO ${nestedCount}개)`);
console.log(`whitelist 가 버릴 속성(FAIL): ${fails.length}개 · 확인 필요(CHECK): ${checks.length}개\n`);
for (const r of [...fails, ...checks]) console.log(`${r.verdict.padEnd(5)} ${r.cls}.${r.prop}  — ${r.detail}  [${r.file}]`);
if (fails.length === 0 && checks.length === 0) console.log('모든 속성에 class-validator 데코레이터가 있다.');
process.exit(fails.length ? 1 : 0);
