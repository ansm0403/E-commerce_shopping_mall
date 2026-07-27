'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { filterBarStyle, tabStyle } from '../../components/table-ui';

/**
 * 정산 상태 탭 — 진실 원천은 URL.
 * 미지정 = 'pending'(관리자가 "처리할 것" = 확정 대기), 전체는 'all' 명시.
 */

export const DEFAULT_SETTLEMENT_STATUS = 'pending';

const TABS = [
  { value: 'pending', label: '정산 대기' },
  { value: 'confirmed', label: '확정 (지급 대기)' },
  { value: 'paid', label: '지급 완료' },
  { value: 'all', label: '전체' },
] as const;

export default function SettlementFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const current = sp.get('status') ?? DEFAULT_SETTLEMENT_STATUS;

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
