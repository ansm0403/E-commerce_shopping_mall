'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRequireAuth } from '@/hooks/useRequireAuth';

/**
 * 마이페이지 공통 셸 — 좌측 네비(모바일은 상단 가로 스크롤 탭) + 내용.
 * `/my/*` 전체의 로그인 가드도 여기서 한다(useRequireAuth — `/auth/me` 응답을 기다린 뒤에만 로그인으로 보낸다).
 */

const NAV_ITEMS = [
  { href: '/my', label: '내 정보', exact: true },
  { href: '/my/orders', label: '주문 내역' },
  { href: '/my/reviews', label: '내 리뷰' },
  { href: '/my/wishlist', label: '위시리스트' },
  { href: '/my/inquiries', label: '내 문의' },
  { href: '/my/password', label: '비밀번호 변경' },
  { href: '/my/seller-apply', label: '셀러 신청' },
] as const;

function isActive(pathname: string, item: (typeof NAV_ITEMS)[number]) {
  if ('exact' in item && item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export default function MyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoggedIn, isChecking } = useRequireAuth();

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 md:px-8 py-6 md:flex md:gap-8">
      <nav aria-label="마이페이지" className="md:w-44 md:shrink-0">
        <p className="hidden md:block mb-3 text-lg font-bold text-secondary-900">마이페이지</p>
        {/* 모바일: 가로 스크롤 탭 · 데스크톱: 세로 목록 */}
        <ul className="flex gap-1 overflow-x-auto border-b border-secondary-200 pb-2 md:flex-col md:overflow-visible md:border-b-0 md:pb-0">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`block whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-primary-50 font-semibold text-primary-700'
                      : 'text-secondary-700 hover:bg-secondary-50'
                  }`}
                >
                  {item.label}
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
