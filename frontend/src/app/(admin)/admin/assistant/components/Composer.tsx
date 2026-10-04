'use client';

import { useEffect, useId, useRef, useState } from 'react';

interface Props {
  streaming: boolean;
  /** 전송을 받아들였으면 true — 그때만 입력창을 비운다 */
  onSend: (message: string) => boolean;
  onStop: () => void;
}

const BUTTON =
  'px-[18px] rounded-lg text-white text-sm font-semibold whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

export default function Composer({ streaming, onSend, onStop }: Props) {
  const [input, setInput] = useState('');
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const canSend = input.trim().length > 0;

  // 마지막 조작이 키보드였는가(마우스·터치였는가). 포커스를 되돌릴지 정하는 데 쓴다.
  const lastInputRef = useRef<'keyboard' | 'pointer'>('keyboard');
  useEffect(() => {
    const onKey = () => (lastInputRef.current = 'keyboard');
    const onPointer = () => (lastInputRef.current = 'pointer');
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);

  // 응답이 시작되거나 끝나면 전송·중지 버튼이 서로 바뀐다. 포커스가 사라지는 버튼에 있었다면 갈 곳을 잃으므로
  // (body 로 빠진다) 입력창으로 돌린다 — **키보드로 조작한 경우에만.**
  //  - 마우스·터치로 누른 사람의 포커스는 옮기지 않는다: 스크린리더가 입력창 안내를 읽느라 "응답 완료" 알림이 묻히고
  //    (NVDA 청취로 발견), 폰에서는 답변 직후 화면 키보드가 튀어나온다.
  //  - 사용자가 다른 곳으로 옮겨 둔 포커스도 건드리지 않는다(body 일 때만).
  // (두 버튼에 key 를 주는 이유: 같은 자리의 같은 태그라 React 가 DOM 노드를 재사용하면, 포커스가
  //  disabled 가 된 "전송" 버튼에 남아 body 로 빠지는 시점을 여기서 잡을 수 없다 — 실측)
  useEffect(() => {
    if (
      document.activeElement === document.body &&
      lastInputRef.current === 'keyboard'
    ) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [streaming]);

  const submit = () => {
    if (onSend(input)) setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return; // Shift+Enter 줄바꿈
    // 한글 IME 조합 중 Enter 는 글자 확정용 — 전송하지 않는다(SearchBar 와 같은 방식)
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit(); // 응답 중이면 onSend 가 거절하고 입력은 그대로 남는다
  };

  return (
    <div className="p-3 border-t border-slate-200 bg-slate-50">
      <div className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          질문 입력
        </label>
        {/* 응답 중에도 disabled 로 잠그지 않는다 — 잠그면 포커스가 body 로 빠져 키보드로 돌아올 수 없다. 다음 질문을 미리 써 둘 수 있다. */}
        <textarea
          id={inputId}
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지를 입력하세요"
          rows={2}
          className="flex-1 resize-none border border-slate-300 rounded-lg px-3 py-2.5 text-sm leading-normal text-slate-900 bg-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30"
        />
        {streaming ? (
          <button
            key="stop"
            type="button"
            onClick={onStop}
            className={`${BUTTON} bg-red-600 focus-visible:ring-red-600`}
          >
            중지
          </button>
        ) : (
          <button
            key="send"
            type="button"
            onClick={submit}
            disabled={!canSend}
            className={`${BUTTON} focus-visible:ring-blue-600 ${
              canSend ? 'bg-blue-600' : 'bg-slate-400 cursor-not-allowed'
            }`}
          >
            전송
          </button>
        )}
      </div>
      {/* 단축키 안내는 placeholder 가 아니라 화면 글자로 — placeholder 에 두면 스크린리더가 입력창에 올 때마다 통째로 읽는다(NVDA 청취) */}
      <p className="m-0 mt-1.5 text-[12px] text-slate-600">
        Enter 전송 · Shift+Enter 줄바꿈
      </p>
    </div>
  );
}
