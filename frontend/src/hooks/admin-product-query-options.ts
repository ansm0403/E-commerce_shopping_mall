'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminProductQuery } from '@shopping-mall/shared';
import { AxiosError } from 'axios';
import {
  approveProduct,
  fetchAdminProducts,
  rejectProduct,
  type AdminProductsResponse,
} from '../service/admin-product';

/**
 * 관리자 상품 승인/반려 쿼리·뮤테이션 (02-admin-core §2-A②).
 * admin-seller-query-options.ts 와 같은 규칙 — 필터 전부를 queryKey 에 넣고 focus refetch 는 끈다.
 */

const ADMIN_PRODUCT_KEY = ['admin', 'products'] as const;

export function useAdminProductsQuery(query: AdminProductQuery) {
  return useQuery<AdminProductsResponse>({
    queryKey: [
      ...ADMIN_PRODUCT_KEY,
      query.page ?? 1,
      query.take ?? 20,
      query.approvalStatus ?? 'all',
      query.status ?? 'all',
      query.categoryId ?? null,
      query.sellerId ?? null,
    ],
    queryFn: async () => (await fetchAdminProducts(query)).data,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useApproveProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => approveProduct(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_PRODUCT_KEY }),
  });
}

export function useRejectProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => rejectProduct(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_PRODUCT_KEY }),
  });
}

/**
 * 서버 에러 → 화면 문구.
 * 403 은 DemoAccountGuard(데모 계정) 아니면 RolesGuard(권한 없음)라
 * 백엔드가 준 message 를 그대로 살리는 편이 정확하다.
 */
export function productMutationErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
    if (error.response?.status === 403) return '권한이 없습니다. (데모 계정이거나 관리자가 아님)';
  }
  return '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
}
