import ConsoleShell from '../../components/console/ConsoleShell';
import SellerGuard from './seller/components/SellerGuard';
import SellerSidebar from './seller/components/SellerSidebar';

/**
 * (seller) route group 의 셸 — 관리자와 같은 `ConsoleShell` 을 쓴다(쇼핑몰 헤더·푸터 없음).
 *
 * 보호는 관리자와 같은 3단:
 *   1. middleware.ts        — refreshToken 쿠키가 없으면 /login?redirect=
 *   2. SellerGuard (client) — /auth/me 로 seller 확인, 비-셀러는 /my/seller-apply 안내
 *   3. 백엔드 가드           — JwtAuthGuard + RolesGuard + getApprovedSeller 가 최종 판정
 *
 * 화면(children)은 SellerGuard **안쪽**에만 둔다 — 승인 직후의 낡은 토큰을 가드가 먼저 갱신해야
 * 셀러 API 가 403 을 받지 않는다.
 */
export default function SellerLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleShell sidebar={<SellerSidebar />}>
      <SellerGuard>{children}</SellerGuard>
    </ConsoleShell>
  );
}
