'use client';

import Link from 'next/link';
import { Product } from '@/model/product';

interface ProductCardProps {
  product: Product;
}

function getProductImageUrl(product: Product): string {
  const images = product.images ?? [];
  const primary = images.find((img) => img.isPrimary);
  return primary?.url ?? images[0]?.url ?? '/images/placeholder.png';
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
    <Link
      href={`/products/${product.id}`}
      className="group relative block overflow-hidden aspect-[3/4] bg-secondary-200"
    >
      <img
        src={imageUrl}
        alt={product.name}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
        }}
      />

      {/* 상단 할인 뱃지 */}
      {hasDiscount && (
        <span className="absolute top-2.5 left-2.5 bg-primary-600 text-white text-xs font-bold px-2 py-1 rounded-sm leading-none tracking-wide z-10">
          -{product.discountRate}%
        </span>
      )}

      {/* 하단 그라데이션 오버레이 */}
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/30 to-transparent transition-opacity duration-300 group-hover:opacity-100 opacity-90" />

      {/* 텍스트 정보 */}
      <div className="absolute inset-x-0 bottom-0 p-3 translate-y-1 group-hover:translate-y-0 transition-transform duration-300">
        <p className="text-white/80 text-xs mb-0.5 line-clamp-1 tracking-wide">
          {product.category?.name ?? ''}
        </p>
        <p className="text-white text-sm font-semibold line-clamp-2 leading-snug mb-2">
          {product.name}
        </p>

        {/* 가격 행 */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-white font-bold text-base leading-none">
            {displayPrice.toLocaleString()}원
          </span>
          {originalPrice !== null && (
            <span className="text-white/45 text-xs line-through leading-none">
              {originalPrice.toLocaleString()}원
            </span>
          )}
        </div>

        {/* 별점 */}
        {product.rating != null && (
          <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <span className="text-yellow-400 text-xs leading-none">★</span>
            <span className="text-white/70 text-xs leading-none">
              {Number(product.rating).toFixed(1)}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

/** 로딩 스켈레톤 */
export function ProductCardSkeleton() {
  return (
    <div className="aspect-[3/4] bg-secondary-200 animate-pulse" />
  );
}
