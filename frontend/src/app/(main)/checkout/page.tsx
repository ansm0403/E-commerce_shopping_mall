'use client';
import DemoWriteRestriction from '@/components/forms/DemoWriteRestriction';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { hasRole } from '@/lib/roles';
import { authRevision } from '@/service/auth-session';
import {
  createDemoCheckout,
  getDemoCheckoutOptions,
} from '@/service/demo-checkout';
import * as PortOne from '@portone/browser-sdk/v2';
import { useQuery, useMutation } from '@tanstack/react-query';
import { cartQueryOptions } from '@/lib/react-query/cart-query-options';
import { useAuth } from '@/contexts/AuthContext';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useVerifyPayment } from '@/hooks/useOrder';
import { createOrder, cancelOrder } from '@/service/order';
import { Cart } from '@/model/cart';
import { OrderResponse } from '@/model/order';

export default function CheckoutPage() {
  const router = useRouter();
  const { user, isHydrated } = useAuth();
  const isLoggedIn = !!user;
  const isDemoBuyer =
    !!user?.isDemo &&
    hasRole(user, 'buyer') &&
    !hasRole(user, 'seller') &&
    !hasRole(user, 'admin');
  const demoRequestId = useRef<string | undefined>(undefined);
  const demoOptions = useQuery({
    queryKey: ['auth', 'demo-checkout-options', user?.id],
    queryFn: ({ signal }) => getDemoCheckoutOptions(signal),
    enabled: isDemoBuyer,
  });
  const demoSettings = demoOptions.data?.data;
  const verifyPayment = useVerifyPayment();
  const isProcessingRef = useRef(false);

  const [form, setForm] = useState({
    shippingAddress: '',
    recipientName: '',
    recipientPhone: '',
    memo: '',
  });

  useEffect(() => {
    if (isDemoBuyer && demoSettings?.shipping) {
      setForm({ ...demoSettings.shipping, memo: '' });
    }
  }, [isDemoBuyer, demoSettings]);

  const { data, isLoading } = useQuery(cartQueryOptions.myCart(isLoggedIn));

  // 결제 처리 중 여부 — true이면 장바구니가 비어도 /cart로 이동하지 않음 (race condition 방지)
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);

  // 비로그인이면 로그인으로(돌아올 경로 포함) — /auth/me 응답을 기다린 뒤에만 판정한다
  useRequireAuth();

  const cart = data?.data as Cart | undefined;
  const items = cart?.items ?? [];

  useEffect(() => {
    if (
      !isLoading &&
      isHydrated &&
      isLoggedIn &&
      items.length === 0 &&
      !isPaymentProcessing &&
      !user?.isDemo
    ) {
      router.push('/cart');
    }
  }, [
    isLoading,
    isHydrated,
    isLoggedIn,
    items.length,
    isPaymentProcessing,
    router,
    user?.isDemo,
  ]);

  const hasOutOfStock = items.some(
    (item) =>
      item.product.status === 'sold_out' || item.product.stockQuantity === 0
  );
  const subtotal = items.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );
  // 배송비는 서버에 없다 — POST /orders 가 저장하는 totalAmount 는 항목 합계만이고 결제창에 넘기는 금액도 그것이다.
  // 화면만 3,000원을 더해 22,900원을 약속하고 19,900원을 청구하던 불일치를 frontend-e2e 가 잡았다(ex-frontend-e2e.md §4 → (a) 적용 2026-10-21).
  const total = subtotal;

  const createOrderMutation = useMutation({
    mutationFn: () => {
      if (isDemoBuyer) {
        demoRequestId.current ??= crypto.randomUUID();
        return createDemoCheckout(demoRequestId.current);
      }
      return createOrder({
        cartItemIds: items.map((item) => item.id),
        shippingAddress: form.shippingAddress,
        recipientName: form.recipientName,
        recipientPhone: form.recipientPhone,
        memo: form.memo || undefined,
      });
    },
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isProcessingRef.current || (isDemoBuyer && !demoSettings?.enabled))
      return;
    if (!items.length) {
      router.push('/cart');
      return;
    }
    if (hasOutOfStock) {
      alert(
        '품절된 상품이 포함되어 있습니다. 장바구니에서 제거 후 다시 시도해주세요.'
      );
      return;
    }

    isProcessingRef.current = true;
    const revision = authRevision();
    const currentSession = () => revision === authRevision();
    // 결제 처리 중 플래그 — 장바구니 빈 감지 useEffect가 /cart로 튕기지 않도록 막음
    setIsPaymentProcessing(true);

    // 처리 완료(성공/실패) 시 공통 정리 함수
    const cleanup = () => {
      isProcessingRef.current = false;
      setIsPaymentProcessing(false);
    };

    // 1단계: 주문 생성
    let order: OrderResponse;
    try {
      const res = await createOrderMutation.mutateAsync();
      order = res.data as OrderResponse;
    } catch (err: unknown) {
      cleanup();
      if (!currentSession()) return;
      const axiosErr = err as { response?: { data?: { message?: unknown } } };
      const message =
        axiosErr?.response?.data?.message ?? '주문 생성에 실패했습니다.';
      alert(Array.isArray(message) ? message.join('\n') : String(message));
      return;
    }

    if (!currentSession()) {
      cleanup();
      return;
    }
    if (order.status === 'paid') {
      router.push(`/checkout/complete?orderNumber=${order.orderNumber}`);
      return;
    }
    if (order.status !== 'pending_payment') {
      demoRequestId.current = undefined;
      cleanup();
      alert('이 주문은 만료되거나 취소되었습니다. 다시 결제하기를 눌러주세요.');
      return;
    }
    if (isDemoBuyer && (!order.isDemoCheckout || !order.testPayment)) {
      cleanup();
      alert('테스트 결제 설정을 확인하지 못했습니다.');
      return;
    }

    const paymentSettings = order.isDemoCheckout
      ? order.testPayment
      : {
          storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID ?? '',
          channelKey: process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY ?? '',
        };
    if (!paymentSettings) {
      cleanup();
      return;
    }

    const abandonDemoOrder = async () => {
      if (!order.isDemoCheckout || !currentSession()) return;
      try {
        await cancelOrder(order.orderNumber);
        demoRequestId.current = undefined;
      } catch {
        /* 결제 검증과 경합했다면 주문 상세에서 최종 상태를 확인한다. */
      }
    };

    // 2단계: 포트원 V2 결제창 호출
    // V2는 async/await 지원 — 콜백 없이 결과를 직접 반환
    let response: Awaited<ReturnType<typeof PortOne.requestPayment>>;
    try {
      response = await PortOne.requestPayment({
        storeId: paymentSettings.storeId,
        channelKey: paymentSettings.channelKey,
        paymentId: order.orderNumber,
        orderName:
          order.items.length === 1
            ? order.items[0].productName
            : `${order.items[0].productName} 외 ${order.items.length - 1}건`,
        totalAmount: Number(order.totalAmount),
        currency: 'CURRENCY_KRW',
        payMethod: 'EASY_PAY',
        customer: {
          fullName: order.recipientName,
          phoneNumber: order.recipientPhone,
          address: { addressLine1: order.shippingAddress, addressLine2: '' },
        },
      });
    } catch (err) {
      if (!currentSession()) {
        cleanup();
        return;
      }
      // SDK 내부 오류(네트워크 단절, 초기화 실패 등)
      console.error('[PortOne] requestPayment 오류:', err);
      await abandonDemoOrder();
      cleanup();
      alert(
        '결제창을 여는 중 오류가 발생했습니다. 주문 상세에서 상태를 확인해주세요.'
      );
      router.push(`/my/orders/${order.orderNumber}`);
      return;
    }

    if (!currentSession()) {
      cleanup();
      return;
    }
    // 결제창 닫기(undefined) 또는 실패(code 있음)
    if (!response || response.code) {
      await abandonDemoOrder();
      cleanup();
      alert(response?.message ?? '결제가 취소되었습니다.');
      router.push(`/my/orders/${order.orderNumber}`);
      return;
    }

    if (response.paymentId !== order.orderNumber) {
      cleanup();
      alert(
        '주문과 결제 응답이 일치하지 않습니다. 주문 상세에서 상태를 확인해주세요.'
      );
      router.push(`/my/orders/${order.orderNumber}`);
      return;
    }

    // 3단계: 서버 결제 검증 — mutateAsync로 await하여 결과를 handleSubmit 내에서 처리
    try {
      await verifyPayment.mutateAsync({
        transactionId: response.txId,
        paymentId: response.paymentId,
      });
      // 성공 처리는 useVerifyPayment의 onSuccess에서 수행 (장바구니 무효화 + 완료 페이지 이동)
      // isPaymentProcessing은 리셋하지 않음 — 페이지를 벗어날 것이므로
      // 리셋하면 장바구니 empty 감지 useEffect가 /cart로 튕기는 race condition 발생
      isProcessingRef.current = false;
    } catch {
      // 에러 처리는 useVerifyPayment의 onError에서 수행 (alert + 주문 상세 이동)
      cleanup();
    }
  };

  const isSubmitting =
    isPaymentProcessing ||
    createOrderMutation.isPending ||
    verifyPayment.isPending;

  if (user?.isDemo && !isDemoBuyer)
    return <DemoWriteRestriction kind="checkout">{null}</DemoWriteRestriction>;
  if (isLoading || (isDemoBuyer && demoOptions.isLoading)) {
    return (
      <div className="py-20 text-center text-secondary-400">불러오는 중...</div>
    );
  }

  return (
    <div className="py-8">
      <h1 className="text-3xl font-semibold tracking-tight text-primary-600 mb-8">
        주문서 작성
      </h1>

      {isDemoBuyer && (
        <div className="mb-6 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-secondary-700">
          <p className="font-semibold">PortOne 테스트 결제</p>
          <p className="mt-1">
            실제 청구와 배송 없이 결제창부터 주문 완료까지 체험합니다. 배송
            정보는 자동으로 입력됩니다.
          </p>
          {!demoSettings?.enabled && (
            <p className="mt-2">
              테스트 결제 채널을 준비 중입니다.{' '}
              <Link className="underline" href="/my/orders">
                준비된 배송·리뷰 주문 체험하기
              </Link>
            </p>
          )}
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 왼쪽: 주문 상품 + 배송지 */}
          <div className="lg:col-span-2 space-y-6">
            {/* 주문 상품 목록 */}
            <section className="bg-white rounded-3xl border border-primary-100 p-5 sm:p-6">
              <h2 className="text-base font-bold text-secondary-900 mb-4">
                주문 상품
              </h2>
              <div className="divide-y divide-secondary-100">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="w-12 h-12 rounded-xl bg-[#e9eee4] flex items-center justify-center shrink-0">
                      <span className="text-primary-600 font-bold text-base">
                        {item.product.brand.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-secondary-500">
                        {item.product.brand}
                      </p>
                      <p className="text-sm font-semibold text-secondary-900 truncate">
                        {item.product.name}
                      </p>
                      <p className="text-xs text-secondary-500">
                        수량 {item.quantity}개
                      </p>
                    </div>
                    <p className="text-sm font-bold text-secondary-900 shrink-0">
                      {(item.product.price * item.quantity).toLocaleString()}원
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* 배송지 입력 */}
            <section className="bg-white rounded-3xl border border-primary-100 p-5 sm:p-6">
              <h2 className="text-base font-bold text-secondary-900 mb-4">
                배송 정보
              </h2>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="checkout-recipientName"
                    className="block text-sm font-medium text-secondary-700 mb-1"
                  >
                    수령인{' '}
                    <span className="text-red-500" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <input
                    type="text"
                    id="checkout-recipientName"
                    name="recipientName"
                    autoComplete="name"
                    value={form.recipientName}
                    readOnly={isDemoBuyer}
                    onChange={handleChange}
                    required
                    placeholder="수령인 이름"
                    className="w-full px-3 py-2.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label
                    htmlFor="checkout-recipientPhone"
                    className="block text-sm font-medium text-secondary-700 mb-1"
                  >
                    연락처{' '}
                    <span className="text-red-500" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <input
                    type="tel"
                    id="checkout-recipientPhone"
                    name="recipientPhone"
                    autoComplete="tel"
                    value={form.recipientPhone}
                    readOnly={isDemoBuyer}
                    onChange={handleChange}
                    required
                    placeholder="010-0000-0000"
                    className="w-full px-3 py-2.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label
                    htmlFor="checkout-shippingAddress"
                    className="block text-sm font-medium text-secondary-700 mb-1"
                  >
                    배송지 주소{' '}
                    <span className="text-red-500" aria-hidden="true">
                      *
                    </span>
                  </label>
                  <input
                    type="text"
                    id="checkout-shippingAddress"
                    name="shippingAddress"
                    autoComplete="street-address"
                    value={form.shippingAddress}
                    readOnly={isDemoBuyer}
                    onChange={handleChange}
                    required
                    placeholder="상세 주소를 포함하여 입력해주세요"
                    className="w-full px-3 py-2.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label
                    htmlFor="checkout-memo"
                    className="block text-sm font-medium text-secondary-700 mb-1"
                  >
                    배송 메모
                  </label>
                  <textarea
                    id="checkout-memo"
                    name="memo"
                    value={form.memo}
                    readOnly={isDemoBuyer}
                    onChange={handleChange}
                    rows={2}
                    placeholder="배송 시 요청사항 (선택)"
                    className="w-full px-3 py-2.5 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  />
                </div>
              </div>
            </section>
          </div>

          {/* 오른쪽: 결제 요약 */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-48 bg-white rounded-3xl border border-primary-100 p-6 space-y-5">
              <h2 className="text-base font-bold text-secondary-900">
                결제 금액
              </h2>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-secondary-600">
                  <span>상품 금액</span>
                  <span>{subtotal.toLocaleString()}원</span>
                </div>
                <div className="flex justify-between text-secondary-600">
                  <span>배송비</span>
                  <span className="text-green-700 font-medium">무료</span>
                </div>
              </div>

              <div className="border-t border-secondary-200 pt-4 flex justify-between items-center">
                <span className="font-bold text-secondary-900">
                  총 결제금액
                </span>
                <span className="text-lg font-bold text-primary-600">
                  {total.toLocaleString()}원
                </span>
              </div>

              {hasOutOfStock && (
                <p className="text-sm text-red-500 font-medium">
                  품절된 상품이 포함되어 있습니다. 장바구니에서 제거해주세요.
                </p>
              )}

              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  hasOutOfStock ||
                  items.length === 0 ||
                  (isDemoBuyer && !demoSettings?.enabled)
                }
                className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting
                  ? '처리 중...'
                  : isDemoBuyer
                  ? '테스트 결제하기'
                  : '결제하기'}
              </button>

              <button
                type="button"
                onClick={() => router.back()}
                className="w-full py-2.5 border border-secondary-300 text-secondary-600 rounded-xl text-sm font-medium hover:bg-secondary-50 transition-colors"
              >
                장바구니로 돌아가기
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
