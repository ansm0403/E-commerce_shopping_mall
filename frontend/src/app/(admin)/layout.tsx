import AdminSidebar from './admin/components/AdminSidebar';
import AdminGuard from './admin/components/AdminGuard';
import DemoModeBanner from './admin/components/DemoModeBanner';

/**
 * (admin) route group의 공용 셸.
 *
 * 인증/인가 3중 방어 (Design_Dashboard.md §4.1):
 *   1. middleware.ts        — refreshToken 쿠키 존재 체크 (UX 빠른 차단)
 *   2. AdminGuard (client)  — /auth/me 호출 + roles 검증 (UX)
 *   3. backend RolesGuard   — JWT + role 검증 (진실 원천)
 *
 * 이 layout은 Server Component지만 검증을 하지 않는다.
 * 이유: Server Component는 cookies().set() 불가 → /auth/refresh 호출 시
 *       회전된 새 refreshToken을 브라우저에 반영할 수 없어, 다음 호출이
 *       "토큰 재사용"으로 오판되어 백엔드가 모든 세션을 invalidate 시킴.
 *       검증은 client-side AdminGuard로 위임 (axios가 refresh 응답의 Set-Cookie를
 *       브라우저에 자연스럽게 반영하여 회전 부작용 없음).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#f1f5f9' }}>
      <DemoModeBanner />
      <div style={{ display: 'flex', flex: 1 }}>
        <AdminSidebar />
        <main style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
          <AdminGuard>{children}</AdminGuard>
        </main>
      </div>
    </div>
  );
}
