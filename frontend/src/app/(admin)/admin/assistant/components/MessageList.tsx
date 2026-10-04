'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../lib/chat-message';
import EmptyState from './EmptyState';
import { preloadMarkdown } from './LazyMarkdown';
import MessageBubble from './MessageBubble';

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  onPickSuggestion: (question: string) => void;
}

export default function MessageList({ messages, streaming, onPickSuggestion }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 첫 화면을 그린 뒤 마크다운 렌더러를 미리 받아 둔다(First Load 에는 넣지 않되 첫 답변 전에 준비).
  useEffect(() => {
    preloadMarkdown();
  }, []);

  // 메시지가 바뀔 때마다(전송·델타·복원) 맨 아래로.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col gap-3.5 p-3 md:p-5">
      {messages.length === 0 && <EmptyState onPick={onPickSuggestion} />}

      {messages.map((m, i) => (
        <MessageBubble
          key={i}
          message={m}
          pending={streaming && m.role === 'assistant' && i === messages.length - 1}
        />
      ))}
    </div>
  );
}
