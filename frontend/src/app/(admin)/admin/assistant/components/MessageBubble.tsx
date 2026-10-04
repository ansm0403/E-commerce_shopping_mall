import { memo } from 'react';
import type { ChatMessage } from '../lib/chat-message';
import LazyMarkdown from './LazyMarkdown';
import ToolStatus from './ToolStatus';

interface Props {
  message: ChatMessage;
  /** 응답이 진행 중인 마지막 assistant 메시지 */
  pending: boolean;
}

/**
 * memo: 스트리밍 중에는 마지막 메시지 객체만 바뀐다(훅이 나머지를 그대로 둔다).
 * 그래서 이미 끝난 말풍선은 다시 그려지지 않고, 마크다운 재파싱도 마지막 말풍선에서만 일어난다.
 */
function MessageBubble({ message, pending }: Props) {
  const isUser = message.role === 'user';
  const hasTools = !isUser && !!message.tools?.length;
  // 아직 글자가 없을 때: 도구 진행 표시가 있으면 그것이 "기다리는 중"을 대신하고, 없으면 `…`
  const waiting = !message.content && pending && !hasTools;

  return (
    <>
      {hasTools && <ToolStatus tools={message.tools ?? []} />}
      {(message.content || waiting) && (
        <div
          className={`max-w-[92%] md:max-w-[78%] px-3.5 py-2.5 rounded-xl text-sm leading-[1.6] break-words ${
            isUser
              ? 'self-end bg-blue-600 text-white rounded-tr-sm whitespace-pre-wrap'
              : 'self-start bg-slate-100 text-slate-900 rounded-tl-sm'
          }`}
        >
          {/* 사용자가 친 글은 글자 그대로, 어시스턴트 답변만 마크다운으로 */}
          {waiting ? '…' : isUser ? message.content : <LazyMarkdown text={message.content} />}
        </div>
      )}
      {message.stopped && <p className="self-start m-0 -mt-2 pl-1 text-xs text-slate-500">중지됨</p>}
    </>
  );
}

export default memo(MessageBubble);
