/**
 * 상품 평점 분포 집계 응답 DTO.
 * GET /v1/reviews/product/:id/summary 전용.
 * - average: 평균 평점(소수 1자리). 리뷰 0개면 0.
 * - count: 총 리뷰 수.
 * - distribution: 별점(5~1)별 개수. 항상 5개 키를 채워 프론트 막대 렌더를 단순화.
 */
export class ReviewSummaryResponseDto {
  average: number;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}
