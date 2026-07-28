'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { filterBarStyle, tabStyle } from '../../../../(admin)/admin/components/table-ui';

/**
 * 승인 상태 탭 — 진실 원천은 URL (Step 1·4에서 확립한 규칙).
 * 관리자 화면과 달리 기본값이 'all' 이다 — 셀러는 "처리할 것"이 아니라
 * "내 상품 전체"가 기본 관심사라서. 필터 변경 시 page 리셋도 같은 규칙.
 */

export const DEFAULT_APPROVAL_STATUS = 'all';

const TABS = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '승인 대기' },
  { value: 'approved', label: '승인됨' },
  { value: 'rejected', label: '반려됨' },
] as const;

export default function SellerProductFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const current = sp.get('approvalStatus') ?? DEFAULT_APPROVAL_STATUS;

  const select = (value: string) => {
    const params = new URLSearchParams(sp.toString());
    params.set('approvalStatus', value);
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
