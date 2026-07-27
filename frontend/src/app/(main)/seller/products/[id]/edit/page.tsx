'use client';

import { use } from 'react';
import Link from 'next/link';
import ProductForm from '../../components/ProductForm';
import { useMyProductQuery } from '../../../../../../hooks/seller-product-query-options';

/**
 * 셀러 상품 수정 (01-seller-core §1-A②).
 * 데이터 출처는 GET /v1/products/my/:id — 공개 상세와 달리 HIDDEN·반려 상품도 보인다.
 * 저장(PATCH /v1/products/:id)하면 승인/반려 상태였던 상품은 재심사(PENDING)로 돌아간다
 * — 반려 상품의 재제출 경로가 바로 이 화면이다.
 */
export default function SellerProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const productId = Number(id);

  const { data, isLoading, isError } = useMyProductQuery(
    Number.isFinite(productId) ? productId : null,
  );

  if (isLoading) {
    return <div className="py-20 text-center text-sm text-gray-500">상품 정보를 불러오는 중…</div>;
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-sm text-gray-500">
        <p>상품 정보를 불러오지 못했습니다. 본인 상품이 맞는지 확인해주세요.</p>
        <Link href="/seller/products" className="text-blue-600 underline">
          상품 목록으로
        </Link>
      </div>
    );
  }

  return (
    <div className="flex justify-center py-4">
      <ProductForm initial={data} />
    </div>
  );
}
