'use client';

import { useEffect, useRef, useState } from 'react';
import {
  fetchConversationMessages,
  streamAssistantChat,
} from '../../../../../service/admin-assistant';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 새로고침 후 마지막 대화를 복원하기 위해 conversationId를 보관하는 키. */
const CONVERSATION_ID_KEY = 'assistant_conversation_id';

// localStorage 는 시크릿모드/차단 환경에서 throw 할 수 있다 → 안전 래퍼(실패는 무시).
const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 저장 실패 시 복원만 불가, 대화 자체엔 영향 없음 */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  },
};

export default function AssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conversationIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 사용자가 대화를 시작/초기화했는지. 뒤늦게 도착한 복원 결과가 진행 중 대화를 덮어쓰지 않게 가드.
  const interactedRef = useRef(false);

  // 마운트 시: localStorage의 conversationId로 직전 대화를 복원(백엔드 DB 영속화 + 소유권 검증).
  useEffect(() => {
    const saved = storage.get(CONVERSATION_ID_KEY);
    if (!saved) return;
    conversationIdRef.current = saved;
    fetchConversationMessages(saved).then((msgs) => {
      // 복원 fetch 도중 사용자가 메시지 전송/새 대화를 했다면, 결과를 적용하지 않는다(레이스 방지).
      if (interactedRef.current) return;
      if (msgs === null) return; // 일시적 실패 → id 유지(다음 새로고침/전송 시 복원·자가치유)
      if (msgs.length > 0) {
        setMessages(msgs.map((m) => ({ role: m.role, content: m.content })));
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      } else {
        // 200인데 비었음 = 없음/타인 소유 → 폐기하고 새 대화로 시작.
        storage.remove(CONVERSATION_ID_KEY);
        conversationIdRef.current = undefined;
      }
    });
  }, []);

  /** 새 대화 시작 — 복원 상태/저장된 id를 비운다. */
  const handleNewChat = () => {
    if (streaming) return;
    interactedRef.current = true;
    conversationIdRef.current = undefined;
    storage.remove(CONVERSATION_ID_KEY);
    setMessages([]);
    setError(null);
  };

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

    interactedRef.current = true; // 이후 도착하는 복원 결과가 이 대화를 덮어쓰지 못하게.
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
          // 새로고침 후 복원할 수 있도록 대화 식별자를 저장.
          storage.set(CONVERSATION_ID_KEY, ev.conversationId);
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
      {/* 헤더 — 새 대화 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      >
        <button
          onClick={handleNewChat}
          disabled={streaming || messages.length === 0}
          style={{
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 600,
            background: '#ffffff',
            color: streaming || messages.length === 0 ? '#94a3b8' : '#334155',
            cursor:
              streaming || messages.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          새 대화
        </button>
      </div>

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
              매출·주문·감사로그·상품을 실데이터로 조회합니다. 대화는 저장되어 새로고침 후에도 이어집니다.
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
