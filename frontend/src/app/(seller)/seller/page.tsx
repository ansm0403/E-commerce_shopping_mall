import { redirect } from 'next/navigation';

/**
 * `/seller` 인덱스 — 대시보드가 생기기 전까지 상품 관리로 보낸다.
 * 헤더 "셀러 센터"와 셀러 승인 안내 카드가 이 주소로 보내므로 빈 화면이면 안 된다.
 * (대시보드는 01-2-seller-dashboard-inquiry.md §3-2 에 남아 있다)
 */
export default function SellerIndexPage() {
  redirect('/seller/products');
}
