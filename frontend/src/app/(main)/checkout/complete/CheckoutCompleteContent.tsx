'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { orderQueryOptions } from '@/lib/react-query/order-query-options';
import { OrderResponse } from '@/model/order';

export default function CheckoutCompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get('orderNumber');
  const { user, isHydrated } = useAuth();
  const isLoggedIn = !!user;

  // 비로그인이면 로그인으로(돌아올 경로 포함) — /auth/me 응답을 기다린 뒤에만 판정한다
  useRequireAuth();

  useEffect(() => {
    if (isHydrated && isLoggedIn && !orderNumber) router.push('/');
  }, [isHydrated, isLoggedIn, orderNumber, router]);

  const { data, isLoading } = useQuery({
    ...orderQueryOptions.detail(orderNumber ?? ''),
    enabled: isLoggedIn && !!orderNumber,
  });

  const order = data?.data as OrderResponse | undefined;

  if (isLoading || !order) {
    return (
      <div className="py-20 text-center">
        <div className="inline-block w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  const orderDate = new Date(order.createdAt).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const firstItem = order.items[0];
  const orderName =
    order.items.length === 1
      ? firstItem.productName
      : `${firstItem.productName} 외 ${order.items.length - 1}건`;

  void orderName;

  return (
    <div className="py-12 flex flex-col items-center">

      {/* 성공 아이콘 */}
      <div className="relative mb-6">
        <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center animate-[scale-in_0.4s_ease-out]">
          <svg
            className="w-12 h-12 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      {/* 타이틀 */}
      <h1 className="text-2xl font-bold text-secondary-900 mb-2">결제가 완료되었습니다!</h1>
      <p className="text-secondary-500 text-sm mb-8">{orderDate}</p>

      {/* 주문 요약 카드 */}
      <div className="w-full max-w-md bg-white rounded-2xl border border-secondary-200 p-6 space-y-5">

        {/* 주문 번호 */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-secondary-500">주문 번호</span>
          <span className="font-mono text-secondary-700 text-xs bg-secondary-100 px-2.5 py-1 rounded-lg">
            {order.orderNumber}
          </span>
        </div>

        <div className="border-t border-secondary-100" />

        {/* 상품 정보 */}
        <div>
          <p className="text-xs font-semibold text-secondary-400 uppercase tracking-wide mb-3">주문 상품</p>
          <div className="space-y-3">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                {item.productImageUrl ? (
                  /* eslint-disable @next/next/no-img-element */
                  <img
                    src={item.productImageUrl}
                    alt={item.productName}
                    className="w-11 h-11 rounded-lg object-cover shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                    <span className="text-primary-600 font-bold text-sm">
                      {item.productName.charAt(0)}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-secondary-900 truncate">{item.productName}</p>
                  <p className="text-xs text-secondary-400">{item.quantity}개</p>
                </div>
                <p className="text-sm font-bold text-secondary-800 shrink-0">
                  {Number(item.subtotal).toLocaleString()}원
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-secondary-100" />

        {/* 배송지 */}
        <div className="flex items-start justify-between text-sm gap-4">
          <span className="text-secondary-500 shrink-0">배송지</span>
          <span className="text-secondary-800 text-right text-xs leading-relaxed">
            {order.recipientName} · {order.recipientPhone}
            <br />
            {order.shippingAddress}
          </span>
        </div>

        <div className="border-t border-secondary-100" />

        {/* 결제 금액 */}
        <div className="flex items-center justify-between">
          <span className="font-bold text-secondary-900">총 결제금액</span>
          <span className="text-xl font-bold text-primary-600">
            {Number(order.totalAmount).toLocaleString()}원
          </span>
        </div>
      </div>

      {/* 안내 문구 */}
      <p className="mt-5 text-xs text-secondary-400 text-center leading-relaxed">
        주문이 접수되었습니다. 배송 현황은 주문 상세에서 확인할 수 있습니다.
      </p>

      {/* 버튼 */}
      <div className="mt-6 flex flex-col sm:flex-row gap-3 w-full max-w-md">
        <button
          onClick={() => router.push(`/my/orders/${order.orderNumber}`)}
          className="flex-1 py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 active:scale-95 transition-all text-sm"
        >
          주문 상세 보기
        </button>
        <button
          onClick={() => router.push('/products')}
          className="flex-1 py-3 border border-secondary-300 text-secondary-600 rounded-xl font-semibold hover:bg-secondary-50 active:scale-95 transition-all text-sm"
        >
          쇼핑 계속하기
        </button>
      </div>

    </div>
  );
}
