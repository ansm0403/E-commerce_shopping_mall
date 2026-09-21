/**
 * 평가 루프 쿼리 (설계 §5.5 queryKey `['reviews', 'pending']` · §4.3 S5 "낙관적 업데이트").
 *
 * 낙관적 업데이트(optimistic update) — 서버 응답을 기다리지 않고 화면을 먼저 바꾸는 것.
 * 스와이프한 카드는 그 자리에서 사라지고(다음 카드 즉시), 저장은 뒤에서 진행된다.
 * 실패하면 카드를 되돌리고 토스트를 띄운다. TanStack Query 에서는 useMutation 의 세 훅이 이 흐름이다:
 *
 *   onMutate  — 요청을 보내기 **전에** 캐시를 먼저 바꾼다. 되돌릴 재료(그 카드)를 반환해 두면 onError 가 받는다
 *   onError   — 실패: onMutate 가 남긴 재료로 되돌린다
 *   onSettled — 성공·실패 공통 뒷정리(여기서는 쓰지 않는다 — 아래 이유)
 *
 * 왜 스냅샷 전체를 되돌리지 않나: 카드 두 장을 연달아 스와이프하면 요청 두 개가 동시에 떠 있다. 첫 번째가 실패했을 때
 * "onMutate 시점의 목록 전체"로 되돌리면 두 번째(성공한) 카드까지 살아난다. 그래서 **실패한 카드 한 장만** 다시 끼운다.
 * 왜 성공 후 invalidate 하지 않나: 서버 상태와 캐시가 이미 같다(그 카드가 빠진 목록). 다시 당기면 왕복만 낭비다.
 */
import { AxiosError } from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPendingReviews, submitReview, type PendingReview, type ReviewInput, type ReviewResult } from '../../lib/api';

export const pendingReviewsKey = ['reviews', 'pending'] as const;

export function usePendingReviews() {
  return useQuery<PendingReview[]>({
    queryKey: pendingReviewsKey,
    queryFn: fetchPendingReviews,
    // 채점하는 동안은 캐시가 곧 진실이다(카드를 빼며 진행). 탭을 오갈 때마다 다시 당길 이유가 없다
    staleTime: 60_000,
    retry: 1,
  });
}

type SubmitVars = { analysisId: number } & ReviewInput;
type SubmitContext = { removed: PendingReview | null };

export function useSubmitReview() {
  const queryClient = useQueryClient();
  return useMutation<ReviewResult, AxiosError, SubmitVars, SubmitContext>({
    mutationFn: ({ analysisId, ...input }) => submitReview(analysisId, input),

    onMutate: async ({ analysisId }) => {
      // 진행 중인 목록 조회가 있으면 취소한다 — 늦게 도착한 옛 목록이 방금 뺀 카드를 되살리지 않게
      await queryClient.cancelQueries({ queryKey: pendingReviewsKey });
      const current = queryClient.getQueryData<PendingReview[]>(pendingReviewsKey) ?? [];
      const removed = current.find((p) => p.analysisId === analysisId) ?? null;
      queryClient.setQueryData<PendingReview[]>(pendingReviewsKey, current.filter((p) => p.analysisId !== analysisId));
      return { removed };
    },

    onError: (_error, _vars, context) => {
      const card = context?.removed;
      if (!card) return;
      // 실패한 카드만 맨 앞에 되돌린다(다른 카드의 진행은 건드리지 않는다)
      queryClient.setQueryData<PendingReview[]>(pendingReviewsKey, (old = []) =>
        old.some((p) => p.analysisId === card.analysisId) ? old : [card, ...old],
      );
    },
  });
}
