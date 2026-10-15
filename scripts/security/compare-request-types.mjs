#!/usr/bin/env node
/**
 * D 시나리오(정상 요청)의 정적 선행 점검 — 클라이언트가 보내는 본문 타입의 키가 백엔드 DTO 에 전부 선언돼 있는가.
 *
 * whitelist(버리기)에서는 DTO 밖의 키가 조용히 사라지고, forbidNonWhitelisted(거절)에서는 400 이 된다.
 * 그래서 거절 모드를 켜기 전에 "화면이 보내는 키 ⊆ DTO 키" 를 확인한다(docs/roadmap/ex-security-api-boundary.md §3 회귀 위험표
 * "프론트의 여분 필드"·"운영 앱"). 실제 요청으로 확인하는 것은 backend-e2e/src/security 의 D 스펙이고, 이 스크립트는 그 전 단계다.
 *
 * 대응 규칙: `XxxRequest`(shared) ↔ `XxxDto`(backend). 예외는 아래 MAP 에 적는다.
 * 프론트 타입은 shared/src/lib/types, 운영 앱 타입은 ops-companion/src/lib/api.ts 에서 읽는다.
 * Partial<X>·Pick<X,…>·PartialType(X)·extends 는 따라간다.
 *
 * 사용: node scripts/security/compare-request-types.mjs   (키 불일치가 있으면 종료 코드 1)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
const load = (files) => new Map(files.map((f) => [f, ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true)]));
const CLIENT = load([...walk(join(ROOT, 'shared/src/lib/types')), join(ROOT, 'ops-companion/src/lib/api.ts'), ...walk(join(ROOT, 'frontend/src/service')), ...walk(join(ROOT, 'frontend/src/model'))]);
const BACKEND = load(walk(join(ROOT, 'backend/src')));

/** 클라이언트 타입(interface/type alias)의 속성 키 집합. Partial/Pick/Omit/교차·확장 처리 */
function clientKeys(name, depth = 0) {
  if (depth > 6) return null;
  for (const [, sf] of CLIENT) {
    let found = null;
    const visit = (n) => {
      if (found) return;
      if ((ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) && n.name.text === name) found = n;
      else ts.forEachChild(n, visit);
    };
    visit(sf);
    if (!found) continue;
    const keys = new Map(); // key -> optional?
    if (ts.isInterfaceDeclaration(found)) {
      for (const m of found.members) if (ts.isPropertySignature(m)) keys.set(m.name.getText(sf), !!m.questionToken);
      for (const hc of found.heritageClauses ?? []) for (const t of hc.types) {
        const parent = clientKeys(t.expression.getText(sf), depth + 1);
        if (parent) for (const [k, v] of parent) if (!keys.has(k)) keys.set(k, v);
      }
      return keys;
    }
    return typeNodeKeys(found.type, sf, depth);
  }
  return null;
}
function typeNodeKeys(t, sf, depth) {
  if (ts.isTypeLiteralNode(t)) {
    const keys = new Map();
    for (const m of t.members) if (ts.isPropertySignature(m)) keys.set(m.name.getText(sf), !!m.questionToken);
    return keys;
  }
  if (ts.isTypeReferenceNode(t)) {
    const tn = t.typeName.getText(sf);
    const args = t.typeArguments ?? [];
    if (tn === 'Partial' && args[0]) { const k = typeNodeKeys(args[0], sf, depth + 1); return k && new Map([...k].map(([a]) => [a, true])); }
    if (tn === 'Required' && args[0]) { const k = typeNodeKeys(args[0], sf, depth + 1); return k && new Map([...k].map(([a]) => [a, false])); }
    if ((tn === 'Pick' || tn === 'Omit') && args[0] && args[1]) {
      const base = typeNodeKeys(args[0], sf, depth + 1); if (!base) return null;
      const names = new Set();
      const collect = (u) => { if (ts.isLiteralTypeNode(u) && ts.isStringLiteral(u.literal)) names.add(u.literal.text); else if (ts.isUnionTypeNode(u)) u.types.forEach(collect); };
      collect(args[1]);
      return new Map([...base].filter(([k]) => (tn === 'Pick') === names.has(k)));
    }
    return clientKeys(tn, depth + 1);
  }
  if (ts.isIntersectionTypeNode(t)) {
    const keys = new Map();
    for (const part of t.types) { const k = typeNodeKeys(part, sf, depth + 1); if (k) for (const [a, b] of k) keys.set(a, b); }
    return keys;
  }
  return null;
}

/** 백엔드 DTO 클래스의 속성 키(optional 여부는 @IsOptional 로 판정). extends Foo / PartialType(Foo) / IntersectionType(A,B) 처리 */
function dtoKeys(name, depth = 0) {
  if (depth > 6) return null;
  for (const [file, sf] of BACKEND) {
    let found = null;
    const visit = (n) => { if (found) return; if (ts.isClassDeclaration(n) && n.name?.text === name) found = n; else ts.forEachChild(n, visit); };
    visit(sf);
    if (!found) continue;
    const keys = new Map();
    for (const m of found.members) {
      if (!ts.isPropertyDeclaration(m)) continue;
      const decos = ts.getDecorators?.(m) ?? m.decorators ?? [];
      const optional = !!m.questionToken || decos.some((d) => /^IsOptional\b/.test(d.expression.getText(sf)));
      keys.set(m.name.getText(sf), optional);
    }
    for (const hc of found.heritageClauses ?? []) for (const t of hc.types) {
      const e = t.expression;
      const addParent = (pn, forceOptional) => { const p = dtoKeys(pn, depth + 1); if (p) for (const [k, v] of p.keys) if (!keys.has(k)) keys.set(k, forceOptional || v); };
      if (ts.isIdentifier(e)) addParent(e.text, false);
      else if (ts.isCallExpression(e)) {
        const fn = e.expression.getText(sf);
        for (const a of e.arguments) if (ts.isIdentifier(a)) addParent(a.text, fn === 'PartialType');
      }
    }
    return { keys, file: rel(file) };
  }
  return null;
}

// 클라이언트 타입 → DTO 대응. 기본 규칙 XxxRequest → XxxDto, 예외는 명시.
const MAP = {
  LoginRequest: 'LoginDto', RegisterRequest: 'RegisterDto', ApplySellerRequest: 'ApplySellerDto',
  CreateProductRequest: 'CreateProductDto', UpdateProductRequest: 'UpdateProductDto', UpdateProductStatusRequest: 'UpdateProductStatusDto',
  ShipOrderRequest: 'ShipOrderDto', CreateInquiryRequest: 'CreateInquiryDto', AnswerInquiryRequest: 'AnswerInquiryDto',
  CreateReviewRequest: 'CreateReviewDto@review', UpdateReviewRequest: 'UpdateReviewDto@review', CreateOrderRequest: 'CreateOrderDto',
  VerifyPaymentRequest: 'VerifyPaymentDto', CancelPaymentRequest: 'CancelPaymentDto', ToggleWishlistRequest: 'ToggleWishlistDto',
  UpdateProfileRequest: 'UpdateProfileDto', ChangePasswordRequest: 'ChangePasswordDto',
  RejectProductRequest: 'RejectProductDto', RejectSellerRequest: 'RejectSellerDto',
  // 운영 앱(ops-companion/src/lib/api.ts)
  ReviewInput: 'CreateReviewDto@ops', // ops 의 CreateReviewDto 는 review 모듈과 이름이 겹친다 → 파일로 구분
};
// 인라인 리터럴 본문(타입 이름이 없는 호출) — 키를 직접 적는다
const INLINE = {
  'cart.addCartItem → AddCartItemDto': { keys: ['productId', 'quantity'], dto: 'AddCartItemDto' },
  'cart.updateCartItem → UpdateCartItemDto': { keys: ['quantity'], dto: 'UpdateCartItemDto' },
  'wishlist.toggleWishlist → ToggleWishlistDto': { keys: ['productId'], dto: 'ToggleWishlistDto' },
  'auth.demoLogin → (parseDemoRole, DTO 없음)': { keys: ['role'], dto: null },
  'auth.resendVerificationEmail → CheckEmailDto?': { keys: ['email'], dto: 'CheckEmailDto' },
  'admin-order.deliverOrder → @Body(sellerId) (DTO 없음)': { keys: ['sellerId'], dto: null },
  'demo-checkout.createDemoCheckout → CreateDemoCheckoutDto': { keys: ['requestId'], dto: 'CreateDemoCheckoutDto' },
  'ops.registerDevice → RegisterDeviceDto': { keys: ['expoPushToken', 'platform'], dto: 'RegisterDeviceDto' },
  'ops.logout → RefreshDto': { keys: ['refreshToken'], dto: 'RefreshDto' },
  'admin-assistant.cancel → CancelStreamDto': { keys: ['requestId'], dto: 'CancelStreamDto' },
};

/** `Name@folder` — 같은 이름의 DTO 가 여러 모듈에 있을 때(review·ops 의 CreateReviewDto) 폴더로 구분한다 */
function findDto(spec) {
  const [name, tag] = spec.split('@');
  if (tag) {
    for (const [file, sf] of BACKEND) {
      if (!file.replace(/\\/g, '/').includes(`/${tag}/`)) continue;
      let found = null;
      const visit = (n) => { if (found) return; if (ts.isClassDeclaration(n) && n.name?.text === name) found = n; else ts.forEachChild(n, visit); };
      visit(sf);
      if (found) {
        const keys = new Map();
        for (const m of found.members) if (ts.isPropertyDeclaration(m)) {
          const decos = ts.getDecorators?.(m) ?? m.decorators ?? [];
          keys.set(m.name.getText(sf), !!m.questionToken || decos.some((d) => /^IsOptional\b/.test(d.expression.getText(sf))));
        }
        return { keys, file: rel(file) };
      }
    }
    return null;
  }
  return dtoKeys(name);
}

let problems = 0;
console.log('| 클라이언트 타입 | DTO | 프론트만 보내는 키(버려짐/거절) | DTO 필수인데 프론트에 없는 키 | 판정 |');
console.log('| --- | --- | --- | --- | --- |');
for (const [cname, dspec] of Object.entries(MAP)) {
  const ck = clientKeys(cname);
  const dto = findDto(dspec);
  if (!ck) { console.log(`| ${cname} | ${dspec} | (클라이언트 타입 못 찾음) | | CHECK |`); problems++; continue; }
  if (!dto) { console.log(`| ${cname} | ${dspec} | (DTO 못 찾음) | | CHECK |`); problems++; continue; }
  const extra = [...ck.keys()].filter((k) => !dto.keys.has(k));
  const missingRequired = [...dto.keys].filter(([k, opt]) => !opt && !ck.has(k)).map(([k]) => k);
  const verdict = extra.length ? 'FAIL' : missingRequired.length ? 'WARN' : 'OK';
  if (verdict === 'FAIL') problems++;
  console.log(`| ${cname} | ${dspec.replace(/@(\w+)/, ' ($1)')} | ${extra.join(', ') || '—'} | ${missingRequired.join(', ') || '—'} | ${verdict} |`);
}
for (const [label, { keys, dto: dname }] of Object.entries(INLINE)) {
  if (!dname) { console.log(`| ${label} | — | (DTO 없음: 파이프 미적용) | | INFO |`); continue; }
  const dto = dtoKeys(dname);
  if (!dto) { console.log(`| ${label} | ${dname} | (DTO 못 찾음) | | CHECK |`); problems++; continue; }
  const extra = keys.filter((k) => !dto.keys.has(k));
  const missingRequired = [...dto.keys].filter(([k, opt]) => !opt && !keys.includes(k)).map(([k]) => k);
  const verdict = extra.length ? 'FAIL' : missingRequired.length ? 'WARN' : 'OK';
  if (verdict === 'FAIL') problems++;
  console.log(`| ${label} | ${dname} | ${extra.join(', ') || '—'} | ${missingRequired.join(', ') || '—'} | ${verdict} |`);
}
console.log(`\n불일치(FAIL/CHECK): ${problems}건`);
process.exit(problems ? 1 : 0);
