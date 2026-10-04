'use client';

import { useEffect, useRef, useState } from 'react';
import { useAssistantStream } from '../hooks/useAssistantStream';
import { nextAnnouncement } from '../lib/announcement';
import Composer from './Composer';
import MessageList from './MessageList';

/** 끝 알림을 포커스 이동 뒤로 미루는 시간. 포커스 안내가 먼저 시작되게만 하면 된다. */
const END_ANNOUNCEMENT_DELAY_MS = 400;

export default function AssistantChat() {
  const { messages, streaming, error, send, stop, newChat } = useAssistantStream();
  const newChatDisabled = streaming || messages.length === 0;

  // 스크린리더 알림: 상태가 바뀔 때만 문구를 바꾼다("응답 생성 중" → "○○ 조회 중" → "응답 완료. 본문").
  const [announcement, setAnnouncement] = useState('');
  const wasStreamingRef = useRef(false);
  const delayedRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const ended = wasStreamingRef.current && !streaming;
    const next = nextAnnouncement(wasStreamingRef.current, streaming, messages[messages.length - 1]);
    wasStreamingRef.current = streaming;
    if (next === null) return;
    if (delayedRef.current) clearTimeout(delayedRef.current);
    if (!ended) {
      setAnnouncement(next);
      return;
    }
    // 끝났을 때(완료·중지)는 조금 늦게 알린다. 같은 순간 중지 버튼이 사라지며 포커스가 입력창으로 돌아가는데,
    // 스크린리더는 포커스가 바뀌면 하던 말을 끊고 새 포커스를 읽는다 → 동시에 넣은 알림이 묻혔다(NVDA 청취로 발견).
    delayedRef.current = setTimeout(() => setAnnouncement(next), END_ANNOUNCEMENT_DELAY_MS);
  }, [messages, streaming]);
  useEffect(() => () => void (delayedRef.current && clearTimeout(delayedRef.current)), []);

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

      <MessageList messages={messages} streaming={streaming} onPickSuggestion={send} />

      {/* 눈에는 안 보이는 알림 영역 — 처음부터 DOM 에 있어야 스크린리더가 변화를 읽는다 */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {error && (
        <div role="alert" className="px-4 py-2 text-[13px] text-red-700 bg-red-50 border-t border-red-200">
          {error}
        </div>
      )}

      <Composer streaming={streaming} onSend={send} onStop={stop} />
    </div>
  );
}
