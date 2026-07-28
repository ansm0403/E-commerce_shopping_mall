'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { filterBarStyle, tabStyle } from '../../components/table-ui';

/**
 * 승인 상태 탭 — 진실 원천은 URL.
 * approvalStatus 미지정 = 'pending'(들어오자마자 "처리할 것"이 보이게),
 * 전체 조회는 'all' 로 명시한다. 셀러 승인 화면과 같은 규칙.
 *
 * 검색창을 두지 않은 이유: 백엔드 findAllAdmin 은 categoryId·status·approvalStatus·sellerId 만
 * 필터로 쓴다. ProductQueryDto 에 keyword 가 있어도 admin 경로에서는 무시되므로
 * 동작하지 않는 입력은 만들지 않는다.
 */

export const DEFAULT_APPROVAL_STATUS = 'pending';

const TABS = [
  { value: 'pending', label: '승인 대기' },
  { value: 'approved', label: '승인' },
  { value: 'rejected', label: '반려' },
  { value: 'all', label: '전체' },
] as const;

export default function ProductFilters() {
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
