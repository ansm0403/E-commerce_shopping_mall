'use client';

import ConsoleSidebar from '../../../../components/console/ConsoleSidebar';
import type { ConsoleLink } from '../../../../components/console/nav';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasRole } from '../../../../lib/roles';

const NAV_ITEMS = [
  { href: '/admin/dashboard',   label: '대시보드' },
  { href: '/admin/assistant',   label: 'AI 어시스턴트' },
  { href: '/admin/orders',      label: '주문 관리' },
  { href: '/admin/products',    label: '상품 관리' },
  { href: '/admin/sellers',     label: '셀러 관리' },
  { href: '/admin/settlements', label: '정산 관리' },
  { href: '/admin/categories',  label: '카테고리' },
  { href: '/admin/audit-logs',  label: '감사 로그' },
  { href: '/admin/ops-app',     label: '운영 앱' },
] as const;

const SELLER_CENTER_LINK: ConsoleLink[] = [{ href: '/seller', label: '셀러 센터 →' }];

/**
 * 관리자 내비게이션 — 모양·반응형은 공용 `ConsoleSidebar`, 여기는 항목만 정한다.
 * 셀러를 겸하는 계정이면 셀러 센터로 건너가는 링크를 하나 더 둔다(01-2 D3).
 */
export default function AdminSidebar() {
  const { user } = useAuth();

  return (
    <ConsoleSidebar
      title="🛍 관리자 콘솔"
      navLabel="관리자 메뉴"
      items={NAV_ITEMS}
      links={hasRole(user, 'seller') ? SELLER_CENTER_LINK : undefined}
    />
  );
}
