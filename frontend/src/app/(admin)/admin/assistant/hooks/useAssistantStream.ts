'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchConversationMessages,
  streamAssistantChat,
} from '../../../../../service/admin-assistant';

export interface ChatMessage {
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

/**
 * 어시스턴트 대화 상태 — 메시지·전송·중지·복원. UI 를 모른다(스크롤·입력창은 컴포넌트 몫).
 */
export function useAssistantStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conversationIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  // 진행 중 여부의 동기 사본 — 같은 렌더 안에서 send 가 두 번 불려도 한 번만 보낸다.
  const streamingRef = useRef(false);
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
      } else {
        // 200인데 비었음 = 없음/타인 소유 → 폐기하고 새 대화로 시작.
        storage.remove(CONVERSATION_ID_KEY);
        conversationIdRef.current = undefined;
      }
    });
  }, []);

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
  };

  /** 메시지 전송. 빈 문자열이거나 응답 중이면 아무 일도 하지 않고 false. */
  const send = useCallback((raw: string): boolean => {
    const message = raw.trim();
    if (!message || streamingRef.current) return false;

    interactedRef.current = true; // 이후 도착하는 복원 결과가 이 대화를 덮어쓰지 못하게.
    setError(null);
    // 사용자 메시지 + 빈 assistant 자리(델타로 채워짐)를 한 번에 추가.
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: message },
      { role: 'assistant', content: '' },
    ]);

    streamingRef.current = true;
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
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
        streamingRef.current = false;
        setStreaming(false);
        abortRef.current = null;
      }
    })();

    return true;
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** 새 대화 시작 — 복원 상태/저장된 id를 비운다. */
  const newChat = useCallback(() => {
    if (streamingRef.current) return;
    interactedRef.current = true;
    conversationIdRef.current = undefined;
    storage.remove(CONVERSATION_ID_KEY);
    setMessages([]);
    setError(null);
  }, []);

  return { messages, streaming, error, send, stop, newChat };
}
