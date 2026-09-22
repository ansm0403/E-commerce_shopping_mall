'use client';

import { useState } from 'react';
import { useCategories } from '@/hooks/useCategories';
import { useProducts } from '@/hook/useProduct';
import { PaginatedProducts } from '@/model/product';
import SectionHeader from './SectionHeader';
import ProductCard, { ProductCardSkeleton } from './ProductCard';

const TAB_PRODUCT_COUNT = 8;

function TabButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-full transition-colors whitespace-nowrap
        ${isActive
          ? 'bg-primary-600 text-white'
          : 'text-secondary-600 hover:text-primary-600 hover:bg-primary-50'
        }`}
    >
      {label}
    </button>
  );
}

function CategoryProducts({ categoryId }: { categoryId: number }) {
  const { data, isLoading, isError } = useProducts.Paginate({
    page: 1,
    limit: TAB_PRODUCT_COUNT,
    sortBy: 'viewCount',
    sortOrder: 'DESC',
    categoryId,
  });

  const result = data?.data as PaginatedProducts | undefined;
  // ProductSection 과 같은 가드(배열 아님 · null 항목). 같은 응답을 읽는 네 번째 호출 지점 — Sentry 스택은 ProductSection 만 가리켰고,
  // AI 분석도 사실 메모도 이 파일을 적지 않았다. 수정 후 프로브가 홈에서 같은 에러를 다시 내서 드러났다(Phase 8 B, 9편 6장)
  const products = Array.isArray(result?.data) ? result.data.filter((p) => p != null) : [];

  if (isError) {
    return (
      <div className="text-center py-12 text-secondary-400">
        상품을 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-px bg-secondary-200 mt-4">
      {isLoading
        ? Array.from({ length: TAB_PRODUCT_COUNT }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))
        : products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
    </div>
  );
}

export default function CategoryTabSection() {
  const { roots, isLoading } = useCategories();
  const [activeId, setActiveId] = useState<number | null>(null);

  const selectedId = activeId ?? roots[0]?.id ?? null;
  const selectedCategory = roots.find((c) => c.id === selectedId);

  if (isLoading) {
    return (
      <section className="py-10">
        <div className="h-7 w-40 bg-secondary-100 rounded animate-pulse mb-5" />
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 w-20 bg-secondary-100 rounded-full animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (!roots.length) return null;

  return (
    <section className="py-10">
      <SectionHeader
        title="카테고리별 인기 상품"
        description="카테고리를 선택해 인기 상품을 확인해보세요"
        href={selectedCategory ? `/products?categoryId=${selectedId}` : '/products'}
      />

      {/* 탭 목록 */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {roots.map((category) => (
          <TabButton
            key={category.id}
            label={category.name}
            isActive={category.id === selectedId}
            onClick={() => setActiveId(category.id)}
          />
        ))}
      </div>

      {/* 선택된 카테고리 상품 */}
      {selectedId && <CategoryProducts categoryId={selectedId} />}
    </section>
  );
}
