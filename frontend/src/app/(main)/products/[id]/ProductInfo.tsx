'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Product } from '@/model/product';
import { useAddToCart } from '@/hooks/useCart';
import { useWishlistToggle } from '@/hooks/useWishlist';
import { authStorage } from '@/service/auth-storage';

interface ProductInfoProps {
  product: Product;
  quantity: number;
  onQuantityChange: (qty: number) => void;
}

function getOriginalPrice(price: number, discountRate: number): number | null {
  if (discountRate <= 0 || discountRate >= 100) return null;
  return Math.round(Number(price) / (1 - discountRate / 100));
}

const STAR_PATH =
  'M12 2l2.9 6.26 6.86.74-5.1 4.64 1.43 6.76L12 16.9l-6.09 3.5 1.43-6.76-5.1-4.64 6.86-.74L12 2z';

/**
 * 별점 — 장식 그래픽. 평점 정보는 옆의 숫자("평점 5점 만점에 3.5점")가 전달한다.
 * 예전엔 ★⯨☆ 글자였다 → 스크린리더가 "검은 별…"로 읽고, ⯨ 는 글꼴에 따라 깨지고, axe 는 글자 대비(1.53:1)로 잡았다.
 */
function StarRating({ rating }: { rating: number }) {
  return (
    <span aria-hidden="true" className="flex text-yellow-400">
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, rating - i));
        // 반 개 단위 표시(예전 동작과 같게): 0.5 이상이면 반, 1 이면 전체
        const shown = fill >= 1 ? 1 : fill >= 0.5 ? 0.5 : 0;
        return (
          <span key={i} className="relative inline-block w-4 h-4">
            <svg viewBox="0 0 24 24" className="absolute inset-0 w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d={STAR_PATH} />
            </svg>
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${shown * 100}%` }}>
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                <path d={STAR_PATH} />
              </svg>
            </span>
          </span>
        );
      })}
    </span>
  );
}

export default function ProductInfo({
  product,
  quantity,
  onQuantityChange,
}: ProductInfoProps) {
  const router = useRouter();
  const [isWished, setIsWished] = useState(false);
  // ③ wishCount를 로컬 state로 관리 — 토글 성공 시 직접 +1/-1해서 정확하게 반영
  const [wishCount, setWishCount] = useState(product.wishCount ?? 0);

  const addToCart = useAddToCart();
  const wishlistToggle = useWishlistToggle();

  // ④ 장바구니 추가 성공 후 2초 뒤 버튼 상태를 idle로 되돌림
  useEffect(() => {
    if (!addToCart.isSuccess) return;
    const timer = setTimeout(() => addToCart.reset(), 2000);
    return () => clearTimeout(timer);
  }, [addToCart.isSuccess]);

  const hasDiscount = product.discountRate != null && product.discountRate > 0;
  const displayPrice = Number(product.price);
  const originalPrice = hasDiscount
    ? getOriginalPrice(displayPrice, product.discountRate!)
    : null;

  const isOutOfStock = product.stockQuantity === 0 || product.status === 'sold_out';

  // ── 장바구니 추가 ──────────────────────────────────────────
  const handleAddToCart = () => {
    // 비로그인 체크는 useAddToCart 내부 onMutate에서도 하지만
    // UX를 위해 여기서도 먼저 체크해서 즉시 redirect
    if (!authStorage.getAccessToken()) {
      router.push('/login');
      return;
    }
    addToCart.mutate({ productId: product.id, quantity });
  };

  // ── 바로 구매 ──────────────────────────────────────────────
  const handleBuyNow = () => {
    if (!authStorage.getAccessToken()) {
      router.push('/login');
      return;
    }
    addToCart.mutate(
      { productId: product.id, quantity },
      { onSuccess: () => router.push('/checkout') },
    );
  };

  // ── 위시리스트 토글 ────────────────────────────────────────
  const handleWishToggle = () => {
    if (!authStorage.getAccessToken()) {
      router.push('/login');
      return;
    }
    wishlistToggle.mutate(product.id, {
      onSuccess: (res) => {
        const added = res.data.action === 'added';
        setIsWished(added);
        // ③ 토글 결과에 따라 wishCount를 직접 +1/-1
        setWishCount((prev) => prev + (added ? 1 : -1));
      },
    });
  };

  // ── 장바구니 버튼 텍스트/스타일 결정 ──────────────────────
  const cartButtonLabel = (() => {
    if (isOutOfStock) return '품절';
    if (addToCart.isPending) return '추가 중...';
    if (addToCart.isSuccess) return '✓ 장바구니에 담았습니다';
    return '장바구니 추가';
  })();

  // @ts-expect-error 임시로 미사용 변수 허용
  const cartButtonClass = (() => {
    if (isOutOfStock)
      return 'bg-secondary-300 text-secondary-500 cursor-not-allowed';
    if (addToCart.isPending)
      return 'bg-primary-400 text-white cursor-wait';
    if (addToCart.isSuccess)
      return 'bg-green-600 text-white';
    return 'bg-primary-600 text-white hover:bg-primary-700 active:scale-95';
  })();

  return (
    <div className="sticky top-24 md:top-28 space-y-6">

      {/* ── 브랜드 + 위시리스트 버튼 ── */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-secondary-500 mb-0.5">브랜드</p>
          <p className="text-base font-semibold text-secondary-900">{product.brand}</p>
        </div>

        {/* 하트(위시리스트) 버튼 */}
        <button
          onClick={handleWishToggle}
          disabled={wishlistToggle.isPending}
          aria-label={isWished ? '찜 해제' : '찜하기'}
          className={`flex flex-col items-center gap-0.5 p-2 rounded-lg transition-all
            ${wishlistToggle.isPending ? 'opacity-50 cursor-wait' : 'hover:bg-red-50'}`}
        >
          <span className={`text-2xl leading-none transition-transform duration-200
            ${isWished ? 'scale-110' : 'scale-100'}`}>
            {isWished ? '❤️' : '🤍'}
          </span>
          {product.wishCount != null && (
            <span className="text-xs text-secondary-500 leading-none">
              {wishCount.toLocaleString()}
            </span>
          )}
        </button>
      </div>

      {/* ── 상품명 ── */}
      <h1 className="text-2xl font-bold text-secondary-900 leading-tight">
        {product.name}
      </h1>

      {/* ── 평점 + 통계 ── */}
      {product.rating != null && (
        <div className="flex items-center justify-between py-3 border-y border-secondary-200">
          <div className="flex items-center gap-2">
            <StarRating rating={Number(product.rating)} />
            <span className="text-secondary-700 text-sm font-medium">
              <span className="sr-only">평점 5점 만점에 </span>
              {Number(product.rating).toFixed(1)}
              <span className="sr-only">점</span>
            </span>
            <span className="text-secondary-500 text-sm">
              ({(product.reviewCount ?? 0).toLocaleString()}개 리뷰)
            </span>
          </div>
          <div className="text-right space-y-0.5">
            <p className="text-xs text-secondary-500">
              👀 {product.viewCount.toLocaleString()} 조회
            </p>
            <p className="text-xs text-secondary-500">
              🛒 {product.salesCount.toLocaleString()} 판매
            </p>
          </div>
        </div>
      )}

      {/* ── 가격 섹션 ── */}
      <div className="bg-primary-50 rounded-xl p-4 space-y-1.5">
        {originalPrice && (
          <p className="text-secondary-500 text-sm line-through">
            <span className="sr-only">정가 </span>
            {originalPrice.toLocaleString()}원
          </p>
        )}
        <div className="flex items-baseline gap-2">
          {hasDiscount && (
            <span className="text-primary-600 font-bold text-lg">
              {product.discountRate}%↓
            </span>
          )}
          <span className="text-3xl font-bold text-secondary-900">
            {displayPrice.toLocaleString()}
          </span>
          <span className="text-sm text-secondary-600">원</span>
        </div>
        {displayPrice >= 50000 ? (
          <p className="text-green-800 text-xs font-medium"><span aria-hidden="true">🚚 </span>무료배송</p>
        ) : (
          <p className="text-secondary-600 text-xs">
            <span aria-hidden="true">🚚 </span>배송비 3,000원 (50,000원 이상 무료)
          </p>
        )}
      </div>

      {/* ── 이벤트 / 태그 ── */}
      {/* ② tags가 undefined로 올 수 있으므로 ?. 옵셔널 체이닝으로 방어 */}
      {(product.isEvent || (product.tags ?? []).length > 0) && (
        <div className="flex flex-wrap gap-2">
          {product.isEvent && (
            <span className="px-3 py-1 bg-red-100 text-red-600 text-xs font-semibold rounded-full">
              🎉 이벤트
            </span>
          )}
          {product.salesType === 'pre_order' && (
            <span className="px-3 py-1 bg-blue-100 text-blue-600 text-xs font-semibold rounded-full">
              📅 예약판매
            </span>
          )}
          {product.salesType === 'group_buy' && (
            <span className="px-3 py-1 bg-purple-100 text-purple-600 text-xs font-semibold rounded-full">
              👥 공동구매
            </span>
          )}
          {(product.tags ?? []).map((tag) => (
            <span
              key={tag.id}
              className="px-3 py-1 bg-secondary-100 text-secondary-600 text-xs rounded-full"
            >
              #{tag.name}
            </span>
          ))}
        </div>
      )}

      {/* ── 재고 상태 ── */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-secondary-500">재고</span>
        {isOutOfStock ? (
          <span className="text-red-500 font-semibold">품절</span>
        ) : (
          <span className="text-secondary-900 font-medium">
            {product.stockQuantity.toLocaleString()}개 남음
          </span>
        )}
      </div>

      {/* ── 수량 선택 ── */}
      {!isOutOfStock && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-secondary-600" id="product-qty-label">수량</span>
          <div role="group" aria-labelledby="product-qty-label" className="flex items-center border border-secondary-300 rounded-lg overflow-hidden">
            <button
              aria-label="수량 줄이기"
              onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
              className="w-9 h-9 flex items-center justify-center text-secondary-600 hover:bg-secondary-50 transition-colors font-bold"
            >
              −
            </button>
            <span className="w-10 text-center text-sm font-semibold select-none" aria-live="polite">
              {quantity}<span className="sr-only">개</span>
            </span>
            <button
              aria-label="수량 늘리기"
              onClick={() =>
                onQuantityChange(Math.min(product.stockQuantity, quantity + 1))
              }
              className="w-9 h-9 flex items-center justify-center text-secondary-600 hover:bg-secondary-50 transition-colors font-bold"
            >
              +
            </button>
          </div>
          <span className="text-sm text-secondary-500">
            최대 {product.stockQuantity}개
          </span>
        </div>
      )}

      {/* ── 버튼 영역 ── */}
      <div className="space-y-2.5">
        {/* 구매하기 */}
        <button
          onClick={handleBuyNow}
          disabled={isOutOfStock || addToCart.isPending}
          className="w-full py-4 rounded-xl font-semibold text-base transition-all duration-200 bg-primary-600 text-white hover:bg-primary-700 active:scale-95 disabled:bg-secondary-300 disabled:text-secondary-500 disabled:cursor-not-allowed"
        >
          {addToCart.isPending ? '처리 중...' : isOutOfStock ? '품절' : '구매하기'}
        </button>

        {/* 장바구니 추가 */}
        <button
          onClick={handleAddToCart}
          disabled={isOutOfStock || addToCart.isPending}
          className={`w-full py-3.5 rounded-xl font-semibold text-base transition-all duration-200 border ${
            isOutOfStock
              ? 'border-secondary-200 text-secondary-400 cursor-not-allowed'
              : addToCart.isPending
              ? 'border-primary-300 text-primary-400 cursor-wait'
              : addToCart.isSuccess
              ? 'border-green-600 text-green-700 bg-green-50'
              : 'border-primary-600 text-primary-600 hover:bg-primary-50 active:scale-95'
          }`}
        >
          {cartButtonLabel}
        </button>
        {/* 담기 결과는 버튼 글자만 바뀌어 스크린리더가 못 들었다 → 늘 있는 status 영역에 문구를 넣어 읽게 한다 */}
        <p role="status" className="sr-only">
          {addToCart.isSuccess ? '장바구니에 담았습니다' : ''}
        </p>
      </div>

      {/* ── 에러 메시지 (재고 부족 등) ── */}
      {addToCart.isError && (
        <p role="alert" className="text-red-600 text-sm text-center -mt-3">
          {(addToCart.error as any)?.response?.data?.message ?? '오류가 발생했습니다.'}
        </p>
      )}

      {/* ── 셀러 정보 ── */}
      {product.seller && (
        <div className="border-t pt-4 border-secondary-100 space-y-1">
          <p className="text-xs text-secondary-500">판매자</p>
          <p className="text-sm font-semibold text-secondary-800">
            {product.seller.businessName}
          </p>
          <p className="text-xs text-secondary-500">{product.seller.representativeName}</p>
        </div>
      )}

      {/* ── 카테고리 ── */}
      {product.category && (
        <div className="text-xs space-y-0.5">
          <p className="text-secondary-500">카테고리</p>
          <p className="text-secondary-700 font-medium">{product.category.name}</p>
        </div>
      )}
    </div>
  );
}
