import { queryOptions, keepPreviousData } from '@tanstack/react-query';
import {
  getProductReviews,
  getProductReviewSummary,
  getProductReviewAiSummary,
  getMyReviews,
} from '../../service/review';
import { ReviewQueryParams } from '../../model/review';

export const reviewKeys = {
  all: ['reviews'] as const,
  products: () => [...reviewKeys.all, 'product'] as const,
  product: (productId: number, params: ReviewQueryParams = {}) =>
    [...reviewKeys.products(), productId, params] as const,
  summaries: () => [...reviewKeys.all, 'summary'] as const,
  summary: (productId: number) => [...reviewKeys.summaries(), productId] as const,
  aiSummaries: () => [...reviewKeys.all, 'ai-summary'] as const,
  aiSummary: (productId: number) =>
    [...reviewKeys.aiSummaries(), productId] as const,
  mine: () => [...reviewKeys.all, 'my'] as const,
  my: (params: ReviewQueryParams = {}) => [...reviewKeys.mine(), params] as const,
};

export const reviewQueryOptions = {
  productReviews: (productId: number, params: ReviewQueryParams = {}) =>
    queryOptions({
      queryKey: reviewKeys.product(productId, params),
      queryFn: () => getProductReviews(productId, params),
      staleTime: 1000 * 30, // 30초 — 리뷰는 작성 후 즉시 반영돼야 함
      enabled: !!productId,
      // "더보기"는 take 를 키에 포함해 늘리므로 새 키 = 캐시 없음.
      // 이전 데이터를 유지해 목록이 깜빡이며 사라지는 것을 방지.
      placeholderData: keepPreviousData,
    }),

  productSummary: (productId: number) =>
    queryOptions({
      queryKey: reviewKeys.summary(productId),
      queryFn: () => getProductReviewSummary(productId),
      staleTime: 1000 * 30,
      enabled: !!productId,
    }),

  // AI 리뷰 요약(Phase 5c). SWR — 서버가 낡으면 백그라운드 재생성하므로
  // staleTime 을 짧게 둬 재방문 시 갱신된 요약을 빨리 받는다.
  productAiSummary: (productId: number) =>
    queryOptions({
      queryKey: reviewKeys.aiSummary(productId),
      queryFn: () => getProductReviewAiSummary(productId),
      staleTime: 1000 * 30,
      enabled: !!productId,
    }),

  myReviews: (params: ReviewQueryParams = {}) =>
    queryOptions({
      queryKey: reviewKeys.my(params),
      queryFn: () => getMyReviews(params),
      staleTime: 1000 * 30,
      // my/reviews "더보기"도 take 증가로 키가 바뀌므로 이전 목록 유지
      placeholderData: keepPreviousData,
    }),
};
