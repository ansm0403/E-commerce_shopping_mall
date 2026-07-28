'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { filterBarStyle, tabStyle } from '../../components/table-ui';

/**
 * 상태 탭 — 진실 원천은 URL(useSearchParams).
 * status 파라미터가 없으면 'pending' 으로 본다 — 관리자가 들어오자마자 "처리할 것"을 보게.
 * 전체 조회는 status=all 로 명시한다(URL만 봐도 무엇을 보고 있는지 알 수 있게).
 * 탭을 바꾸면 page 는 1로 리셋한다(감사 로그 필터와 동일한 규칙).
 */

export const DEFAULT_SELLER_STATUS = 'pending';

const TABS = [
  { value: 'pending', label: '대기' },
  { value: 'approved', label: '승인' },
  { value: 'rejected', label: '반려' },
  { value: 'all', label: '전체' },
] as const;

export default function SellerFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const current = sp.get('status') ?? DEFAULT_SELLER_STATUS;

  const select = (status: string) => {
    const params = new URLSearchParams(sp.toString());
    params.set('status', status);
    params.delete('page'); // 탭 변경 → 1페이지부터
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
