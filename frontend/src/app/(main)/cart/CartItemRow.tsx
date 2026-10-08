'use client';

import { FaTrash } from 'react-icons/fa';
import { CartItem } from '@/model/cart';
import { useUpdateCartItem, useRemoveCartItem } from '@/hooks/useCart';

interface CartItemRowProps {
  item: CartItem;
}

export default function CartItemRow({ item }: CartItemRowProps) {
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();

  const { product, quantity, id: itemId } = item;
  const isOutOfStock = product.status === 'sold_out' || product.stockQuantity === 0;
  const totalPrice = product.price * quantity;

  const handleDecrease = () => {
    if (quantity <= 1) return;
    updateItem.mutate({ itemId, quantity: quantity - 1 });
  };

  const handleIncrease = () => {
    if (quantity >= product.stockQuantity) return;
    updateItem.mutate({ itemId, quantity: quantity + 1 });
  };

  const handleRemove = () => {
    removeItem.mutate(itemId);
  };

  const isMutating = updateItem.isPending || removeItem.isPending;

  return (
    <div className={`grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 p-4 bg-white rounded-2xl border border-primary-100 transition-opacity sm:flex sm:gap-4 ${isMutating ? 'opacity-50' : ''}`}>

      {/* 브랜드 이니셜 아바타 */}
      <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl bg-[#e9eee4] flex items-center justify-center shrink-0">
        <span className="text-primary-600 font-bold text-xl">
          {product.brand.charAt(0).toUpperCase()}
        </span>
      </div>

      {/* 상품 정보 */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-secondary-500 mb-0.5">{product.brand}</p>
        <p className="text-sm font-semibold text-secondary-900 truncate">{product.name}</p>
        <div className="flex items-center gap-1 mt-0.5">
          {product.discountRate != null && product.discountRate > 0 && (
            <span className="text-xs text-primary-600 font-bold">{product.discountRate}%↓</span>
          )}
          <span className="text-sm font-bold text-secondary-900">
            {Number(product.price).toLocaleString()}원
          </span>
        </div>
        {isOutOfStock && (
          <span className="text-xs text-red-500 font-medium">품절</span>
        )}
      </div>

      {/* 수량 조절 */}
      <div className="col-start-2 row-start-2 justify-self-start flex items-center border border-secondary-300 rounded-lg overflow-hidden shrink-0">
        <button
          onClick={handleDecrease}
          disabled={isMutating || quantity <= 1}
          aria-label={`${product.name} 수량 줄이기`}
          className="w-8 h-8 flex items-center justify-center text-secondary-600 hover:bg-secondary-50 disabled:opacity-30 transition-colors font-bold text-lg"
        >
          −
        </button>
        {/* 수량이 바뀌면 스크린리더가 새 값을 읽는다(버튼만 누르고 결과를 못 듣던 자리) */}
        <span className="w-8 text-center text-sm font-semibold select-none" aria-live="polite">
          <span className="sr-only">수량 </span>{quantity}<span className="sr-only">개</span>
        </span>
        <button
          onClick={handleIncrease}
          disabled={isMutating || quantity >= product.stockQuantity}
          aria-label={`${product.name} 수량 늘리기`}
          className="w-8 h-8 flex items-center justify-center text-secondary-600 hover:bg-secondary-50 disabled:opacity-30 transition-colors font-bold text-lg"
        >
          +
        </button>
      </div>

      {/* 합계 금액 */}
      <div className="col-start-3 row-start-2 text-right shrink-0 sm:w-24">
        <p className="text-sm font-bold text-secondary-900">
          {totalPrice.toLocaleString()}원
        </p>
      </div>

      {/* 삭제 버튼 */}
      <button
        onClick={handleRemove}
        disabled={isMutating}
        className="col-start-3 row-start-1 justify-self-end p-2 text-secondary-500 hover:text-red-600 disabled:opacity-30 transition-colors shrink-0 sm:order-last"
        aria-label={`${product.name} 장바구니에서 제거`}
      >
        <FaTrash size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
