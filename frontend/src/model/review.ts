// 리뷰 도메인 타입 — 백엔드 ReviewResponseDto / ReviewSummaryResponseDto 미러.

export interface ReviewAuthor {
  id: number;
  nickName: string;
}

export interface Review {
  id: number;
  createdAt: string;
  updatedAt: string;
  userId: number;
  productId: number;
  orderId: number;
  rating: number;
  comment: string;
  imageUrls: string[];
  user: ReviewAuthor;
}

export interface PaginatedReviews {
  data: Review[];
  meta: {
    total: number;
    page: number;
    lastPage: number;
    take: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/** GET /reviews/product/:id/summary — 평점 분포 집계 */
export interface ReviewSummary {
  average: number;
  count: number;
  distribution: Record<5 | 4 | 3 | 2 | 1, number>;
}

/**
 * GET /products/:id/review-summary — AI 리뷰 자동 요약(Phase 5c, SWR).
 * 평점 분포(ReviewSummary)와는 별개. available=false 면 미표시,
 * status 가 stale/generating 이면 "갱신 중" 뱃지.
 */
export interface ProductReviewAiSummary {
  available: boolean;
  status?: 'fresh' | 'stale' | 'generating';
  summary?: string | null;
  reviewCount?: number;
  generatedAt?: string | null;
}

export interface ReviewQueryParams {
  page?: number;
  take?: number;
}

export interface CreateReviewRequest {
  orderId: number;
  productId: number;
  rating: number;
  comment: string;
  imageUrls?: string[];
}

export interface UpdateReviewRequest {
  rating?: number;
  comment?: string;
  imageUrls?: string[];
}
