'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { Order, OrderQuery } from '@shopping-mall/shared';
import {
  deliverOrder,
  fetchAdminOrder,
  fetchAdminOrders,
  type AdminOrdersResponse,
} from '../service/admin-order';

/** 관리자 주문 쿼리·뮤테이션 (02-admin-core §2-A③) */

const ADMIN_ORDER_KEY = ['admin', 'orders'] as const;

export function useAdminOrdersQuery(query: OrderQuery) {
  return useQuery<AdminOrdersResponse>({
    queryKey: [...ADMIN_ORDER_KEY, query.page ?? 1, query.take ?? 20, query.status ?? 'all'],
    queryFn: async () => (await fetchAdminOrders(query)).data,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useAdminOrderQuery(orderNumber: string | null) {
  return useQuery<Order>({
    queryKey: [...ADMIN_ORDER_KEY, 'detail', orderNumber],
    queryFn: async () => (await fetchAdminOrder(orderNumber as string)).data,
    enabled: !!orderNumber,
    staleTime: 0, // 배송 처리 직후 최신 상태를 봐야 하는 화면
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useDeliverOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderNumber, sellerId }: { orderNumber: string; sellerId?: number }) =>
      deliverOrder(orderNumber, sellerId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_ORDER_KEY }),
  });
}

/**
 * 서버 에러 → 화면 문구.
 * 403 은 DemoAccountGuard(데모 계정) 아니면 RolesGuard — admin-product 와 같은 규칙.
 */
export function adminOrderErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('\n');
    if (error.response?.status === 403) return '권한이 없습니다. (데모 계정이거나 관리자가 아님)';
  }
  return '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
}
