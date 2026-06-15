'use client';

import { useRef, useState } from 'react';
import { streamAssistantChat } from '../../../../../service/admin-assistant';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function AssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conversationIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  /** 마지막(assistant) 메시지에 델타를 이어붙인다. */
  const appendToLastAssistant = (delta: string) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === 'assistant') {
        next[next.length - 1] = { ...last, content: last.content + delta };
      }
      return next;
    });
    scrollToBottom();
  };

  const handleSend = async () => {
    const message = input.trim();
    if (!message || streaming) return;

    setError(null);
    setInput('');
    // 사용자 메시지 + 빈 assistant 자리(델타로 채워짐)를 한 번에 추가.
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: message },
      { role: 'assistant', content: '' },
    ]);
    scrollToBottom();

    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const ev of streamAssistantChat(
        { message, conversationId: conversationIdRef.current },
        controller.signal,
      )) {
        if (ev.type === 'meta') {
          conversationIdRef.current = ev.conversationId;
        } else if (ev.type === 'text') {
          appendToLastAssistant(ev.delta);
        } else if (ev.type === 'error') {
          setError(ev.message);
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError('응답을 받지 못했습니다. 잠시 후 다시 시도하세요.');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 전송 / Shift+Enter 줄바꿈
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 200px)',
        minHeight: 420,
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        background: '#ffffff',
        overflow: 'hidden',
      }}
    >
      {/* 메시지 영역 */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              margin: 'auto',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: 14,
              lineHeight: 1.7,
            }}
          >
            관리자 어시스턴트입니다.
            <br />
            궁금한 운영 내용을 자연어로 물어보세요.
            <br />
            <span style={{ fontSize: 12 }}>
              (현재 Phase 2 — 대화/스트리밍. 매출 등 실데이터 조회는 Phase 3 예정)
            </span>
          </div>
        )}

        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          return (
            <div
              key={i}
              style={{
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                maxWidth: '78%',
                padding: '10px 14px',
                borderRadius: 12,
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: isUser ? '#2563eb' : '#f1f5f9',
                color: isUser ? '#ffffff' : '#0f172a',
                borderTopRightRadius: isUser ? 2 : 12,
                borderTopLeftRadius: isUser ? 12 : 2,
              }}
            >
              {m.content || (streaming && !isUser ? '…' : '')}
            </div>
          );
        })}
      </div>

      {error && (
        <div
          style={{
            padding: '8px 16px',
            fontSize: 13,
            color: '#b91c1c',
            background: '#fef2f2',
            borderTop: '1px solid #fecaca',
          }}
        >
          {error}
        </div>
      )}

      {/* 입력 영역 */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: 12,
          borderTop: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
          rows={2}
          disabled={streaming}
          style={{
            flex: 1,
            resize: 'none',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 14,
            lineHeight: 1.5,
            outline: 'none',
            fontFamily: 'inherit',
            background: streaming ? '#f1f5f9' : '#ffffff',
            color: '#0f172a',
          }}
        />
        {streaming ? (
          <button
            onClick={handleStop}
            style={{
              ...buttonStyle,
              background: '#ef4444',
            }}
          >
            중지
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            style={{
              ...buttonStyle,
              background: input.trim() ? '#2563eb' : '#94a3b8',
              cursor: input.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            전송
          </button>
        )}
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 8,
  padding: '0 18px',
  color: '#ffffff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
