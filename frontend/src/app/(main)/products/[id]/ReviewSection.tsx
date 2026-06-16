'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Product } from '@/model/product';
import {
  Review,
  ReviewSummary,
  PaginatedReviews,
  ProductReviewAiSummary,
} from '@/model/review';
import { reviewQueryOptions } from '@/lib/react-query/review-query-options';
import ReviewItem from '@/components/review/ReviewItem';

interface ReviewSectionProps {
  product: Product;
}

// Phase 5c(구매자 상품 리뷰 자동 요약, ex-ai-assistant.md) — 구현 완료, 활성.
const AI_REVIEW_SUMMARY_ENABLED = true;

const PAGE_SIZE = 5;

const RATING_STARS = [5, 4, 3, 2, 1] as const;

function renderStars(rating: number) {
  const r = Math.min(Math.max(Math.round(rating), 0), 5);
  return (
    <span className="text-yellow-400">
      {'★'.repeat(r)}
      <span className="text-secondary-300">{'★'.repeat(5 - r)}</span>
    </span>
  );
}

export default function ReviewSection({ product }: ReviewSectionProps) {
  // 더보기: take 를 늘려가며 누적 노출 (페이지 기반, page=1 고정)
  const [take, setTake] = useState(PAGE_SIZE);

  // 상품 상세는 ISR/RSC 프리패치지만 리뷰는 탭에서 클라이언트 조회(캐시 분리)
  const summaryQuery = useQuery(reviewQueryOptions.productSummary(product.id));
  const reviewsQuery = useQuery(
    reviewQueryOptions.productReviews(product.id, { page: 1, take }),
  );
  // AI 요약은 별도 지연 로드(SWR — 서버가 낡으면 백그라운드 재생성)
  const aiSummaryOptions = reviewQueryOptions.productAiSummary(product.id);
  const aiQuery = useQuery({
    ...aiSummaryOptions,
    enabled: AI_REVIEW_SUMMARY_ENABLED && !!product.id,
  });
  const ai = aiQuery.data?.data as ProductReviewAiSummary | undefined;

  const summary = summaryQuery.data?.data as ReviewSummary | undefined;
  const paginated = reviewsQuery.data?.data as PaginatedReviews | undefined;
  const reviews: Review[] = paginated?.data ?? [];

  // 평균/개수는 집계 응답 우선, 없으면 상품 필드로 폴백
  const average = summary?.average ?? Number(product.rating ?? 0);
  const count = summary?.count ?? product.reviewCount ?? 0;
  const distribution = summary?.distribution;
  const total = paginated?.meta.total ?? count;

  return (
    <div className="space-y-8">
      {/* Phase 5c: AI 리뷰 요약 블록 (available=false 면 미표시) */}
      {AI_REVIEW_SUMMARY_ENABLED && ai?.available && (
        <div className="bg-primary-50 border border-primary-100 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-bold text-primary-700">
              AI 리뷰 요약
            </h3>
            {ai.status !== 'fresh' && (
              <span className="inline-flex items-center gap-1 text-xs text-primary-500 bg-primary-100 rounded-full px-2 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
                요약 갱신 중
              </span>
            )}
          </div>
          {ai.summary ? (
            <p className="text-sm text-secondary-700 whitespace-pre-line leading-relaxed">
              {ai.summary}
            </p>
          ) : (
            <p className="text-sm text-secondary-400">
              리뷰 요약을 준비하고 있어요. 잠시 후 다시 확인해주세요.
            </p>
          )}
        </div>
      )}

      {/* 평점 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 평점 대시보드 */}
        <div className="md:col-span-1 bg-secondary-50 rounded-lg p-6 text-center">
          <p className="text-4xl font-bold text-secondary-900 mb-2">
            {average.toFixed(1)}
          </p>
          <div className="flex justify-center mb-2">{renderStars(average)}</div>
          <p className="text-sm text-secondary-600">{count}개의 리뷰</p>
        </div>

        {/* 평점 분포 (실데이터) */}
        <div className="md:col-span-2 space-y-2">
          {summaryQuery.isLoading ? (
            <div className="py-8 text-center text-sm text-secondary-400">
              평점 분포를 불러오는 중...
            </div>
          ) : (
            RATING_STARS.map((star) => {
              const starCount = distribution?.[star] ?? 0;
              const percentage = count > 0 ? (starCount / count) * 100 : 0;

              return (
                <div key={star} className="flex items-center gap-3">
                  <span className="text-yellow-400 text-sm min-w-[30px]">
                    {'★'.repeat(star)}
                  </span>
                  <div className="flex-1 bg-secondary-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary-600 h-full transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="text-sm text-secondary-600 min-w-[40px] text-right">
                    {starCount}개
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 리뷰 목록 */}
      <div className="border-t pt-8">
        <h3 className="text-lg font-bold text-secondary-900 mb-6">
          고객 리뷰 {total > 0 && `(${total})`}
        </h3>

        {reviewsQuery.isLoading && reviews.length === 0 ? (
          <div className="text-center py-12 text-secondary-400">
            리뷰를 불러오는 중...
          </div>
        ) : reviews.length === 0 ? (
          <div className="text-center py-12 text-secondary-500">
            <p>이 상품의 리뷰가 아직 없습니다.</p>
            <p className="text-sm mt-2">구매 후 첫 리뷰를 작성해주세요!</p>
          </div>
        ) : (
          <>
            <div>
              {reviews.map((review) => (
                <ReviewItem key={review.id} review={review} />
              ))}
            </div>

            {/* 더보기 */}
            {reviews.length < total && (
              <div className="text-center mt-6">
                <button
                  onClick={() => setTake((t) => t + PAGE_SIZE)}
                  disabled={reviewsQuery.isFetching}
                  className="px-6 py-2.5 text-sm border border-secondary-300 rounded-lg text-secondary-700 font-semibold hover:bg-secondary-50 transition-colors disabled:opacity-50"
                >
                  {reviewsQuery.isFetching
                    ? '불러오는 중...'
                    : `리뷰 더보기 (${reviews.length}/${total})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
