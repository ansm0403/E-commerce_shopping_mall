'use client';

import { useProducts } from '@/hook/useProduct';
import { PaginateParam, SortBy, SortOrder } from '@/model/paginate-param';
import { PaginatedProducts } from '@/model/product';
import SectionHeader from './SectionHeader';
import ProductCard, { ProductCardSkeleton } from './ProductCard';

interface ProductSectionProps {
  title: string;
  description?: string;
  href?: string;
  sortBy: SortBy;
  sortOrder?: SortOrder;
  count?: number;
}

const SKELETON_COUNT = 8;

export default function ProductSection({
  title,
  description,
  href,
  sortBy,
  sortOrder = 'DESC',
  count = 8,
}: ProductSectionProps) {
  const param: PaginateParam = { page: 1, limit: count, sortBy, sortOrder };
  const { data, isLoading, isError } = useProducts.Paginate(param);

  // axios 응답: data.data = { data: Product[], meta: {...} }
  const result = data?.data as PaginatedProducts | undefined;
  // 배열이 아닌 목록(Sentry 7747420327 "x.map is not a function") · 목록 안의 null 항목(7747419604 "null.id") 둘 다 여기서 막는다.
  // `?? []` 는 null/undefined 만 막아 문자열은 통과했고, 항목 null 은 아래 product.id 에서 던졌다(Ops Companion 분석 #57·#61).
  const products = Array.isArray(result?.data) ? result.data.filter((p) => p != null) : [];

  return (
    <section className="py-10">
      <SectionHeader title={title} description={description} href={href} />

      {isError ? (
        <div className="text-center py-12 text-secondary-400">
          상품을 불러오지 못했습니다.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-px bg-secondary-200">
          {isLoading
            ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))
            : products.length === 0
              ? (
                <p className="col-span-full text-center py-12 text-secondary-400 bg-white">
                  상품이 없습니다.
                </p>
              )
              : products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                  />
                ))}
        </div>
      )}
    </section>
  );
}
