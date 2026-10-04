'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../lib/chat-message';
import EmptyState from './EmptyState';
import { preloadMarkdown } from './LazyMarkdown';
import MessageBubble from './MessageBubble';

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  onPickSuggestion: (question: string) => void;
}

/** 바닥에서 이 거리 안에 있으면 "바닥을 보고 있다"고 본다 — 새 글자를 따라간다. */
const STICK_THRESHOLD_PX = 80;

export default function MessageList({ messages, streaming, onPickSuggestion }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 사용자가 바닥 근처를 보고 있는가. 스크롤할 때마다 갱신한다(렌더와 무관하므로 ref).
  const stickRef = useRef(true);
  const lengthRef = useRef(0);
  // 위로 올려 읽는 중에 새 글자가 왔다 → "새 응답 ↓" 버튼
  const [hasUnseen, setHasUnseen] = useState(false);

  // 첫 화면을 그린 뒤 마크다운 렌더러를 미리 받아 둔다(First Load 에는 넣지 않되 첫 답변 전에 준비).
  useEffect(() => {
    preloadMarkdown();
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setHasUnseen(false);
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD_PX;
    stickRef.current = nearBottom;
    if (nearBottom) setHasUnseen(false);
  };

  // 메시지가 바뀌었을 때:
  //  - 개수가 달라졌다(전송·복원·새 대화) → 무조건 맨 아래로. 내가 방금 보낸 질문은 보여야 한다.
  //  - 내용만 늘었다(스트리밍 델타) → 바닥 근처를 보고 있을 때만 따라간다. 위로 올려 읽는 중이면 끌고 가지 않는다.
  useEffect(() => {
    const countChanged = messages.length !== lengthRef.current;
    lengthRef.current = messages.length;
    const frame = requestAnimationFrame(() => {
      if (countChanged || stickRef.current) scrollToBottom();
      else setHasUnseen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, scrollToBottom]);

  return (
    <div className="relative flex-1 min-h-0">
      {/* 스크롤 영역은 키보드로도 움직일 수 있어야 한다(tabIndex) — 방향키·PageUp/Down.
          목록 자체에는 aria-live 를 걸지 않는다(조각 읽기 방지) — 알림은 AssistantChat 의 role="status" 가 맡는다. */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        tabIndex={0}
        role="region"
        aria-label="대화 내용"
        aria-busy={streaming}
        className="h-full overflow-y-auto flex flex-col gap-3.5 p-3 md:p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
      >
        {messages.length === 0 && <EmptyState onPick={onPickSuggestion} />}

        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            message={m}
            pending={streaming && m.role === 'assistant' && i === messages.length - 1}
          />
        ))}
      </div>

      {hasUnseen && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-slate-800 text-white text-[13px] font-semibold shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          새 응답 <span aria-hidden="true">↓</span>
        </button>
      )}
    </div>
  );
}
