'use client';

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../hooks/useAssistantStream';
import EmptyState from './EmptyState';
import MessageBubble from './MessageBubble';

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
}

export default function MessageList({ messages, streaming }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
      {messages.length === 0 && <EmptyState />}

      {messages.map((m, i) => (
        <MessageBubble key={i} message={m} pending={streaming && m.role === 'assistant'} />
      ))}
    </div>
  );
}
