import { ProductSummaryStatus } from '../entity/product-summary.entity';

/**
 * GET /products/:id/review-summary 응답. (Phase 5c — 구매자 AI 리뷰 요약, SWR)
 *
 * - available=false: 리뷰가 MIN_REVIEWS 미만이라 요약을 노출하지 않음(프론트 미표시).
 * - available=true: status 로 신선도를 알리고, summary(낡았으면 직전 요약, 콜드면 null)를 즉시 반환.
 *   stale/generating 이면 프론트가 "요약 갱신 중" 뱃지를 띄운다.
 */
export interface ProductReviewAiSummaryDto {
  available: boolean;
  status?: ProductSummaryStatus;
  summary?: string | null;
  reviewCount?: number;
  generatedAt?: Date | null;
}
