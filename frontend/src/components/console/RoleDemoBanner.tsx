'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { getDemoStatus, logout as logoutApi } from '../../service/auth';
import { hasRole } from '../../lib/roles';

export default function RoleDemoBanner() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const admin = hasRole(user, 'admin');
  const seller = hasRole(user, 'seller');
  const status = useQuery({
    queryKey: ['auth', 'demo-status', user?.id],
    queryFn: async ({ signal }) => (await getDemoStatus(signal)).data,
    enabled: !!user?.isDemo && !admin,
    refetchInterval: 20000,
    retry: false,
  });
  if (!user?.isDemo && !error) return null;
  async function exit() {
    setBusy(true);
    setError('');
    try {
      if (user) await logout('/login#demo-choice');
      else await logoutApi();
      router.push('/login#demo-choice');
    } catch {
      setError('서버 로그아웃을 완료하지 못했습니다. 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside
      aria-label="체험 계정 안내"
      className="bg-amber-50 border-b border-amber-200 px-5 py-3 text-sm text-amber-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          <strong>{admin ? '관리자' : seller ? '셀러' : '구매자'} 체험</strong>{' '}
          · 공용 계정입니다. 개인정보를 입력하지 마세요.
          <br />
          {admin
            ? '승인·운영 변경 등 일부 기능이 제한됩니다.'
            : seller
            ? '상품 편집은 제한됩니다. 준비된 주문 처리와 체험 구매자의 문의 답변을 이용하세요.'
            : '장바구니와 테스트 결제 주문은 이번 로그인에서만 보입니다. 배송·리뷰용 주문과 비밀 문의는 다른 방문자와 공유합니다.'}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            className="underline disabled:opacity-50"
            onClick={exit}
          >
            다른 역할 체험
          </button>
          <button
            type="button"
            disabled={busy}
            className="underline disabled:opacity-50"
            onClick={exit}
          >
            {busy ? '종료 중...' : error ? '종료 다시 시도' : '체험 종료'}
          </button>
        </div>
      </div>
      {status.data && (
        <p className="text-xs mt-2">
          준비 주문 {status.data.preparingOrders}건 · 출고 주문{' '}
          {status.data.shippedOrders}건 · 배송 완료{' '}
          {status.data.deliveredOrders}건 · 작성 가능한 리뷰{' '}
          {status.data.reviewableItems}개 · 미답변 문의{' '}
          {status.data.waitingInquiries}건
          {!status.data.testDeliveryEnabled &&
            ' · 구매자 빠른 배송 완료 기능은 비활성화되어 있습니다.'}
          {status.data.preparingOrders +
            status.data.shippedOrders +
            status.data.deliveredOrders +
            status.data.reviewableItems ===
            0 &&
            ' · 주문 체험이 소진됐습니다. 완료된 샘플을 확인할 수 있습니다.'}
        </p>
      )}
      <p className="text-xs mt-2">
        준비된 주문의 결제·정산 금액은 합성 데이터입니다. 리뷰·문의 활동은
        평점과 운영 통계에 포함되며, 새 테스트 결제는 재고·판매량·정산에 포함되지 않습니다.
      </p>
      {error && (
        <p role="alert" className="text-red-700 mt-2">
          {error}
        </p>
      )}
    </aside>
  );
}
