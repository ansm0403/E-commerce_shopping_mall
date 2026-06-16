'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createReview, updateReview, deleteReview } from '@/service/review';
import { reviewKeys } from '@/lib/react-query/review-query-options';
import { authStorage } from '@/service/auth-storage';
import {
  CreateReviewRequest,
  UpdateReviewRequest,
} from '@/model/review';

function handleReviewError(error: any) {
  // 로그인 가드에서 던진 신호는 조용히 무시(이미 /login 으로 이동)
  if (error?.message === '로그인이 필요합니다.') return;

  const message =
    error?.response?.data?.message ?? '오류가 발생했습니다. 다시 시도해주세요.';
  alert(Array.isArray(message) ? message.join('\n') : message);
}

/** 요청 직전 로그인 여부 확인 — 미로그인 시 /login 이동 후 중단 */
function loginGuard(router: ReturnType<typeof useRouter>) {
  if (!authStorage.getAccessToken()) {
    router.push('/login');
    throw new Error('로그인이 필요합니다.');
  }
}

/**
 * 리뷰 작성 (BUYER + 구매확정 주문만 — 백엔드 강제)
 * 성공 시 상품 리뷰/요약/내 리뷰 캐시 무효화.
 */
export function useCreateReview() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (body: CreateReviewRequest) => createReview(body),
    onMutate: () => loginGuard(router),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewKeys.all });
    },
    onError: handleReviewError,
  });
}

/**
 * 리뷰 수정 (작성 30일 내만 — 백엔드 강제, 서버 400 도 onError 로 surface)
 */
export function useUpdateReview() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateReviewRequest }) =>
      updateReview(id, body),
    onMutate: () => loginGuard(router),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewKeys.all });
    },
    onError: handleReviewError,
  });
}

/**
 * 리뷰 삭제
 */
export function useDeleteReview() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (id: number) => deleteReview(id),
    onMutate: () => loginGuard(router),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewKeys.all });
    },
    onError: handleReviewError,
  });
}
