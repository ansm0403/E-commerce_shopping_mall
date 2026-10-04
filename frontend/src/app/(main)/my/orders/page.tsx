'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { orderQueryOptions } from '@/lib/react-query/order-query-options';
import { OrderResponse, OrderStatus, PaginatedOrders } from '@/model/order';

const STATUS_TABS: { label: string; value: OrderStatus | '' }[] = [
  { label: '전체', value: '' },
  { label: '결제 대기', value: 'pending_payment' },
  { label: '결제 완료', value: 'paid' },
  { label: '배송 준비', value: 'preparing' },
  { label: '배송 중', value: 'shipped' },
  { label: '배송 완료', value: 'delivered' },
  { label: '구매 확정', value: 'completed' },
  { label: '취소', value: 'cancelled' },
];

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: '결제 대기',
  paid: '결제 완료',
  preparing: '배송 준비',
  shipped: '배송 중',
  delivered: '배송 완료',
  completed: '구매 확정',
  cancelled: '취소',
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  pending_payment: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  paid: 'text-blue-600 bg-blue-50 border-blue-200',
  preparing: 'text-indigo-600 bg-indigo-50 border-indigo-200',
  shipped: 'text-purple-600 bg-purple-50 border-purple-200',
  delivered: 'text-green-600 bg-green-50 border-green-200',
  completed: 'text-secondary-600 bg-secondary-100 border-secondary-200',
  cancelled: 'text-red-500 bg-red-50 border-red-200',
};

export default function OrdersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isLoggedIn = !!user;

  const [activeStatus, setActiveStatus] = useState<OrderStatus | ''>('');
  const [page, setPage] = useState(1);

  // 비로그인이면 로그인으로(돌아올 경로 포함) — /auth/me 응답을 기다린 뒤에만 판정한다
  useRequireAuth();

  const handleTabChange = (status: OrderStatus | '') => {
    setActiveStatus(status);
    setPage(1);
  };

  const queryOpts = orderQueryOptions.myOrders({
    page,
    take: 10,
    ...(activeStatus ? { status: activeStatus } : {}),
  });
  const { data, isLoading } = useQuery({
    ...queryOpts,
    enabled: isLoggedIn,
  });

  const result = data?.data as PaginatedOrders | undefined;
  const orders = result?.data ?? [];
  const meta = result?.meta;

  return (
    <div className="py-8">
      <h1 className="text-2xl font-bold text-secondary-900 mb-6">주문 내역</h1>

      {/* 상태 필터 탭 */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-6 scrollbar-hide">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => handleTabChange(tab.value)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200 ${
              activeStatus === tab.value
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-secondary-100 text-secondary-500 hover:bg-secondary-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      {isLoading ? (
        <SkeletonList />
      ) : orders.length === 0 ? (
        <EmptyState onShop={() => router.push('/products')} />
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onClick={() => router.push(`/my/orders/${order.orderNumber}`)}
            />
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {meta && meta.lastPage > 1 && (
        <div className="flex justify-center items-center gap-2 mt-8">
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={!meta.hasPreviousPage}
            className="px-3 py-1.5 text-sm border border-secondary-300 rounded-lg disabled:opacity-40 hover:bg-secondary-50 transition-colors"
          >
            이전
          </button>
          <span className="text-sm text-secondary-500 font-medium">
            {meta.page} / {meta.lastPage}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!meta.hasNextPage}
            className="px-3 py-1.5 text-sm border border-secondary-300 rounded-lg disabled:opacity-40 hover:bg-secondary-50 transition-colors"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}

// ─── OrderCard ────────────────────────────────────────────────────────────────

function OrderCard({ order, onClick }: { order: OrderResponse; onClick: () => void }) {
  const firstItem = order.items[0];
  const extraCount = order.items.length - 1;

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl border border-secondary-200 p-4 hover:border-primary-300 hover:shadow-md transition-all duration-200 group"
    >
      {/* 상단: 날짜 + 상태 배지 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs text-secondary-400">
            {new Date(order.createdAt).toLocaleDateString('ko-KR', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <p className="text-[11px] text-secondary-400 mt-0.5 font-mono">{order.orderNumber}</p>
        </div>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLOR[order.status]}`}>
          {STATUS_LABEL[order.status]}
        </span>
      </div>

      {/* 하단: 상품 이미지 + 이름 + 금액 + 화살표 */}
      <div className="flex items-center gap-3">
        {/* 썸네일 */}
        {firstItem?.productImageUrl ? (
          <img
            src={firstItem.productImageUrl}
            alt={firstItem.productName}
            className="w-14 h-14 rounded-lg object-cover shrink-0 border border-secondary-100"
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-primary-50 flex items-center justify-center shrink-0 border border-primary-100">
            <span className="text-primary-400 font-bold text-lg">
              {firstItem?.productName?.charAt(0) ?? '?'}
            </span>
          </div>
        )}

        {/* 상품명 + 금액 */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-secondary-900 truncate">
            {firstItem?.productName}
            {extraCount > 0 && (
              <span className="ml-1 text-secondary-400 font-normal text-xs">
                외 {extraCount}건
              </span>
            )}
          </p>
          <p className="text-sm font-bold text-primary-600 mt-1">
            {Number(order.totalAmount).toLocaleString()}원
          </p>
        </div>

        {/* 화살표 */}
        <span className="text-secondary-300 group-hover:text-primary-400 transition-colors text-lg shrink-0">
          →
        </span>
      </div>
    </button>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-secondary-200 p-4 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="space-y-1.5">
          <div className="h-3 w-28 bg-secondary-100 rounded" />
          <div className="h-2.5 w-36 bg-secondary-100 rounded" />
        </div>
        <div className="h-5 w-16 bg-secondary-100 rounded-full" />
      </div>
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-lg bg-secondary-100 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-3/4 bg-secondary-100 rounded" />
          <div className="h-3.5 w-1/3 bg-secondary-100 rounded" />
        </div>
      </div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onShop }: { onShop: () => void }) {
  return (
    <div className="py-20 text-center">
      <p className="text-4xl mb-4">📦</p>
      <p className="text-base font-semibold text-secondary-700">주문 내역이 없습니다</p>
      <p className="text-sm text-secondary-400 mt-1 mb-6">첫 주문을 시작해보세요!</p>
      <button
        onClick={onShop}
        className="px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 transition-colors"
      >
        쇼핑하러 가기
      </button>
    </div>
  );
}
