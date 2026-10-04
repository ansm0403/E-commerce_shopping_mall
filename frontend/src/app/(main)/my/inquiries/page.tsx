'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { InquiryStatus, type InquiryResponse } from '@shopping-mall/shared';
import { inquiryQueryOptions } from '@/lib/react-query/inquiry-query-options';
import { useDeleteInquiry } from '@/hooks/useInquiry';
import { inquiryErrorMessage } from '@/service/inquiry';
import { Modal } from '@/components/common/Modal';
import InquiryItem from '@/components/inquiry/InquiryItem';

const PAGE_SIZE = 10;

/**
 * 내 문의 — GET /inquiries/my (상품명 포함). 로그인 가드는 my/layout.tsx.
 * 삭제는 답변 대기(waiting)일 때만 — 답변된 문의는 서버가 400 으로 막으므로 버튼을 아예 내지 않는다.
 */
export default function MyInquiriesPage() {
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<InquiryResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deleteMutation = useDeleteInquiry();

  const { data, isLoading, isError, isFetching } = useQuery(
    inquiryQueryOptions.myInquiries({ page, take: PAGE_SIZE }),
  );

  const inquiries = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const lastPage = data?.meta.lastPage ?? 1;

  // 삭제로 현재 페이지가 마지막 페이지를 넘어가면 클램프
  useEffect(() => {
    if (data && page > lastPage && lastPage >= 1) setPage(lastPage);
  }, [data, page, lastPage]);

  const closeModal = () => {
    setTarget(null);
    setErrorMessage(null);
  };

  const confirmDelete = async () => {
    if (!target) return;
    setErrorMessage(null);
    try {
      await deleteMutation.mutateAsync(target.id);
      closeModal();
      setNotice('문의가 삭제되었습니다.');
    } catch (error) {
      setErrorMessage(inquiryErrorMessage(error));
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-secondary-900 mb-2">
        내 문의 {total > 0 && <span className="text-secondary-600">({total})</span>}
      </h1>
      <p role="status" className="mb-4 min-h-5 text-sm text-green-700">
        {notice}
      </p>

      {isLoading && inquiries.length === 0 ? (
        <div className="py-20 text-center text-secondary-600">불러오는 중...</div>
      ) : isError ? (
        <div role="alert" className="py-20 text-center text-secondary-600">
          문의를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
        </div>
      ) : inquiries.length === 0 ? (
        <div className="py-20 text-center text-secondary-600">
          <p>아직 남긴 문의가 없습니다.</p>
          <p className="text-sm mt-2">상품 상세의 &quot;문의&quot; 탭에서 판매자에게 물어볼 수 있습니다.</p>
          <Link href="/products" className="inline-block mt-4 text-primary-700 underline text-sm">
            상품 보러 가기
          </Link>
        </div>
      ) : (
        <section className="bg-white rounded-xl border border-secondary-200 p-5">
          {inquiries.map((inquiry) => (
            <InquiryItem
              key={inquiry.id}
              inquiry={inquiry}
              header={
                <Link href={`/products/${inquiry.productId}`} className="underline hover:text-primary-700">
                  {inquiry.product?.name ?? `상품 #${inquiry.productId}`}
                </Link>
              }
              action={
                inquiry.status === InquiryStatus.WAITING ? (
                  <button
                    onClick={() => {
                      setNotice(null);
                      setTarget(inquiry);
                    }}
                    className="text-xs text-red-700 hover:underline"
                  >
                    삭제
                  </button>
                ) : null
              }
            />
          ))}

          {lastPage > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isFetching}
                className="px-4 py-2 text-sm border border-secondary-300 rounded-lg text-secondary-700 hover:bg-secondary-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                이전
              </button>
              <span className="text-sm text-secondary-600">
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

      <Modal isOpen={!!target} onClose={closeModal} title="문의 삭제" size="sm">
        <p className="text-sm text-secondary-700">
          &quot;{target?.title}&quot; 문의를 삭제할까요? 삭제하면 되돌릴 수 없습니다.
        </p>
        {errorMessage && (
          <p role="alert" className="mt-3 text-sm text-red-600 whitespace-pre-line">
            {errorMessage}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={closeModal}
            disabled={deleteMutation.isPending}
            className="px-4 py-2 text-sm border border-secondary-300 rounded-lg text-secondary-700 hover:bg-secondary-50"
          >
            취소
          </button>
          <button
            onClick={confirmDelete}
            disabled={deleteMutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
          >
            {deleteMutation.isPending ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
