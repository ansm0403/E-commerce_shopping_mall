'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { hasRole } from '@/lib/roles';
import { wishlistQueryOptions } from '@/lib/react-query/wishlist-query-options';
import { useClearWishlist, useWishlistToggle } from '@/hooks/useWishlist';
import { useAddToCart } from '@/hooks/useCart';
import { userErrorMessage } from '@/service/user';
import { wishlistImageUrl, type WishlistItem } from '@/service/wishlist';
import { Modal } from '@/components/common/Modal';

const PAGE_SIZE = 12;

/**
 * 위시리스트 — GET /wishlist. 로그인 가드는 my/layout.tsx.
 *   이 상품 빼기  = POST /wishlist/toggle (낙관적으로 ids 갱신 → 상품 상세 하트와 같은 캐시)
 *   전체 비우기   = DELETE /wishlist (확인 모달)
 */
export default function MyWishlistPage() {
  const { user } = useAuth();
  const isBuyer = hasRole(user, 'buyer');
  const [page, setPage] = useState(1);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clearMutation = useClearWishlist();

  const { data, isLoading, isError, isFetching } = useQuery({
    ...wishlistQueryOptions.list(page, PAGE_SIZE),
    enabled: isBuyer,
  });

  const items = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const lastPage = Math.max(1, data?.meta.totalPages ?? 1);

  // 제거로 현재 페이지가 마지막 페이지를 넘어가면 당긴다
  useEffect(() => {
    if (data && page > lastPage) setPage(lastPage);
  }, [data, page, lastPage]);

  const closeClear = () => {
    setClearOpen(false);
    setClearError(null);
  };

  const confirmClear = async () => {
    setClearError(null);
    try {
      await clearMutation.mutateAsync();
      closeClear();
      setPage(1);
      setNotice('위시리스트를 비웠습니다.');
    } catch (error) {
      setClearError(userErrorMessage(error));
    }
  };

  if (!isBuyer) {
    return (
      <div>
        <h1 className="text-xl font-bold text-secondary-900 mb-4">위시리스트</h1>
        <p className="rounded-lg bg-secondary-50 px-4 py-3 text-sm text-secondary-700">
          위시리스트는 구매자 계정에서만 사용할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-secondary-900">
          위시리스트 {total > 0 && <span className="text-secondary-600">({total})</span>}
        </h1>
        {total > 0 && (
          <button
            onClick={() => {
              setNotice(null);
              setClearOpen(true);
            }}
            className="rounded-lg border border-secondary-300 px-3 py-1.5 text-sm font-semibold text-secondary-700 hover:bg-secondary-50"
          >
            전체 비우기
          </button>
        )}
      </div>
      <p role="status" className="mb-4 min-h-5 text-sm text-green-700">
        {notice}
      </p>

      {isLoading && items.length === 0 ? (
        <div className="py-20 text-center text-secondary-600">불러오는 중...</div>
      ) : isError ? (
        <div role="alert" className="py-20 text-center text-secondary-600">
          위시리스트를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </div>
      ) : items.length === 0 ? (
        <div className="py-20 text-center text-secondary-600">
          <p>찜한 상품이 없습니다.</p>
          <p className="text-sm mt-2">상품 상세에서 하트를 눌러 담아 보세요.</p>
          <Link href="/products" className="inline-block mt-4 text-primary-700 underline text-sm">
            상품 보러 가기
          </Link>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {items.map((item) => (
              <WishlistCard key={item.id} item={item} />
            ))}
          </ul>

          {lastPage > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isFetching}
                className="px-4 py-2 text-sm border border-secondary-300 rounded-lg text-secondary-700 hover:bg-secondary-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                이전
              </button>
              <span className="text-sm text-secondary-600">
                {page} / {lastPage}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                disabled={page >= lastPage || isFetching}
                className="px-4 py-2 text-sm border border-secondary-300 rounded-lg text-secondary-700 hover:bg-secondary-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                다음
              </button>
            </div>
          )}
        </>
      )}

      <Modal isOpen={clearOpen} onClose={closeClear} title="위시리스트 비우기" size="sm">
        <p className="text-sm text-secondary-700">
          찜한 상품 {total}개를 모두 뺄까요? 되돌릴 수 없습니다.
        </p>
        {clearError && (
          <p role="alert" className="mt-3 text-sm text-red-600 whitespace-pre-line">
            {clearError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={closeClear}
            disabled={clearMutation.isPending}
            className="px-4 py-2 text-sm border border-secondary-300 rounded-lg text-secondary-700 hover:bg-secondary-50"
          >
            취소
          </button>
          <button
            onClick={confirmClear}
            disabled={clearMutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
          >
            {clearMutation.isPending ? '비우는 중...' : '모두 빼기'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function WishlistCard({ item }: { item: WishlistItem }) {
  const toggle = useWishlistToggle();
  const addToCart = useAddToCart();
  const product = item.product;

  // 장바구니 담기 성공 표시를 2초 뒤 되돌린다(상품 상세와 같은 동작)
  useEffect(() => {
    if (!addToCart.isSuccess) return;
    const timer = setTimeout(() => addToCart.reset(), 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addToCart.isSuccess]);

  // 찜한 뒤 판매가 중단된 상품 — 장바구니에 담을 수 없다(서버도 400). 빼기는 가능해야 한다.
  const purchasable = product?.status === 'published';
  const name = product?.name ?? `상품 #${item.productId}`;
  // 사진이 없거나(옛 응답·미등록) 깨진 링크면 빈 회색 칸으로 둔다 — 깨진 이미지 아이콘을 보여 주지 않는다
  const imageUrl = wishlistImageUrl(product);
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-secondary-200 bg-white p-4">
      <div className="flex gap-3">
        {/* 사진은 상품 링크의 장식이다 — 상품 이름이 바로 옆 링크에 있으므로 대체 텍스트는 비운다(이름을 두 번 읽지 않게) */}
        <Link
          href={`/products/${item.productId}`}
          tabIndex={-1}
          aria-hidden="true"
          className="block h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-secondary-100"
        >
          {imageUrl && !imageFailed && (
            // eslint-disable-next-line @next/next/no-img-element -- 외부 링크·/uploads 가 섞여 있어 상품 카드(ProductCard)와 같이 img 로 그린다
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setImageFailed(true)}
            />
          )}
        </Link>
      <div className="min-w-0">
        {product?.brand && <p className="text-xs text-secondary-600">{product.brand}</p>}
        <Link
          href={`/products/${item.productId}`}
          className="block text-sm font-semibold text-secondary-900 hover:text-primary-700 break-words"
        >
          {name}
        </Link>
        {product && (
          <p className="mt-1 text-sm text-secondary-900">
            <span className="font-bold">{Number(product.price).toLocaleString()}원</span>
            {Number(product.rating) > 0 && (
              <span className="ml-2 text-xs text-secondary-600">평점 {Number(product.rating).toFixed(1)}</span>
            )}
          </p>
        )}
        {!purchasable && (
          <p className="mt-1 text-xs font-semibold text-red-700">지금은 판매하지 않는 상품입니다.</p>
        )}
      </div>
      </div>

      <div className="mt-auto flex gap-2">
        <button
          onClick={() => addToCart.mutate({ productId: item.productId, quantity: 1 })}
          disabled={!purchasable || addToCart.isPending}
          aria-label={`${name} 장바구니 담기`}
          className="flex-1 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-secondary-200 disabled:text-secondary-600"
        >
          {addToCart.isPending ? '담는 중...' : addToCart.isSuccess ? '✓ 담았습니다' : '장바구니 담기'}
        </button>
        <button
          onClick={() => toggle.mutate(item.productId)}
          disabled={toggle.isPending}
          aria-label={`${name} 위시리스트에서 빼기`}
          className="rounded-lg border border-secondary-300 px-3 py-2 text-sm font-semibold text-secondary-700 hover:bg-secondary-50 disabled:opacity-50"
        >
          빼기
        </button>
      </div>
    </li>
  );
}
