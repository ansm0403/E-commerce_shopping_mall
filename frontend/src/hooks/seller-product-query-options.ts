'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type {
  CreateProductRequest,
  SellerProduct,
  SellerProductQuery,
  SellerSettableStatus,
  UpdateProductRequest,
} from '@shopping-mall/shared';
import {
  createProduct,
  deleteProduct,
  fetchMyProduct,
  fetchMyProducts,
  updateProduct,
  updateProductStatus,
  uploadProductImages,
  type SellerProductsResponse,
} from '../service/seller-product';

/**
 * 셀러 상품 쿼리·뮤테이션 (01-seller-core §1-A②).
 * admin-product-query-options.ts 와 같은 규칙 — 필터 전부를 queryKey 에 넣고 focus refetch 는 끈다.
 */

const SELLER_PRODUCT_KEY = ['seller', 'products'] as const;

export function useMyProductsQuery(query: SellerProductQuery) {
  return useQuery<SellerProductsResponse>({
    queryKey: [
      ...SELLER_PRODUCT_KEY,
      query.page ?? 1,
      query.take ?? 20,
      query.approvalStatus ?? 'all',
      query.status ?? 'all',
    ],
    queryFn: async () => (await fetchMyProducts(query)).data,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useMyProductQuery(id: number | null) {
  return useQuery<SellerProduct>({
    queryKey: [...SELLER_PRODUCT_KEY, 'detail', id],
    queryFn: async () => (await fetchMyProduct(id as number)).data,
    enabled: id != null && Number.isFinite(id),
    staleTime: 0, // 수정 화면 진입 시 항상 최신을 읽는다(반려 사유 등)
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * 등록 = 2단계 API (POST /products → POST /products/:id/images).
 * 이미지 업로드가 중간에 실패해도 상품 자체는 만들어진 상태이므로,
 * 호출부는 실패를 "등록 실패"가 아니라 "이미지만 추가 못 함"으로 안내해야 한다.
 */
export function useCreateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ dto, images }: { dto: CreateProductRequest; images: File[] }) => {
      const product = (await createProduct(dto)).data;
      if (images.length > 0) {
        try {
          await uploadProductImages(product.id, images);
        } catch (error) {
          throw new ImageUploadError(product.id, error);
        }
      }
      return product;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SELLER_PRODUCT_KEY }),
  });
}

/** 이미지 업로드 단계 실패 — 상품은 이미 생성됐음을 호출부에 알린다 */
export class ImageUploadError extends Error {
  constructor(
    public readonly productId: number,
    public override readonly cause: unknown,
  ) {
    super('상품은 등록됐지만 이미지 업로드에 실패했습니다.');
  }
}

export function useUpdateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      dto,
      images,
    }: {
      id: number;
      dto: UpdateProductRequest;
      images?: File[];
    }) => {
      const product = (await updateProduct(id, dto)).data;
      if (images && images.length > 0) {
        try {
          await uploadProductImages(id, images);
        } catch (error) {
          throw new ImageUploadError(id, error);
        }
      }
      return product;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SELLER_PRODUCT_KEY }),
  });
}

export function useUpdateProductStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: SellerSettableStatus }) =>
      updateProductStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SELLER_PRODUCT_KEY }),
  });
}

export function useDeleteProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteProduct(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SELLER_PRODUCT_KEY }),
  });
}

/** 서버 에러 → 화면 문구. 400(상태 전이·삭제 제약)은 백엔드 message 가 가장 정확하다. */
export function sellerProductErrorMessage(error: unknown): string {
  if (error instanceof ImageUploadError) {
    return `${error.message} 상품 수정 화면에서 이미지를 다시 올려주세요.`;
  }
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('\n');
    if (error.response?.status === 403) {
      return '승인된 셀러만 사용할 수 있습니다. 셀러 승인 상태를 확인해주세요.';
    }
  }
  return '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
}
