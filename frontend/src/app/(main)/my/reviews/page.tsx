'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { reviewQueryOptions } from '@/lib/react-query/review-query-options';
import { useUpdateReview, useDeleteReview } from '@/hooks/useReview';
import { Modal } from '@/components/common/Modal';
import ReviewForm from '@/components/review/ReviewForm';
import ReviewItem from '@/components/review/ReviewItem';
import { Review, PaginatedReviews } from '@/model/review';

const PAGE_SIZE = 10;
const REVIEW_EDIT_WINDOW_DAYS = 30;

export default function MyReviewsPage() {
  const router = useRouter();
  const { user, isHydrated } = useAuth();
  const isLoggedIn = !!user;

  // 페이지 기반 네비게이션: 리뷰가 많은 사용자(100건 초과)도 안전하게 조회.
  // (take 를 늘리는 "더보기"는 백엔드 take 상한 100 에 걸린다)
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (isHydrated && !isLoggedIn) router.push('/login');
  }, [isHydrated, isLoggedIn, router]);

  const { data, isLoading, isFetching } = useQuery({
    ...reviewQueryOptions.myReviews({ page, take: PAGE_SIZE }),
    enabled: isLoggedIn,
  });

  const paginated = data?.data as PaginatedReviews | undefined;
  const reviews: Review[] = paginated?.data ?? [];
  const total = paginated?.meta.total ?? 0;
  const lastPage = paginated?.meta.lastPage ?? 1;

  // 삭제로 현재 페이지가 마지막 페이지를 넘어가면 클램프
  useEffect(() => {
    if (paginated && page > lastPage && lastPage >= 1) setPage(lastPage);
  }, [paginated, page, lastPage]);

  return (
    <div className="py-8 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-secondary-900 mb-6">
        내 리뷰 관리 {total > 0 && <span className="text-secondary-400">({total})</span>}
      </h1>

      {isLoading && reviews.length === 0 ? (
        <div className="py-20 text-center text-secondary-400">불러오는 중...</div>
      ) : reviews.length === 0 ? (
        <div className="py-20 text-center text-secondary-500">
          <p>아직 작성한 리뷰가 없습니다.</p>
          <p className="text-sm mt-2">구매확정한 상품에 리뷰를 남겨보세요!</p>
          <Link
            href="/my/orders"
            className="inline-block mt-4 text-primary-600 underline text-sm"
          >
            주문 내역으로
          </Link>
        </div>
      ) : (
        <section className="bg-white rounded-xl border border-secondary-200 p-5">
          {reviews.map((review) => (
            <ReviewItem
              key={review.id}
              review={review}
              action={<MyReviewActions review={review} />}
            />
          ))}

          {/* 페이지 네비게이션 */}
          {lastPage > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isFetching}
                className="px-4 py-2 text-sm border border-secondary-300 rounded-lg text-secondary-700 hover:bg-secondary-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                이전
              </button>
              <span className="text-sm text-secondary-500">
                {page} / {lastPage}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                disabled={page >= lastPage || isFetching}
                className="px-4 py-2 text-sm border border-secondary-300 rounded-lg text-secondary-700 hover:bg-secondary-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                다음
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─── 개별 리뷰 수정/삭제 액션 ────────────────────────────────────────────────

function MyReviewActions({ review }: { review: Review }) {
  const [editOpen, setEditOpen] = useState(false);
  const updateReview = useUpdateReview();
  const deleteReview = useDeleteReview();

  // 30일 수정 제한(백엔드 강제) — 프론트도 버튼 비활성+안내
  const daysSince =
    (Date.now() - new Date(review.createdAt).getTime()) / 86_400_000;
  const editLocked = daysSince > REVIEW_EDIT_WINDOW_DAYS;

  const handleEdit = async (values: { rating: number; comment: string }) => {
    try {
      await updateReview.mutateAsync({
        id: review.id,
        body: { rating: values.rating, comment: values.comment },
      });
      setEditOpen(false);
    } catch {
      // onError(useReview)에서 alert 처리됨
    }
  };

  const handleDelete = async () => {
    if (!confirm('이 리뷰를 삭제하시겠습니까?')) return;
    try {
      await deleteReview.mutateAsync(review.id);
    } catch {
      // onError(useReview)에서 alert 처리됨
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/products/${review.productId}`}
        className="text-xs text-secondary-400 hover:text-secondary-600 underline"
      >
        상품
      </Link>
      {editLocked ? (
        <span
          className="text-xs text-secondary-300"
          title="리뷰 작성 후 30일이 지나 수정할 수 없습니다."
        >
          수정 만료
        </span>
      ) : (
        <button
          onClick={() => setEditOpen(true)}
          className="text-xs text-secondary-600 hover:text-primary-600"
        >
          수정
        </button>
      )}
      <button
        onClick={handleDelete}
        disabled={deleteReview.isPending}
        className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
      >
        삭제
      </button>

      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title="리뷰 수정"
        size="md"
      >
        <ReviewForm
          initialRating={review.rating}
          initialComment={review.comment}
          submitLabel="수정"
          isPending={updateReview.isPending}
          onSubmit={handleEdit}
          onCancel={() => setEditOpen(false)}
        />
      </Modal>
    </div>
  );
}
