'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { hasRole } from '@/lib/roles';
import { isMyNavActive, myNavItems } from './nav-items';

/**
 * 마이페이지 공통 셸 — 좌측 네비(모바일은 상단 가로 스크롤 탭) + 내용.
 * `/my/*` 전체의 로그인 가드도 여기서 한다(useRequireAuth — `/auth/me` 응답을 기다린 뒤에만 로그인으로 보낸다).
 */

export default function MyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, isLoggedIn, isChecking } = useRequireAuth();
  // /auth/me 는 DB 기준이라 승인 직후에도 seller 가 보인다(UserMenu 의 "셀러 센터"와 같은 판정)
  const navItems = myNavItems(hasRole(user, 'seller'));

  return (
    <div className="w-full py-8 md:flex md:gap-10">
      <nav aria-label="마이페이지" className="md:w-44 md:shrink-0">
        <p className="hidden md:block mb-3 text-lg font-bold text-secondary-900">마이페이지</p>
        {/* 모바일: 가로 스크롤 탭 · 데스크톱: 세로 목록 */}
        <ul className="flex gap-1 overflow-x-auto border-b border-secondary-200 pb-2 md:flex-col md:overflow-visible md:border-b-0 md:pb-0">
          {navItems.map((item) => {
            const active = isMyNavActive(pathname, item);
            return (
              <li
                key={item.href}
                className={`shrink-0 ${item.external ? 'md:mt-2 md:border-t md:border-secondary-200 md:pt-2' : ''}`}
              >
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`block whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-[#e9eee4] font-semibold text-[#47583d]'
                      : 'text-secondary-700 hover:bg-secondary-50'
                  }`}
                >
                  {item.label}
                  {item.external && <span aria-hidden="true"> →</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-5 min-w-0 flex-1 md:mt-0">
        {isChecking ? (
          <p className="py-12 text-center text-sm text-secondary-600">불러오는 중...</p>
        ) : isLoggedIn ? (
          children
        ) : null}
      </div>
    </div>
  );
}
