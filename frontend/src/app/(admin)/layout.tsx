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
 *
 * 반응형(2026-09-28): md(768px) 미만에서는 사이드바 대신 상단 바 + 가로 스크롤 내비가 되고
 * (AdminSidebar 내부 분기), 본문은 세로로 쌓인다. main 의 `min-w-0` 는 flex 자식이
 * 내용 폭만큼 커지지 않게 막아 안쪽 표의 가로 스크롤(table-ui `tableScrollStyle`)이 작동하게 한다.
 * 관리자 구역은 인라인 스타일이 대부분이라 미디어 쿼리가 필요한 속성만 Tailwind 클래스로 뺐다.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: '#f1f5f9' }}>
      <DemoModeBanner />
      <div className="flex flex-1 flex-col md:flex-row">
        <AdminSidebar />
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
          <AdminGuard>{children}</AdminGuard>
        </main>
      </div>
    </div>
  );
}
