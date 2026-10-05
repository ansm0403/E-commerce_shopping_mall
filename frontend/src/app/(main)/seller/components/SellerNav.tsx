'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/seller/products', label: '상품 관리' },
  { href: '/seller/products/new', label: '상품 등록' },
  { href: '/seller/orders', label: '주문/배송' },
  { href: '/seller/settlements', label: '정산' },
  { href: '/seller/inquiries', label: '문의' },
] as const;

/**
 * 지금 화면에 해당하는 메뉴 하나를 고른다 — 주소의 앞부분과 **가장 길게** 맞는 항목.
 * `/seller/products/new` 는 '상품 관리'(`/seller/products`)와도 앞부분이 겹치므로 단순 startsWith 로는 둘 다 켜진다.
 * 예: `/seller/products/12/edit` → 상품 관리 · `/seller/products/new` → 상품 등록
 */
export function activeSellerNavHref(pathname: string): string | null {
  const matches = NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).href;
}

/** 셀러 센터 상단 메뉴 — 현재 화면의 메뉴를 색·굵기·밑줄로 표시한다(`aria-current`) */
export default function SellerNav() {
  const pathname = usePathname();
  const activeHref = activeSellerNavHref(pathname);

  return (
    <nav
      aria-label="셀러 센터"
      className="mb-6 flex items-center gap-1 overflow-x-auto border-b border-gray-200 text-sm"
    >
      <span className="mr-3 shrink-0 pb-3 font-bold text-gray-900">셀러 센터</span>
      {NAV_ITEMS.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 pb-3 transition-colors ${
              active
                ? 'border-blue-600 font-semibold text-blue-700'
                : 'border-transparent text-gray-600 hover:text-blue-600'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
