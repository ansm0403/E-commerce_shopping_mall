'use client';

/**
 * [OPT-2] ProductDetailClient — RSC/CC 경계의 클라이언트 진입점
 *
 * 이전 구조:
 *   page.tsx(CC)에서 useQuery로 product 데이터 fetch 후 이 컴포넌트에 Product 객체 전달
 *
 * 개선 구조:
 *   page.tsx(RSC)에서 prefetchQuery로 서버에서 데이터 준비
 *   → HydrationBoundary로 캐시를 클라이언트에 직렬화 전송
 *   → 이 컴포넌트에서 useQuery → 캐시 히트 (추가 네트워크 요청 없음)
 *
 * props 변경: product: Product → productId: number
 * 이유: RSC page.tsx가 product 객체 대신 id만 전달하면 충분.
 *       실제 데이터는 React Query 캐시에서 꺼냄.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { productsQueryOptions } from '@/lib/react-query/products-query-options';
import { Skeleton } from '@/components/common/Skeleton/Skeleton';
import ProductGallery from './ProductGallery';
import ProductInfo from './ProductInfo';
import ProductTabs from './ProductTabs';
import RelatedProducts from './RelatedProducts';

interface ProductDetailClientProps {
  productId: number;
}

export default function ProductDetailClient({ productId }: ProductDetailClientProps) {
  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState('description');

  const { data, isLoading, isError, error } = useQuery(
    productsQueryOptions.detail(productId)
  );

  if (isLoading) {
    return <ProductDetailSkeleton />;
  }

  if (isError || !data?.data) {
    return (
      <div className="max-w-[1200px] mx-auto px-8 py-20 text-center">
        <h1 className="text-2xl font-bold text-secondary-900 mb-4">
          상품을 찾을 수 없습니다
        </h1>
        <p className="text-secondary-500">
          {error instanceof Error ? error.message : '상품 조회에 실패했습니다'}
        </p>
      </div>
    );
  }

  const product = data.data;

  return (
    <div className="min-h-screen bg-white">
      {/* 메인 섹션 */}
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 md:px-8 py-6 sm:py-8 md:py-12">
        {/* 갤러리 + 정보 2단 레이아웃 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mb-8 md:mb-12">
          {/* 좌측: 갤러리 (2/3) — LCP 이미지 포함, priority 적용됨 */}
          <div className="md:col-span-2">
            <ProductGallery images={product.images} />
          </div>

          {/* 우측: 상품 정보 (1/3) */}
          <div>
            <ProductInfo
              product={product}
              quantity={quantity}
              onQuantityChange={setQuantity}
            />
          </div>
        </div>

        {/* 탭 섹션 */}
        <ProductTabs
          product={product}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>

      {/* 관련 상품 — 별도 Suspense 경계로 메인 콘텐츠 블로킹 방지 */}
      <RelatedProducts categoryId={product.categoryId} currentProductId={product.id} />
    </div>
  );
}

function ProductDetailSkeleton() {
  return (
    <div className="max-w-[1200px] mx-auto px-8 py-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
        {/* 갤러리 스켈레톤 */}
        <div className="md:col-span-2">
          <Skeleton className="w-full aspect-square rounded-lg mb-4" />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="w-full aspect-square rounded" />
            ))}
          </div>
        </div>

        {/* 정보 섹션 스켈레톤 */}
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-10 w-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
          </div>
          <Skeleton className="h-12 w-full" />
        </div>
      </div>

      {/* 탭 스켈레톤 */}
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
