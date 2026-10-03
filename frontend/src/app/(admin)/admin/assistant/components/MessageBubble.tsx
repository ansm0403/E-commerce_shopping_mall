import type { ChatMessage } from '../hooks/useAssistantStream';

interface Props {
  message: ChatMessage;
  /** 응답을 기다리는 중인 빈 assistant 말풍선 — 내용 대신 `…` */
  pending: boolean;
}

export default function MessageBubble({ message, pending }: Props) {
  const isUser = message.role === 'user';
  return (
    <div
      className={`max-w-[92%] md:max-w-[78%] px-3.5 py-2.5 rounded-xl text-sm leading-[1.6] whitespace-pre-wrap break-words ${
        isUser
          ? 'self-end bg-blue-600 text-white rounded-tr-sm'
          : 'self-start bg-slate-100 text-slate-900 rounded-tl-sm'
      }`}
    >
      {message.content || (pending ? '…' : '')}
    </div>
  );
}
