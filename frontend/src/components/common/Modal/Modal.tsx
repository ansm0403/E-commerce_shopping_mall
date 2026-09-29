'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { twMerge } from 'tailwind-merge';

// ─── 패널 크기 variant ───────────────────────────────────────────────────────
const modalPanelVariants = cva(
  [
    'relative bg-white rounded-xl shadow-xl w-full',
    'flex flex-col max-h-[90vh]',
    'animate-[fadeInScale_0.15s_ease-out]',
  ],
  {
    variants: {
      size: {
        sm:   'max-w-sm',
        md:   'max-w-md',
        lg:   'max-w-lg',
        xl:   'max-w-xl',
        full: 'max-w-3xl',
      },
    },
    defaultVariants: { size: 'md' },
  }
);

/** Tab 으로 갈 수 있는 요소 — 포커스 가두기·첫 포커스 대상 계산용 */
const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

// ─── 타입 ────────────────────────────────────────────────────────────────────
export interface ModalProps extends VariantProps<typeof modalPanelVariants> {
  isOpen: boolean;
  onClose: () => void;
  /** 배경(Overlay) 클릭으로 닫을지 여부 (기본 true) */
  closeOnOverlayClick?: boolean;
  /** 모달 제목 */
  title?: string;
  children: React.ReactNode;
  className?: string;
}

// ─── 컴포넌트 ────────────────────────────────────────────────────────────────
export function Modal({
  isOpen,
  onClose,
  closeOnOverlayClick = true,
  title,
  size,
  children,
  className,
}: ModalProps): React.ReactElement | null {
  // SSR 환경에서 포털 마운트를 클라이언트에서만 실행
  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // onClose 가 렌더마다 새 함수여도 포커스 effect 가 다시 돌지 않게(다시 돌면 포커스가 첫 요소로 튄다)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  // 포커스 관리 + ESC 닫기 + 배경 스크롤 잠금
  // 예전엔 role/aria-modal 만 있고 포커스는 뒤 페이지에 남아 Tab 이 모달 뒤 링크로 새고, 닫은 뒤엔 제자리를 잃었다.
  useEffect(() => {
    if (!isOpen || !mounted) return;

    // ① 연 버튼을 기억했다가 ④ 닫힐 때 돌려준다
    const opener = document.activeElement as HTMLElement | null;

    // ② 열리면 모달 안 첫 요소로(닫기 버튼 다음의 본문 요소가 없으면 닫기 버튼)
    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter((el) => !el.hasAttribute('disabled'));
    const list = focusables();
    (list[1] ?? list[0] ?? panelRef.current)?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // ③ Tab 가두기 — 마지막에서 Tab 이면 처음으로, 처음에서 Shift+Tab 이면 마지막으로
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = panelRef.current?.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [isOpen, mounted]);

  // Overlay 클릭 시 패널 외부인지 확인 후 닫기
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOverlayClick && e.target === overlayRef.current) {
      onClose();
    }
  };

  if (!mounted || !isOpen) return null;

  const portal = createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      {/* dialog 역할은 배경이 아니라 실제 패널에 — 이름은 보이는 제목(h2)과 연결 */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={twMerge(
          clsx(modalPanelVariants({ size }), 'outline-none', className)
        )}
      >
        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          aria-label="닫기"
          className="absolute top-4 right-4 rounded-md p-1 text-secondary-400 hover:text-secondary-600 hover:bg-secondary-100 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-600"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>

        {/* 헤더 (title이 있을 때만 렌더) */}
        {title && (
          <div className="px-6 pt-5 pb-4 border-b border-secondary-100">
            <h2 id={titleId} className="text-lg font-semibold text-secondary-900 pr-8">{title}</h2>
          </div>
        )}

        {/* 본문 영역 — 스크롤 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body
  );
  // @types/react-dom 이 내장한 @types/react 버전과 프로젝트 버전 간 ReactPortal 불일치 우회
  return portal as unknown as React.ReactElement;
}

// ─── 편의 서브컴포넌트 (Modal 내부 영역 구분용) ──────────────────────────────
export function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={twMerge(
        'px-6 py-4 border-t border-secondary-100 flex items-center justify-end gap-3',
        className
      )}
    >
      {children}
    </div>
  );
}
