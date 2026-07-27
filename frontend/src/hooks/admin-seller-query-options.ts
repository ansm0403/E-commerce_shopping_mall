'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SellerApplicationQuery } from '@shopping-mall/shared';
import { AxiosError } from 'axios';
import {
  approveSellerApplication,
  fetchSellerApplications,
  rejectSellerApplication,
  type SellerApplicationsResponse,
} from '../service/admin-seller';

/**
 * 관리자 셀러 신청 관리 쿼리/뮤테이션 (02-admin-core §2-A①).
 * useAuditQuery.ts 의 패턴을 따른다 — 필터 전부를 queryKey 에 넣고 focus refetch 는 끈다.
 */

const SELLER_KEY = ['admin', 'seller-applications'] as const;

export function useSellerApplicationsQuery(query: SellerApplicationQuery) {
  return useQuery<SellerApplicationsResponse>({
    queryKey: [...SELLER_KEY, query.page ?? 1, query.take ?? 20, query.status ?? 'all'],
    queryFn: async () => (await fetchSellerApplications(query)).data,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * 승인/반려 후 목록을 다시 읽는다.
 * 승인은 셀러 상태 변경 + 역할 부여가 한 트랜잭션이라(seller.service.ts approve),
 * 성공 응답이 곧 "SELLER 역할까지 부여됨"을 의미한다.
 */
export function useApproveSellerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => approveSellerApplication(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SELLER_KEY }),
  });
}

export function useRejectSellerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      rejectSellerApplication(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SELLER_KEY }),
  });
}

/**
 * 서버 에러를 화면에 띄울 문구로 변환.
 * 403 은 DemoAccountGuard(데모 계정) 아니면 RolesGuard(권한 없음) 둘 중 하나라
 * 백엔드가 준 message 를 그대로 살려 쓰는 편이 정확하다.
 */
export function sellerMutationErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
    if (error.response?.status === 403) return '권한이 없습니다. (데모 계정이거나 관리자가 아님)';
  }
  return '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
}
