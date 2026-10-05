import type { ConsoleNavItem } from '../../../components/console/nav';

/** 셀러 센터 사이드바 메뉴 — layout·page 파일은 default 외 export 를 둘 수 없어 따로 둔다 */
export const SELLER_NAV_ITEMS: readonly ConsoleNavItem[] = [
  { href: '/seller/products', label: '상품 관리' },
  { href: '/seller/products/new', label: '상품 등록' },
  { href: '/seller/orders', label: '주문/배송' },
  { href: '/seller/settlements', label: '정산' },
  { href: '/seller/inquiries', label: '문의' },
];
