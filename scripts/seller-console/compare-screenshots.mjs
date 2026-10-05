#!/usr/bin/env node
/**
 * 두 벌의 스크린샷을 바이트 단위로 비교한다(sha256).
 *
 *   node scripts/seller-console/compare-screenshots.mjs <폴더> <접두A> <접두B>
 *
 * `<접두A>-*.png` 마다 같은 이름의 `<접두B>-*.png` 를 찾아 해시를 댄다. 하나라도 다르거나 짝이 없으면 종료 코드 1.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [dir, a, b] = process.argv.slice(2);
if (!dir || !a || !b) throw new Error('사용법: compare-screenshots.mjs <폴더> <접두A> <접두B>');

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const names = readdirSync(dir)
  .filter((f) => f.startsWith(`${a}-`) && f.endsWith('.png'))
  .map((f) => f.slice(a.length + 1))
  .sort();
if (names.length === 0) throw new Error(`${dir} 에 ${a}-*.png 가 없다`);

let different = 0;
for (const name of names) {
  const fileA = join(dir, `${a}-${name}`);
  const fileB = join(dir, `${b}-${name}`);
  if (!existsSync(fileB)) {
    different += 1;
    console.log(`✗ ${name} — ${b} 쪽 파일 없음`);
    continue;
  }
  const [hashA, hashB] = [sha(fileA), sha(fileB)];
  const same = hashA === hashB;
  if (!same) different += 1;
  console.log(`${same ? '✓' : '✗'} ${name} ${hashA.slice(0, 12)}${same ? '' : ` ≠ ${hashB.slice(0, 12)}`}`);
}
console.log(`\n${names.length - different}/${names.length} 동일 (${a} ↔ ${b})`);
process.exit(different ? 1 : 0);
