import React from 'react'

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  className?: string;
  hideButton?: boolean;
  /** placeholder 는 입력하면 사라지므로 이름으로 쓰지 않는다 */
  'aria-label'?: string;
}

export default function SearchBar({ value, onChange, onSubmit, placeholder, className, hideButton, 'aria-label': ariaLabel }: SearchBarProps) {
  const isEmpty = value.trim() === '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEmpty) return;
    onSubmit();
  };

  // 한글 IME 조합 중 Enter는 무시 (조합 확정용 Enter가 폼 submit을 트리거하지 않도록)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.nativeEvent.isComposing) {
      e.preventDefault();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center w-full">
      <input
        type="text"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={100}
        placeholder={placeholder}
        className={className}
      />
      {!hideButton && (
        <button
          type="submit"
          disabled={isEmpty}
          className="ml-2 px-3 py-2 bg-white text-sm rounded-sm border border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          검색
        </button>
      )}
    </form>
  );
}
