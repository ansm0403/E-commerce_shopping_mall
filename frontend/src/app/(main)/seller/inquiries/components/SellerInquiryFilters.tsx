'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { filterBarStyle, tabStyle } from '../../../../(admin)/admin/components/table-ui';

/**
 * 문의 상태 탭 — 진실 원천은 URL.
 * 미지정 = 'waiting'(셀러가 "처리할 것" = 미답변), 전체는 'all' 명시.
 */

export const DEFAULT_INQUIRY_STATUS = 'waiting';

const TABS = [
  { value: 'waiting', label: '미답변' },
  { value: 'answered', label: '답변 완료' },
  { value: 'all', label: '전체' },
] as const;

export type InquiryTab = (typeof TABS)[number]['value'];

export function parseInquiryTab(value: string | null): InquiryTab {
  return TABS.some((t) => t.value === value) ? (value as InquiryTab) : DEFAULT_INQUIRY_STATUS;
}

export default function SellerInquiryFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const current = parseInquiryTab(sp.get('status'));

  const select = (value: string) => {
    const params = new URLSearchParams(sp.toString());
    params.set('status', value);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div style={filterBarStyle}>
      {TABS.map(({ value, label }) => (
        <button
          key={value}
          style={tabStyle(current === value)}
          aria-pressed={current === value}
          onClick={() => select(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
