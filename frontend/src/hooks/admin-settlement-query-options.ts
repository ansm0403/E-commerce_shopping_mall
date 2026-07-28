'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { SettlementQuery } from '@shopping-mall/shared';
import {
  confirmSettlement,
  fetchAdminSettlements,
  paySettlement,
} from '../service/admin-settlement';
import type { SettlementsResponse } from '../service/settlement';

/** 관리자 정산 쿼리·뮤테이션 (02-admin-core §2-A④) */

const ADMIN_SETTLEMENT_KEY = ['admin', 'settlements'] as const;

export function useAdminSettlementsQuery(query: SettlementQuery) {
  return useQuery<SettlementsResponse>({
    queryKey: [
      ...ADMIN_SETTLEMENT_KEY,
      query.page ?? 1,
      query.take ?? 20,
      query.status ?? 'all',
      query.sellerId ?? null,
    ],
    queryFn: async () => (await fetchAdminSettlements(query)).data,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useConfirmSettlementMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => confirmSettlement(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_SETTLEMENT_KEY }),
  });
}

export function usePaySettlementMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => paySettlement(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_SETTLEMENT_KEY }),
  });
}

/** 403 은 DemoAccountGuard(데모 계정) 아니면 RolesGuard — 다른 관리자 화면과 같은 규칙 */
export function adminSettlementErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('\n');
    if (error.response?.status === 403) return '권한이 없습니다. (데모 계정이거나 관리자가 아님)';
  }
  return '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
}
