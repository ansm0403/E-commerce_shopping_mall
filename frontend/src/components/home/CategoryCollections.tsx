'use client';

import Link from 'next/link';
import { useCategories } from '@/hooks/useCategories';
import { useProducts } from '@/hook/useProduct';
import { CategoryTreeNode } from '@/service/category';
import { PaginatedProducts } from '@/model/product';
import { getProductImageUrl } from './ProductCard';
import ProductPhoto from './ProductPhoto';
import SectionHeader from './SectionHeader';

const LABELS: Record<string, string> = {
  clothing: '나를 표현하는 옷',
  beauty: '나를 위한 작은 루틴',
  shoes: '새로운 발걸음',
  book: '책과 보내는 시간',
  food: '맛있는 일상',
  living: '기분 좋은 공간',
};
const TONES = [
  '#eeeae2',
  '#eceee6',
  '#e9ecee',
  '#ece8e2',
  '#f1ebe0',
  '#e9ece6',
];

function Collection({
  category,
  index,
}: {
  category: CategoryTreeNode;
  index: number;
}) {
  // 카테고리 인기 상품 탭과 캐시를 공유한다.
  const { data } = useProducts.Paginate({
    page: 1,
    limit: 8,
    categoryId: category.id,
    sortBy: 'viewCount',
    sortOrder: 'DESC',
  });
  const result = data?.data as PaginatedProducts | undefined;
  const product = Array.isArray(result?.data)
    ? result.data.find(Boolean)
    : undefined;
  return (
    <Link
      href={`/products?categoryId=${category.id}`}
      className="group min-w-0"
    >
      <div
        className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-2xl p-5"
        style={{ backgroundColor: TONES[index % TONES.length] }}
      >
        {product ? (
          <ProductPhoto
            src={getProductImageUrl(product)}
            alt=""
            className="h-full w-full object-contain mix-blend-multiply transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <span
            aria-hidden="true"
            className="text-4xl font-light text-primary-300"
          >
            0{index + 1}
          </span>
        )}
        <span
          aria-hidden="true"
          className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-primary-600 transition-transform group-hover:-translate-y-1"
        >
          ↗
        </span>
      </div>
      <h3 className="mt-3 text-sm font-semibold text-primary-600">
        {category.name}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-primary-400">
        {LABELS[category.slug] ?? `${category.name} 둘러보기`}
      </p>
    </Link>
  );
}

export default function CategoryCollections() {
  const { roots, isLoading, isError } = useCategories();
  if (!isLoading && (isError || !roots.length)) return null;
  return (
    <section className="pt-12 sm:pt-16">
      <SectionHeader
        title="어떤 취향을 찾고 있나요?"
        description="일상을 채우는 새로운 발견"
        href="/products"
      />
      <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-6 sm:gap-4">
        {isLoading
          ? Array.from({ length: 6 }, (_, i) => (
              <div
                key={i}
                className="aspect-[4/5] animate-pulse rounded-2xl bg-primary-50"
              />
            ))
          : roots.map((category, index) => (
              <Collection key={category.id} category={category} index={index} />
            ))}
      </div>
    </section>
  );
}
