'use client';

import { useState } from 'react';
import { SellerStatus } from '@shopping-mall/shared';
import { useMySellerQuery } from '../../../../hooks/seller-query-options';
import SellerApplyForm from './components/SellerApplyForm';
import SellerStatusCard from './components/SellerStatusCard';

/**
 * 셀러 신청 / 승인 상태 확인 (01-seller-core §1-A①).
 *
 * 4분기:
 *   미신청(GET /seller/me 404 → null) → 신청 폼
 *   pending / approved                → 상태 카드
 *   rejected                          → 상태 카드(사유) → "다시 신청하기" 시 폼
 *
 * 로그인 여부는 별도로 검사하지 않는다 — 토큰이 없으면 authClient 인터셉터가
 * refresh 를 시도하고 실패 시 /login 으로 보낸다(기존 동작에 위임).
 */
export default function SellerApplyPage() {
  const { data: application, isLoading, isError, refetch } = useMySellerQuery();
  const [isReapplying, setIsReapplying] = useState(false);

  if (isLoading) {
    return <CenteredMessage>신청 현황을 불러오는 중…</CenteredMessage>;
  }

  if (isError) {
    return (
      <CenteredMessage>
        <span className="text-red-600">신청 현황을 불러오지 못했습니다.</span>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
        >
          다시 시도
        </button>
      </CenteredMessage>
    );
  }

  // 미신청 → 신규 신청 폼
  if (!application) {
    return (
      <div className="px-4">
        <SellerApplyForm />
      </div>
    );
  }

  // 반려 후 "다시 신청하기" → 이전 내용을 채운 폼 (은행 정보는 응답에 없어 새로 입력)
  if (isReapplying && application.status === SellerStatus.REJECTED) {
    return (
      <div className="px-4">
        <SellerApplyForm
          previous={application}
          onApplied={() => setIsReapplying(false)}
          onCancel={() => setIsReapplying(false)}
        />
      </div>
    );
  }

  return (
    <div className="px-4">
      <SellerStatusCard application={application} onReapply={() => setIsReapplying(true)} />
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-20 flex max-w-[560px] flex-col items-center text-sm text-gray-500">
      {children}
    </div>
  );
}
