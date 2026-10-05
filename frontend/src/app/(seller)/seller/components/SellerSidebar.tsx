'use client';

import ConsoleSidebar from '../../../../components/console/ConsoleSidebar';
import type { ConsoleLink } from '../../../../components/console/nav';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasRole } from '../../../../lib/roles';
import { SELLER_NAV_ITEMS } from '../nav-items';

const MY_PAGE_LINK: ConsoleLink = { href: '/my', label: '마이페이지' };
const ADMIN_CONSOLE_LINK: ConsoleLink = { href: '/admin/dashboard', label: '관리자 콘솔 →' };

/**
 * 셀러 센터 내비게이션 — 모양·반응형은 공용 `ConsoleSidebar`, 여기는 항목만 정한다.
 *
 * 셀러 화면은 쇼핑몰 헤더·푸터가 없는 콘솔이라, 상점으로 돌아가는 길을 사이드바가 맡는다:
 * "쇼핑몰 홈으로"(공용) + "마이페이지". 관리자를 겸하는 계정이면 "관리자 콘솔"도 둔다(01-2 D3).
 */
export default function SellerSidebar() {
  const { user } = useAuth();
  const links = hasRole(user, 'admin') ? [MY_PAGE_LINK, ADMIN_CONSOLE_LINK] : [MY_PAGE_LINK];

  return <ConsoleSidebar title="🏪 셀러 센터" navLabel="셀러 센터" items={SELLER_NAV_ITEMS} links={links} />;
}
