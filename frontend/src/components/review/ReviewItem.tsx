'use client';

import { Review } from '@/model/review';

interface ReviewItemProps {
  review: Review;
  /** 우측 상단 액션(수정/삭제 등) — my/reviews 등에서 주입 */
  action?: React.ReactNode;
}

function Stars({ rating }: { rating: number }) {
  const r = Math.min(Math.max(Math.round(rating), 0), 5);
  return (
    <span className="text-yellow-400 text-sm" aria-label={`${r}점`}>
      {'★'.repeat(r)}
      <span className="text-secondary-300">{'★'.repeat(5 - r)}</span>
    </span>
  );
}

/** 개별 리뷰 카드 — 별점·닉네임·날짜·본문 */
export default function ReviewItem({ review, action }: ReviewItemProps) {
  return (
    <div className="py-4 border-b border-secondary-100 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Stars rating={review.rating} />
            <span className="text-sm font-semibold text-secondary-800">
              {review.user?.nickName ?? '익명'}
            </span>
          </div>
          <p className="text-xs text-secondary-400">
            {new Date(review.createdAt).toLocaleDateString('ko-KR', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <p className="mt-3 text-sm text-secondary-700 leading-relaxed whitespace-pre-wrap break-words">
        {review.comment}
      </p>
    </div>
  );
}
