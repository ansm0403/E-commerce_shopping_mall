'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FaShoppingCart } from 'react-icons/fa';
import { cartQueryOptions } from '@/lib/react-query/cart-query-options';
import { useAuth } from '@/contexts/AuthContext';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useClearCart } from '@/hooks/useCart';
import { Cart } from '@/model/cart';
import CartItemRow from './CartItemRow';

const SHIPPING_FEE = 3000;
const FREE_SHIPPING_THRESHOLD = 50000;

export default function CartPage() {
  const router = useRouter();
  const clearCart = useClearCart();
  const { user } = useAuth();

  const isLoggedIn = !!user;
  const { data, isLoading } = useQuery(cartQueryOptions.myCart(isLoggedIn));

  // 비로그인이면 로그인으로(돌아올 경로 포함) — /auth/me 응답을 기다린 뒤에만 판정한다
  useRequireAuth();

  const cart = data?.data as Cart | undefined;
  const items = cart?.items ?? [];

  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const shippingFee = subtotal === 0 ? 0 : subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
  const total = subtotal + shippingFee;

  if (isLoading) {
    return (
      <div className="py-20 text-center text-secondary-500">
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="py-8">
      {/* 페이지 타이틀 */}
      <h1 className="text-3xl font-semibold tracking-tight text-primary-600 mb-8">
        장바구니
        {items.length > 0 && (
          <span className="ml-2 text-lg font-normal text-secondary-500">
            ({items.length}개 상품)
          </span>
        )}
      </h1>

      {/* 빈 장바구니 */}
      {items.length === 0 && (
        <div className="py-24 flex flex-col items-center gap-4 text-secondary-500">
          <FaShoppingCart size={48} className="text-secondary-200" />
          <p className="text-lg font-medium">장바구니가 비었습니다</p>
          <button
            onClick={() => router.push('/products')}
            className="mt-2 px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
          >
            쇼핑 계속하기
          </button>
        </div>
      )}

      {/* 장바구니 목록 + 주문 요약 */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* 왼쪽: 상품 목록 */}
          <div className="lg:col-span-2 flex flex-col gap-3">
            {items.map((item) => (
              <CartItemRow key={item.id} item={item} />
            ))}

            <button
              onClick={() => clearCart.mutate()}
              disabled={clearCart.isPending}
              className="self-start mt-1 text-xs text-secondary-500 hover:text-red-600 underline underline-offset-2 transition-colors disabled:opacity-50"
            >
              전체 비우기
            </button>
          </div>

          {/* 오른쪽: 주문 요약 */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-48 bg-white rounded-3xl border border-primary-100 p-6 space-y-5">
              <h2 className="text-base font-bold text-secondary-900">주문 요약</h2>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-secondary-600">
                  <span>상품 금액</span>
                  <span>{subtotal.toLocaleString()}원</span>
                </div>
                <div className="flex justify-between text-secondary-600">
                  <span>배송비</span>
                  <span>
                    {shippingFee === 0
                      ? <span className="text-green-700 font-medium">무료</span>
                      : `${shippingFee.toLocaleString()}원`
                    }
                  </span>
                </div>
                {subtotal > 0 && subtotal < FREE_SHIPPING_THRESHOLD && (
                  <p className="text-xs text-secondary-500">
                    {(FREE_SHIPPING_THRESHOLD - subtotal).toLocaleString()}원 더 담으면 무료배송
                  </p>
                )}
              </div>

              <div className="border-t border-secondary-200 pt-4 flex justify-between items-center">
                <span className="font-bold text-secondary-900">총 결제금액</span>
                <span className="text-lg font-bold text-primary-600">
                  {total.toLocaleString()}원
                </span>
              </div>

              <button
                onClick={() => router.push('/checkout')}
                className="w-full py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 active:scale-95 transition-all"
              >
                구매하기
              </button>

              <button
                onClick={() => router.push('/products')}
                className="w-full py-2.5 border border-secondary-300 text-secondary-600 rounded-xl text-sm font-medium hover:bg-secondary-50 transition-colors"
              >
                쇼핑 계속하기
              </button>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
