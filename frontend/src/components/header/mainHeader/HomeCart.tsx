'use client';

import { useQuery } from '@tanstack/react-query';
import { cartQueryOptions } from '@/lib/react-query/cart-query-options';
import { useAuth } from '@/contexts/AuthContext';
import { Cart } from '@/model/cart';
import Link from 'next/link';

export default function HomeCart() {
  const { user } = useAuth();
  const { data } = useQuery(cartQueryOptions.myCart(!!user));

  const cart = data?.data as Cart | undefined;
  const items = cart?.items ?? [];
  const totalCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);

  // 고정 aria-label="장바구니" 는 보이는 "1개 담음 · 12,000원" 을 덮어써 스크린리더가 개수·금액을 못 읽었다.
  // 좁은 화면에선 텍스트가 hidden 이라 이름을 상태에 맞춰 만든다(보이는 단어 "장바구니"로 시작 — WCAG 2.5.3).
  const label =
    totalCount > 0
      ? `장바구니, ${totalCount}개 담음, ${totalPrice.toLocaleString()}원`
      : '장바구니, 비어있음';

  return (
    <Link
      href="/cart"
      className="flex items-center gap-3 px-4 py-2 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50 active:bg-primary-100 transition-all group shrink-0"
      aria-label={label}
    >
      {/* 아이콘 + 배지 */}
      <div className="relative">
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg" width="22" height="22"
          viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="text-gray-600 group-hover:text-primary-600 transition-colors"
        >
          <circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/>
          <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>
        </svg>
        {totalCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-primary-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
            {totalCount > 99 ? '99+' : totalCount}
          </span>
        )}
      </div>

      {/* 텍스트 정보 */}
      <div className="hidden sm:flex flex-col items-start leading-tight">
        <span className="text-[11px] text-gray-500 group-hover:text-primary-700 transition-colors">
          {totalCount > 0 ? `${totalCount}개 담음` : '장바구니'}
        </span>
        <span className="text-sm font-semibold text-gray-800 group-hover:text-primary-700 transition-colors">
          {totalCount > 0 ? `${totalPrice.toLocaleString()}원` : '비어있음'}
        </span>
      </div>
    </Link>
  );
}
