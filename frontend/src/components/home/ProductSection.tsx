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
  const products = result?.data ?? [];

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
