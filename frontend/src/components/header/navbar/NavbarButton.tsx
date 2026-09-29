import { ButtonHTMLAttributes, forwardRef } from 'react';
import { twMerge } from 'tailwind-merge';

type NavbarButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

// ref 전달: 카테고리 드롭다운이 Esc 로 닫힐 때 이 버튼으로 포커스를 돌려준다
export const NavbarButton = forwardRef<HTMLButtonElement, NavbarButtonProps>(
  function NavbarButton({ className, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={twMerge(
          'px-4 py-2 font-medium bg-transparent border-0 cursor-pointer whitespace-nowrap hover:bg-gray-100',
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
