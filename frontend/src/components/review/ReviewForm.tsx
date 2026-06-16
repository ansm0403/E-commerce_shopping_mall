'use client';

import { useState } from 'react';

interface ReviewFormValues {
  rating: number;
  comment: string;
}

interface ReviewFormProps {
  /** 수정 시 초기값 (생성 시 생략) */
  initialRating?: number;
  initialComment?: string;
  submitLabel?: string;
  isPending?: boolean;
  onSubmit: (values: ReviewFormValues) => void;
  onCancel?: () => void;
}

const MIN_COMMENT = 5;

/**
 * 별점 입력 + 본문 textarea. 생성/수정 공용.
 * v1은 텍스트+별점만(이미지 업로드는 후속) — ex-review-frontend §2 Q1.
 */
export default function ReviewForm({
  initialRating = 5,
  initialComment = '',
  submitLabel = '등록',
  isPending = false,
  onSubmit,
  onCancel,
}: ReviewFormProps) {
  const [rating, setRating] = useState(initialRating);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(initialComment);

  const trimmed = comment.trim();
  const canSubmit = rating >= 1 && rating <= 5 && trimmed.length >= MIN_COMMENT;

  const handleSubmit = () => {
    if (!canSubmit || isPending) return;
    onSubmit({ rating, comment: trimmed });
  };

  return (
    <div className="space-y-4">
      {/* 별점 입력 */}
      <div>
        <p className="text-sm font-semibold text-secondary-700 mb-2">별점</p>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(0)}
              className="text-2xl leading-none transition-transform hover:scale-110 focus:outline-none"
              aria-label={`${star}점`}
            >
              <span className={(hover || rating) >= star ? 'text-yellow-400' : 'text-secondary-300'}>
                ★
              </span>
            </button>
          ))}
          <span className="ml-2 text-sm text-secondary-500">{rating}점</span>
        </div>
      </div>

      {/* 본문 */}
      <div>
        <p className="text-sm font-semibold text-secondary-700 mb-2">리뷰 내용</p>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="상품에 대한 솔직한 후기를 남겨주세요. (최소 5자)"
          className="w-full px-3 py-2 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
        />
        <p className="text-xs text-secondary-400 mt-1 text-right">{trimmed.length}/1000</p>
      </div>

      {/* 액션 */}
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-secondary-300 rounded-lg text-secondary-600 hover:bg-secondary-50 transition-colors"
          >
            취소
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || isPending}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? '처리 중...' : submitLabel}
        </button>
      </div>
    </div>
  );
}
