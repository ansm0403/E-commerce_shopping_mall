'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { filterBarStyle, tabStyle } from '../../../../(admin)/admin/components/table-ui';

/**
 * 주문 상태 탭 — 진실 원천은 URL.
 * 미지정 = 'preparing'(셀러가 "처리할 것" = 출고 대기 주문), 전체는 'all' 명시.
 */

export const DEFAULT_ORDER_STATUS = 'preparing';

const TABS = [
  { value: 'preparing', label: '출고 대기' },
  { value: 'shipped', label: '배송 중' },
  { value: 'delivered', label: '배송 완료' },
  { value: 'completed', label: '구매 확정' },
  { value: 'all', label: '전체' },
] as const;

export default function SellerOrderFilters() {
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
    <div style={filterBarStyle}>
      {TABS.map(({ value, label }) => (
        <button key={value} style={tabStyle(current === value)} onClick={() => select(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}
