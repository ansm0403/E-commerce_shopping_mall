#!/usr/bin/env node
/**
 * Next 빌드 로그의 라우트 표를 JSON 으로 — 수정 전/후 번들 비교용(docs/roadmap/04-ai-chat-ux.md §5).
 *
 * 빌드는 PowerShell 에서(Git Bash 는 `/api` 를 경로로 바꾼다):
 *   $env:NEXT_PUBLIC_API_URL='/api'; yarn nx build frontend --skip-nx-cache *> build.log
 * 실행: node scripts/ai-chat/route-table.mjs build.log out.json            → 표를 JSON 으로 저장
 *       node scripts/ai-chat/route-table.mjs --diff before.json after.json → 달라진 라우트만 출력
 */
import { readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);

if (argv[0] === '--diff') {
  const [before, after] = [argv[1], argv[2]].map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const prev = new Map(before.routes.map((r) => [r.route, r]));
  let changed = 0;
  for (const r of after.routes) {
    const p = prev.get(r.route);
    if (p && p.size === r.size && p.firstLoad === r.firstLoad) continue;
    changed += 1;
    console.log(`${r.route}  ${p ? `${p.size} / ${p.firstLoad}` : '(없음)'}  →  ${r.size} / ${r.firstLoad}`);
  }
  for (const p of before.routes) {
    if (!after.routes.some((r) => r.route === p.route)) {
      changed += 1;
      console.log(`${p.route}  ${p.size} / ${p.firstLoad}  →  (없음)`);
    }
  }
  console.log(`shared  ${before.shared}  →  ${after.shared}`);
  console.log(`달라진 라우트 ${changed}개 / 전체 ${after.routes.length}개`);
} else {
  const [logPath, outPath] = argv;
  // PowerShell 의 `*>` 는 UTF-16 으로 쓴다 — BOM 으로 구분
  const buf = readFileSync(logPath);
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');
  const routes = [];
  let shared = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^[┌├└]\s+[○●ƒ]\s+(\/\S*)\s+([\d.]+ k?B)\s+([\d.]+ k?B)/);
    if (m) routes.push({ route: m[1], size: m[2], firstLoad: m[3] });
    const s = line.match(/First Load JS shared by all\s+([\d.]+ k?B)/);
    if (s) shared = s[1];
  }
  if (routes.length === 0) throw new Error('라우트 표를 찾지 못했습니다');
  const out = { measuredAt: new Date().toISOString(), unit: 'gzip (next build 출력)', shared, routes };
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`라우트 ${routes.length}개 · shared ${shared} → ${outPath}`);
}
