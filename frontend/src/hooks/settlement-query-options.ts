'use client';

import { useQuery } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { SettlementQuery, SettlementSummary } from '@shopping-mall/shared';
import {
  fetchMySettlements,
  fetchMySettlementSummary,
  type SettlementsResponse,
} from '../service/settlement';

/** 셀러 정산 쿼리 (01-seller-core §1-A④) */

const SELLER_SETTLEMENT_KEY = ['seller', 'settlements'] as const;

export function useMySettlementsQuery(query: SettlementQuery) {
  return useQuery<SettlementsResponse>({
    queryKey: [...SELLER_SETTLEMENT_KEY, query.page ?? 1, query.take ?? 20, query.status ?? 'all'],
    queryFn: async () => (await fetchMySettlements(query)).data,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useMySettlementSummaryQuery() {
  return useQuery<SettlementSummary>({
    queryKey: [...SELLER_SETTLEMENT_KEY, 'summary'],
    queryFn: async () => (await fetchMySettlementSummary()).data,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function settlementErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('\n');
  }
  return '정산 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
}
