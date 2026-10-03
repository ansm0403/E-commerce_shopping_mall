'use client';

import { useAssistantStream } from '../hooks/useAssistantStream';
import Composer from './Composer';
import MessageList from './MessageList';

export default function AssistantChat() {
  const { messages, streaming, error, send, stop, newChat } = useAssistantStream();
  const newChatDisabled = streaming || messages.length === 0;

  return (
    // 100dvh — 모바일 주소창이 접히고 펼쳐질 때 100vh 는 넘치거나 남는다
    <div className="flex flex-col h-[calc(100dvh-200px)] min-h-[420px] border border-slate-200 rounded-xl bg-white overflow-hidden">
      {/* 헤더 — 새 대화 */}
      <div className="flex justify-end items-center px-3 py-2 border-b border-slate-200 bg-slate-50">
        <button
          type="button"
          onClick={newChat}
          disabled={newChatDisabled}
          className={`border border-slate-300 rounded-lg px-3 py-1.5 text-[13px] font-semibold bg-white ${
            newChatDisabled ? 'text-slate-400 cursor-not-allowed' : 'text-slate-700'
          }`}
        >
          새 대화
        </button>
      </div>

      <MessageList messages={messages} streaming={streaming} />

      {error && (
        <div className="px-4 py-2 text-[13px] text-red-700 bg-red-50 border-t border-red-200">
          {error}
        </div>
      )}

      <Composer streaming={streaming} onSend={send} onStop={stop} />
    </div>
  );
}
