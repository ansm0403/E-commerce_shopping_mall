export interface MyNavItem {
  href: string;
  label: string;
  /** 하위 주소에서는 켜지 않는다(`/my` 는 모든 하위 주소의 앞부분이다) */
  exact?: boolean;
  /** 마이페이지 밖으로 나가는 링크 — 화살표를 붙이고 위에 구분선을 둔다 */
  external?: boolean;
}

const BASE_NAV_ITEMS: MyNavItem[] = [
  { href: '/my', label: '내 정보', exact: true },
  { href: '/my/orders', label: '주문 내역' },
  { href: '/my/reviews', label: '내 리뷰' },
  { href: '/my/wishlist', label: '위시리스트' },
  { href: '/my/inquiries', label: '내 문의' },
  { href: '/my/password', label: '비밀번호 변경' },
  { href: '/my/seller-apply', label: '셀러 신청' },
];

/**
 * 마이페이지 네비 항목. 셀러에게는 맨 끝에 "셀러 센터"를 더한다 — 없으면 셀러가 마이페이지에서
 * 셀러 센터로 갈 길이 헤더의 닉네임 메뉴뿐이다. "셀러 신청"은 셀러에게도 남긴다(승인 일시 등 신청 내역을 본다).
 *
 * (layout.tsx 에 두지 않는 이유: Next 는 layout 파일의 default 외 export 를 허용하지 않는다)
 */
export function myNavItems(isSeller: boolean): MyNavItem[] {
  return isSeller
    ? [...BASE_NAV_ITEMS, { href: '/seller/products', label: '셀러 센터', external: true }]
    : BASE_NAV_ITEMS;
}

export function isMyNavActive(pathname: string, item: MyNavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
