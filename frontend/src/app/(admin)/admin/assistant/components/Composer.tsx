'use client';

import { useState } from 'react';

interface Props {
  streaming: boolean;
  /** 전송을 받아들였으면 true — 그때만 입력창을 비운다 */
  onSend: (message: string) => boolean;
  onStop: () => void;
}

const BUTTON = 'px-[18px] rounded-lg text-white text-sm font-semibold whitespace-nowrap';

export default function Composer({ streaming, onSend, onStop }: Props) {
  const [input, setInput] = useState('');
  const canSend = input.trim().length > 0;

  const submit = () => {
    if (onSend(input)) setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 전송 / Shift+Enter 줄바꿈
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex gap-2 p-3 border-t border-slate-200 bg-slate-50">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
        rows={2}
        disabled={streaming}
        className={`flex-1 resize-none border border-slate-300 rounded-lg px-3 py-2.5 text-sm leading-normal outline-none text-slate-900 ${
          streaming ? 'bg-slate-100' : 'bg-white'
        }`}
      />
      {streaming ? (
        <button type="button" onClick={onStop} className={`${BUTTON} bg-red-500`}>
          중지
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className={`${BUTTON} ${canSend ? 'bg-blue-600' : 'bg-slate-400 cursor-not-allowed'}`}
        >
          전송
        </button>
      )}
    </div>
  );
}
