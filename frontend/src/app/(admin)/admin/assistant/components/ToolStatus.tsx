import { toolStatusText, type ToolRun } from '../lib/chat-message';

interface Props {
  tools: ToolRun[];
}

/** 답변을 만들며 조회한 데이터 — 실행 중엔 회전 표시, 끝나면 체크로 바뀌어 말풍선 위에 남는다. */
export default function ToolStatus({ tools }: Props) {
  return (
    <ul className="self-start m-0 p-0 list-none flex flex-col gap-1">
      {tools.map((tool, i) => (
        <li
          key={i}
          className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full border border-slate-200 bg-white text-xs text-slate-600"
        >
          <ToolIcon status={tool.status} />
          {toolStatusText(tool)}
          {tool.status === 'running' && '…'}
        </li>
      ))}
    </ul>
  );
}

/** 상태 아이콘은 장식이다 — 상태는 옆의 글자("조회 중/완료/중단")가 전한다 */
function ToolIcon({ status }: { status: ToolRun['status'] }) {
  if (status === 'running') {
    return (
      <span
        aria-hidden="true"
        className="inline-block w-3 h-3 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin motion-reduce:animate-none"
      />
    );
  }
  return (
    <span aria-hidden="true" className={status === 'done' ? 'text-green-700' : 'text-slate-500'}>
      {status === 'done' ? '✓' : '–'}
    </span>
  );
}
