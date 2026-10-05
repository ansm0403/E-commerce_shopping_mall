import SellerGuard from './components/SellerGuard';
import SellerNav from './components/SellerNav';

/**
 * (main)/seller/* 공통 레이아웃 — SellerGuard 로 전 구간을 보호한다.
 * 백엔드 가드(JwtAuthGuard + RolesGuard + getApprovedSeller)가 최종 판정이고,
 * 여기는 비-셀러가 빈 화면·403 을 만나기 전에 안내하는 UX 레이어다.
 */
export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return (
    <SellerGuard>
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <SellerNav />
        {children}
      </div>
    </SellerGuard>
  );
}
