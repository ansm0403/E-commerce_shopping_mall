'use client';

import { lazy, Suspense } from 'react';

/**
 * 마크다운 렌더러(react-markdown + remark-gfm)를 별도 청크로 뗀다.
 * 정적 import 면 이 라우트 First Load JS 가 228 → 273 kB(+45 kB, 측정)다. 답변이 생기기 전에는 필요 없는 코드다.
 *
 * - 청크가 오기 전에는 같은 글자를 마크다운 해석 없이 그대로 보여 준다(빈 말풍선·깜빡임 없음).
 * - preloadMarkdown(): 화면이 뜬 직후 미리 받아 두면 첫 답변부터 바로 렌더링된다.
 */
const load = () => import('./MarkdownContent');
const MarkdownContent = lazy(load);

export function preloadMarkdown(): void {
  void load();
}

export default function LazyMarkdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<span className="whitespace-pre-wrap">{text}</span>}>
      <MarkdownContent text={text} />
    </Suspense>
  );
}
