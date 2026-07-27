import Link from 'next/link';
import SellerGuard from './components/SellerGuard';

/**
 * (main)/seller/* 공통 레이아웃 — SellerGuard 로 전 구간을 보호한다.
 * 백엔드 가드(JwtAuthGuard + RolesGuard + getApprovedSeller)가 최종 판정이고,
 * 여기는 비-셀러가 빈 화면·403 을 만나기 전에 안내하는 UX 레이어다.
 */
export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return (
    <SellerGuard>
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <nav className="mb-6 flex items-center gap-4 border-b border-gray-200 pb-3 text-sm">
          <span className="font-bold text-gray-900">셀러 센터</span>
          <Link href="/seller/products" className="text-gray-600 hover:text-blue-600">
            상품 관리
          </Link>
          <Link href="/seller/products/new" className="text-gray-600 hover:text-blue-600">
            상품 등록
          </Link>
          <Link href="/seller/orders" className="text-gray-600 hover:text-blue-600">
            주문/배송
          </Link>
        </nav>
        {children}
      </div>
    </SellerGuard>
  );
}
