'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { OrderQuery, ShipOrderRequest } from '@shopping-mall/shared';
import {
  fetchSellerOrders,
  shipOrder,
  type SellerOrdersResponse,
} from '../service/seller-order';

/** 셀러 주문/배송 쿼리·뮤테이션 (01-seller-core §1-A③) — 규칙은 다른 *-query-options 와 동일 */

const SELLER_ORDER_KEY = ['seller', 'orders'] as const;

export function useSellerOrdersQuery(query: OrderQuery) {
  return useQuery<SellerOrdersResponse>({
    queryKey: [...SELLER_ORDER_KEY, query.page ?? 1, query.take ?? 20, query.status ?? 'all'],
    queryFn: async () => (await fetchSellerOrders(query)).data,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useShipOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderNumber, dto }: { orderNumber: string; dto: ShipOrderRequest }) =>
      shipOrder(orderNumber, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SELLER_ORDER_KEY }),
  });
}

/** 서버 에러 → 화면 문구. 상태 전이 400 은 백엔드 message 가 정확하다. */
export function sellerOrderErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('\n');
    if (error.response?.status === 403) {
      return '본인의 상품이 포함된 주문만 처리할 수 있습니다.';
    }
  }
  return '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
}
