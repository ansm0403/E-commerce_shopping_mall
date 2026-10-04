import type { ChatMessage } from '../lib/chat-message';
import ToolStatus from './ToolStatus';

interface Props {
  message: ChatMessage;
  /** 응답이 진행 중인 마지막 assistant 메시지 */
  pending: boolean;
}

export default function MessageBubble({ message, pending }: Props) {
  const isUser = message.role === 'user';
  const hasTools = !isUser && !!message.tools?.length;
  // 아직 글자가 없을 때: 도구 진행 표시가 있으면 그것이 "기다리는 중"을 대신하고, 없으면 `…`
  const body = message.content || (pending && !hasTools ? '…' : '');

  return (
    <>
      {hasTools && <ToolStatus tools={message.tools ?? []} />}
      {body && (
        <div
          className={`max-w-[92%] md:max-w-[78%] px-3.5 py-2.5 rounded-xl text-sm leading-[1.6] whitespace-pre-wrap break-words ${
            isUser
              ? 'self-end bg-blue-600 text-white rounded-tr-sm'
              : 'self-start bg-slate-100 text-slate-900 rounded-tl-sm'
          }`}
        >
          {body}
        </div>
      )}
      {message.stopped && <p className="self-start m-0 -mt-2 pl-1 text-xs text-slate-500">중지됨</p>}
    </>
  );
}
