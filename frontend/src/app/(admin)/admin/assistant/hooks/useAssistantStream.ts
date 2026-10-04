'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelAssistantStream,
  fetchConversationMessages,
  streamAssistantChat,
} from '../../../../../service/admin-assistant';
import { applyStreamEvent, closeInterrupted, type ChatMessage } from '../lib/chat-message';

export type { ChatMessage };

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

/** 스트림 식별자. randomUUID 는 보안 컨텍스트(https·localhost)에서만 있다 → 없으면 시각+난수로. */
function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * 어시스턴트 대화 상태 — 메시지·전송·중지·복원. UI 를 모른다(스크롤·입력창은 컴포넌트 몫).
 */
export function useAssistantStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conversationIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  // 진행 중인 스트림의 id — 중지할 때 서버에 이 값으로 알린다.
  const requestIdRef = useRef<string | null>(null);
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

  /** 진행 중인 마지막(assistant) 메시지를 바꾼다. 바뀐 게 없으면 리렌더하지 않는다. */
  const updateLastAssistant = (update: (message: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant') return prev;
      const updated = update(last);
      return updated === last ? prev : [...prev.slice(0, -1), updated];
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
    const requestId = newRequestId();
    requestIdRef.current = requestId;

    void (async () => {
      let finished = false; // done 을 받았는가 — 못 받고 끝나면(중지·오류·끊김) 진행 표시를 닫아 준다
      try {
        for await (const ev of streamAssistantChat(
          { message, conversationId: conversationIdRef.current, requestId },
          controller.signal,
        )) {
          if (ev.type === 'meta') {
            conversationIdRef.current = ev.conversationId;
            // 새로고침 후 복원할 수 있도록 대화 식별자를 저장.
            storage.set(CONVERSATION_ID_KEY, ev.conversationId);
          } else if (ev.type === 'text' || ev.type === 'tool' || ev.type === 'done') {
            if (ev.type === 'done') finished = true;
            updateLastAssistant((m) => applyStreamEvent(m, ev));
          } else if (ev.type === 'error') {
            setError(ev.message);
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError('응답을 받지 못했습니다. 잠시 후 다시 시도하세요.');
        }
      } finally {
        if (!finished) {
          const byUser = controller.signal.aborted;
          updateLastAssistant((m) => closeInterrupted(m, byUser));
        }
        streamingRef.current = false;
        setStreaming(false);
        abortRef.current = null;
        requestIdRef.current = null;
      }
    })();

    return true;
  }, []);

  const stop = useCallback(() => {
    // 서버에 먼저 알리고(프록시가 연결 끊김을 전달하지 않는 운영 경로 대비) 화면 쪽 읽기를 끊는다.
    if (requestIdRef.current) void cancelAssistantStream(requestIdRef.current);
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
