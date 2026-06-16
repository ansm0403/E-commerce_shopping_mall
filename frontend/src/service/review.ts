import { publicClient, authClient } from '../lib/axios/axios-http-client';
import {
  CreateReviewRequest,
  UpdateReviewRequest,
  ReviewQueryParams,
} from '../model/review';

// ─── 공개 (publicClient) ──────────────────────────────────────────────────────

/** 상품별 리뷰 목록 (페이지네이션) */
export function getProductReviews(
  productId: number,
  params: ReviewQueryParams = {},
) {
  return publicClient.get(`/reviews/product/${productId}`, { params });
}

/** 상품 평점 분포 집계 */
export function getProductReviewSummary(productId: number) {
  return publicClient.get(`/reviews/product/${productId}/summary`);
}

/** 상품 AI 리뷰 요약 (Phase 5c, SWR — 상품 상세와 분리 지연 로드) */
export function getProductReviewAiSummary(productId: number) {
  return publicClient.get(`/products/${productId}/review-summary`);
}

// ─── 인증 필요 (authClient, BUYER) ────────────────────────────────────────────

/** 내가 쓴 리뷰 목록 */
export function getMyReviews(params: ReviewQueryParams = {}) {
  return authClient.get('/reviews/my', { params });
}

/** 리뷰 작성 — 구매확정(COMPLETED) 주문 + 주문에 포함된 상품 + 1회만 */
export function createReview(body: CreateReviewRequest) {
  return authClient.post('/reviews', body);
}

/** 리뷰 수정 — 작성 30일 내만 (백엔드 강제) */
export function updateReview(id: number, body: UpdateReviewRequest) {
  return authClient.patch(`/reviews/${id}`, body);
}

/** 리뷰 삭제 */
export function deleteReview(id: number) {
  return authClient.delete(`/reviews/${id}`);
}
