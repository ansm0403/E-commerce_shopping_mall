'use client';

import Link from 'next/link';
import { Product } from '@/model/product';
import ProductPhoto from './ProductPhoto';

interface ProductCardProps {
  product: Product;
}

export function getProductImageUrl(product: Product): string {
  // images 가 배열이 아닌 응답(문자열) — Sentry 7747419820 "a.find is not a function". `?? []` 는 null/undefined 만 막았다(Ops Companion 분석 #59)
  const images = Array.isArray(product.images) ? product.images : [];
  const primary = images.find((img) => img.isPrimary);
  return primary?.url ?? images[0]?.url ?? '/images/placeholder.svg';
}

function getOriginalPrice(price: number, discountRate: number): number | null {
  if (discountRate <= 0 || discountRate >= 100) return null;
  return Math.round(Number(price) / (1 - discountRate / 100));
}

export default function ProductCard({ product }: ProductCardProps) {
  const hasDiscount = product.discountRate != null && product.discountRate > 0;
  const imageUrl = getProductImageUrl(product);
  const displayPrice = Number(product.price);
  const originalPrice = hasDiscount
    ? getOriginalPrice(displayPrice, product.discountRate!)
    : null;

  return (
    <Link href={`/products/${product.id}`} className="group block">
      {/* 사진 — 비율을 고정하고 연회색 면을 깔아 사진마다 배경이 달라도 그리드가 정돈돼 보이게 */}
      <div className="relative overflow-hidden aspect-[4/5] rounded-2xl bg-[#f3f3ef] p-4 sm:p-6">
        <ProductPhoto
          src={imageUrl}
          alt={product.name}
          className="h-full w-full object-contain mix-blend-multiply transition-transform duration-500 group-hover:scale-105"
        />
      </div>

      {/* 정보 — 사진 위에 겹치지 않고 아래에 둔다(사진을 가리지 않고, 어떤 사진에서도 읽힌다) */}
      <div className="pt-3 sm:pt-4">
        <p className="text-xs text-primary-400 line-clamp-1">
          {product.brand || product.category?.name || ' '}
        </p>
        <p className="mt-1.5 min-h-[2.75rem] text-sm text-primary-600 line-clamp-2 leading-snug group-hover:underline underline-offset-2">
          {product.name}
        </p>

        {/* 가격 행 — 할인율만 accent, 나머지는 흑백 */}
        <div className="mt-2 flex items-baseline gap-1.5 flex-wrap">
          {hasDiscount && (
            <span className="text-accent-600 font-bold text-[15px] leading-none">{product.discountRate}%</span>
          )}
          <span className="text-primary-600 font-bold text-[15px] leading-none">
            {displayPrice.toLocaleString()}원
          </span>
          {originalPrice !== null && (
            <span className="text-primary-400 text-xs line-through leading-none">
              {originalPrice.toLocaleString()}원
            </span>
          )}
        </div>

        {product.rating != null && Number(product.rating) > 0 && (
          <p className="mt-1.5 flex items-center gap-0.5 text-xs text-primary-400 leading-none">
            <span aria-hidden="true" className="text-primary-600">★</span>
            <span className="sr-only">평점</span>
            {Number(product.rating).toFixed(1)}
            {product.reviewCount != null && (
              <span className="ml-1">({product.reviewCount.toLocaleString()})</span>
            )}
          </p>
        )}
      </div>
    </Link>
  );
}

/** 로딩 스켈레톤 */
export function ProductCardSkeleton() {
  return (
    <div>
      <div className="aspect-[4/5] rounded-2xl bg-primary-50 animate-pulse" />
      <div className="mt-3 h-3 w-1/3 rounded bg-primary-50 animate-pulse" />
      <div className="mt-2 h-4 w-4/5 rounded bg-primary-50 animate-pulse" />
      <div className="mt-2 h-4 w-1/2 rounded bg-primary-50 animate-pulse" />
    </div>
  );
}
