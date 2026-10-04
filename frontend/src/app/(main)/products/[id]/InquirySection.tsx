'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Product } from '@/model/product';
import { useAuth } from '@/contexts/AuthContext';
import { inquiryQueryOptions } from '@/lib/react-query/inquiry-query-options';
import InquiryForm from '@/components/inquiry/InquiryForm';
import InquiryItem from '@/components/inquiry/InquiryItem';

interface InquirySectionProps {
  product: Product;
}

const PAGE_SIZE = 5;

/**
 * 상품 상세 "문의" 탭 — 작성 폼(위) + 목록(아래).
 * 리뷰 탭과 같이 탭을 열 때 클라이언트에서 조회한다(상세 페이지 TTFB 무영향, 캐시 분리).
 */
export default function InquirySection({ product }: InquirySectionProps) {
  const { user, isHydrated, isLoading: isAuthLoading } = useAuth();
  // 더보기: take 를 늘려가며 누적 노출 (페이지 기반, page=1 고정)
  const [take, setTake] = useState(PAGE_SIZE);

  // 로그인 상태면 토큰을 실어 보낸다 — 본인이 쓴 비밀글이 풀려서 온다.
  // 인증 확인이 끝난 뒤에 조회해, 로그인 사용자가 마스킹된 목록을 먼저 받았다가 다시 받는 일을 피한다.
  const authReady = isHydrated && !isAuthLoading;
  const inquiriesQuery = useQuery({
    ...inquiryQueryOptions.productInquiries(product.id, { page: 1, take }, !!user),
    enabled: authReady && !!product.id,
  });

  const inquiries = inquiriesQuery.data?.data ?? [];
  const total = inquiriesQuery.data?.meta.total ?? 0;
  const isInitialLoading = !authReady || (inquiriesQuery.isLoading && inquiries.length === 0);

  return (
    <div className="space-y-8">
      {/* 셀러가 없는 상품(시드 상품)은 서버가 문의를 받지 않는다(400 "셀러 정보가 없는 상품입니다.") — 폼을 내지 않는다 */}
      {product.sellerId == null ? (
        <p className="rounded-lg bg-secondary-50 px-4 py-3 text-sm text-secondary-700">
          판매자가 등록되지 않은 상품이라 문의를 받을 수 없습니다.
        </p>
      ) : (
        <InquiryForm productId={product.id} />
      )}

      <div className="border-t pt-8">
        <h3 className="text-lg font-bold text-secondary-900 mb-6">
          상품 문의 {total > 0 && `(${total})`}
        </h3>

        {isInitialLoading ? (
          <div className="text-center py-12 text-secondary-500">문의를 불러오는 중...</div>
        ) : inquiriesQuery.isError ? (
          <div role="alert" className="text-center py-12 text-secondary-600">
            문의를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
          </div>
        ) : inquiries.length === 0 ? (
          <div className="text-center py-12 text-secondary-600">
            <p>이 상품에 대한 문의가 아직 없습니다.</p>
          </div>
        ) : (
          <>
            <div>
              {inquiries.map((inquiry) => (
                <InquiryItem key={inquiry.id} inquiry={inquiry} />
              ))}
            </div>

            {inquiries.length < total && (
              <div className="text-center mt-6">
                <button
                  onClick={() => setTake((t) => t + PAGE_SIZE)}
                  disabled={inquiriesQuery.isFetching}
                  className="px-6 py-2.5 text-sm border border-secondary-300 rounded-lg text-secondary-700 font-semibold hover:bg-secondary-50 transition-colors disabled:opacity-50"
                >
                  {inquiriesQuery.isFetching
                    ? '불러오는 중...'
                    : `문의 더보기 (${inquiries.length}/${total})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
