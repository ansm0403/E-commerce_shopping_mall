/** 콘솔(관리자·셀러) 사이드바의 메뉴 한 줄 */
export interface ConsoleNavItem {
  href: string;
  label: string;
}

/** 메뉴 아래쪽(모바일은 상단 바 오른쪽)에 두는 바깥 링크 — 쇼핑몰·마이페이지·다른 콘솔 */
export interface ConsoleLink {
  href: string;
  label: string;
}

/**
 * 지금 화면에 해당하는 메뉴 하나를 고른다 — 주소의 앞부분과 **가장 길게** 맞는 항목.
 * `/seller/products/new` 는 '상품 관리'(`/seller/products`)와도 앞부분이 겹치므로 단순 startsWith 로는 둘 다 켜진다.
 * 예: `/seller/products/12/edit` → 상품 관리 · `/seller/products/new` → 상품 등록
 */
export function activeNavHref(items: readonly ConsoleNavItem[], pathname: string): string | null {
  const matches = items.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).href;
}
