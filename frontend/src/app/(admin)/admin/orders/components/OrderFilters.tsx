'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { filterBarStyle, tabStyle } from '../../components/table-ui';

/**
 * 주문 상태 탭 — 진실 원천은 URL.
 * 미지정 = 'shipped'(관리자가 "처리할 것" = 배송완료 처리 대상), 전체는 'all' 명시.
 * 셀러/상품 승인 화면과 같은 규칙.
 */

export const DEFAULT_ORDER_STATUS = 'shipped';

const TABS = [
  { value: 'shipped', label: '배송 중 (처리 대상)' },
  { value: 'preparing', label: '준비 중' },
  { value: 'pending_payment', label: '결제 대기' },
  { value: 'delivered', label: '배송 완료' },
  { value: 'completed', label: '구매 확정' },
  { value: 'cancelled', label: '취소' },
  { value: 'all', label: '전체' },
] as const;

export default function OrderFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const current = sp.get('status') ?? DEFAULT_ORDER_STATUS;

  const select = (value: string) => {
    const params = new URLSearchParams(sp.toString());
    params.set('status', value);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div style={{ ...filterBarStyle, flexWrap: 'wrap' }}>
      {TABS.map(({ value, label }) => (
        <button key={value} style={tabStyle(current === value)} onClick={() => select(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}
