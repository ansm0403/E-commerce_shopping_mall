'use client';

import { useQuery } from '@tanstack/react-query';
import { productsQueryOptions } from '@/lib/react-query/products-query-options';
import ProductCard, { ProductCardSkeleton } from '@/components/home/ProductCard';

interface RelatedProductsProps {
  categoryId: number | null;
  currentProductId: number;
}

export default function RelatedProducts({
  categoryId,
  currentProductId,
}: RelatedProductsProps) {
  const { data, isLoading } = useQuery(
    productsQueryOptions.paginate({
      page: 1,
      limit: 10,
      categoryId: categoryId ?? undefined,
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    })
  );

  // 응답 몸통이 배열이 아니면(Sentry 7747424036 ".filter is not a function") 빈 목록 — `?? []` 는 null/undefined 만 막았다(Ops Companion 분석 #63)
  const raw = data?.data?.data;
  const response: any[] = Array.isArray(raw) ? raw : [];

  const products = response
    .filter((p: any) => p.id !== currentProductId)
    .slice(0, 5);

  if (isLoading) {
    return (
      <div className="bg-secondary-50 border-t">
        <div className="max-w-[1200px] mx-auto px-8 py-12">
          <h2 className="text-2xl font-bold text-secondary-900 mb-8">
            관련 상품
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <div className="bg-secondary-50 border-t">
      <div className="max-w-[1200px] mx-auto px-8 py-12">
        <h2 className="text-2xl font-bold text-secondary-900 mb-8">
          관련 상품
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {products.map((product: any) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </div>
  );
}
