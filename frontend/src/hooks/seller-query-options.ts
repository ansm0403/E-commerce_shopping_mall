'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError, isAxiosError } from 'axios';
import type { ApplySellerRequest, SellerApplication } from '@shopping-mall/shared';
import { applySeller, getMySellerInfo, stripEmptyOptionals } from '../service/seller';
import { refreshAccessToken } from '../lib/axios/axios-http-client';
import { tokenHasRole } from '../lib/jwt';

export const MY_SELLER_KEY = ['seller', 'me'] as const;

/**
 * 내 셀러 신청 현황.
 * 신청 이력이 없으면 백엔드가 404 를 준다 — 이건 에러가 아니라 "아직 신청 안 함"이므로
 * null 로 바꿔 정상 상태로 다룬다. (404 를 에러로 두면 화면이 실패 뷰로 빠진다)
 */
export function useMySellerQuery(enabled = true) {
  return useQuery<SellerApplication | null>({
    queryKey: MY_SELLER_KEY,
    queryFn: async () => {
      try {
        return (await getMySellerInfo()).data;
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 404) return null;
        throw error;
      }
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
  });
}

export function useApplySellerMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: ApplySellerRequest) => applySeller(stripEmptyOptionals(dto)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MY_SELLER_KEY }),
  });
}

export type RoleSyncState = 'idle' | 'syncing' | 'synced' | 'failed';

/**
 * 승인됐는데 손에 든 토큰이 낡은 경우를 해소한다 (00-role-audit §7-2 확정 방침, 백엔드 무변경).
 *
 * 인가는 토큰에 박힌 역할 기준이라, 관리자가 승인해도 신청자의 기존 액세스 토큰에는
 * 여전히 buyer 뿐이다 → `/auth/me` 는 seller 인데 셀러 API 는 403 인 어긋남이 생긴다.
 * `/auth/refresh` 는 DB 에서 역할을 다시 읽어 토큰을 만들므로(auth.service.ts refresh),
 * 갱신 한 번이면 해소된다. 그 한 번을 화면이 자동으로 태운다.
 *
 * - 딱 1회만 시도한다(useRef 플래그). 실패 시 재시도하지 않고 재로그인을 안내한다 —
 *   refresh 토큰까지 만료된 상황에서 루프를 도는 게 최악이라서.
 * - 갱신 큐는 axios 인터셉터와 공유한다(refreshAccessToken) → 401 재발급과 경합하지 않는다.
 */
export function useSellerRoleSync(isApproved: boolean): RoleSyncState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<RoleSyncState>('idle');
  const attempted = useRef(false);

  useEffect(() => {
    if (!isApproved) return;

    // 이미 토큰에 seller 가 박혀 있으면 갱신할 이유가 없다.
    if (tokenHasRole('seller')) {
      setState('synced');
      return;
    }

    if (attempted.current) return;
    attempted.current = true;

    let cancelled = false;
    setState('syncing');

    refreshAccessToken()
      .then((token) => {
        if (cancelled) return;
        if (token && tokenHasRole('seller')) {
          setState('synced');
          // AuthContext 가 새 역할을 다시 읽도록 (메뉴·가드 표시 갱신)
          queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
        } else {
          // 갱신은 됐는데도 seller 가 없다 = 승인 트랜잭션과 역할 부여가 어긋난 비정상 케이스.
          setState('failed');
        }
      })
      .catch(() => {
        if (!cancelled) setState('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [isApproved, queryClient]);

  return state;
}

/** 서버 에러 → 화면 문구. 백엔드가 준 message 를 최대한 살린다. */
export function sellerErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('\n');
    if (error.response?.status === 403) {
      return '셀러 신청은 일반(구매자) 계정만 가능합니다.';
    }
  }
  return '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
}
