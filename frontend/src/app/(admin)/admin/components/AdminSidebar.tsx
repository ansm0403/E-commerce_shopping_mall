'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const NAV_ITEMS = [
  { href: '/admin/dashboard',   label: '대시보드' },
  { href: '/admin/assistant',   label: 'AI 어시스턴트' },
  { href: '/admin/orders',      label: '주문 관리' },
  { href: '/admin/products',    label: '상품 관리' },
  { href: '/admin/sellers',     label: '셀러 관리' },
  { href: '/admin/settlements', label: '정산 관리' },
  { href: '/admin/categories',  label: '카테고리' },
  { href: '/admin/audit-logs',  label: '감사 로그' },
  { href: '/admin/ops-app',     label: '운영 앱' },
] as const;

/**
 * 관리자 내비게이션.
 * - md 이상: 왼쪽 고정 사이드바(220px).
 * - md 미만: 상단 바(제목 + 홈) 아래 **가로 스크롤 칩 줄**. 드로어 대신 칩 줄을 고른 이유는
 *   항목이 9개뿐이라 한 줄에 다 들어가고, 열림 상태·오버레이·라우트 변경 시 닫기 같은
 *   상태가 없으며, 현재 위치가 항상 보이기 때문이다. 현재 항목은 라우트가 바뀔 때마다 보이는 자리로 스크롤한다.
 *
 * 둘 다 렌더하고 Tailwind `hidden md:flex` / `md:hidden` 으로 가른다 — JS 미디어 쿼리 훅은
 * 하이드레이션 전후로 다른 트리를 그려 깜빡인다. 인라인 `display` 를 두면 클래스를 이기므로 display 는 클래스로만 정한다.
 */
export default function AdminSidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <>
      <DesktopSidebar isActive={isActive} />
      <MobileTopNav isActive={isActive} pathname={pathname} />
    </>
  );
}

function DesktopSidebar({ isActive }: { isActive: (href: string) => boolean }) {
  return (
    <aside
      className="hidden md:flex md:min-h-screen md:w-[220px] md:shrink-0 md:flex-col"
      style={{ background: '#1e293b', color: '#f8fafc' }}
    >
      <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid #334155' }}>
        <span style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '-0.3px' }}>
          🛍 관리자 콘솔
        </span>
        {/* 상단 홈 링크 — 감사 로그처럼 긴 페이지에서 하단 홈 버튼이 스크롤로 가려지는 문제 보완 */}
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            marginTop: '12px',
            fontSize: '12px',
            color: '#94a3b8',
            textDecoration: 'none',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.color = '#f8fafc';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.color = '#94a3b8';
          }}
        >
          ← 쇼핑몰 홈으로
        </Link>
      </div>
      <nav style={{ flex: 1, padding: '12px 0' }}>
        {NAV_ITEMS.map(({ href, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'block',
                padding: '10px 20px',
                fontSize: '14px',
                color: active ? '#38bdf8' : '#94a3b8',
                background: active ? '#0f172a' : 'transparent',
                textDecoration: 'none',
                borderLeft: active ? '3px solid #38bdf8' : '3px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <div style={{ padding: '16px 20px', borderTop: '1px solid #334155' }}>
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            fontSize: '14px',
            color: '#94a3b8',
            textDecoration: 'none',
            borderRadius: '6px',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = '#0f172a';
            (e.currentTarget as HTMLAnchorElement).style.color = '#f8fafc';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
            (e.currentTarget as HTMLAnchorElement).style.color = '#94a3b8';
          }}
        >
          ← 쇼핑몰 홈으로
        </Link>
      </div>
    </aside>
  );
}

function MobileTopNav({
  isActive,
  pathname,
}: {
  isActive: (href: string) => boolean;
  pathname: string;
}) {
  const navRef = useRef<HTMLElement>(null);

  // 라우트가 바뀌면 현재 칩을 보이는 자리로. block:'nearest' 라 페이지 세로 스크롤은 건드리지 않는다.
  useEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [pathname]);

  return (
    <div
      className="sticky top-0 z-header md:hidden"
      style={{ background: '#1e293b', color: '#f8fafc', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.3)' }}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '-0.3px' }}>🛍 관리자 콘솔</span>
        <Link href="/" style={{ fontSize: '12px', color: '#94a3b8', textDecoration: 'none' }}>
          ← 쇼핑몰 홈으로
        </Link>
      </div>
      <nav ref={navRef} aria-label="관리자 메뉴" className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
        {NAV_ITEMS.map(({ href, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              data-active={active ? 'true' : undefined}
              aria-current={active ? 'page' : undefined}
              className="shrink-0 whitespace-nowrap rounded-full"
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: active ? 700 : 500,
                color: active ? '#38bdf8' : '#cbd5e1',
                background: active ? '#0f172a' : 'transparent',
                border: `1px solid ${active ? '#38bdf8' : '#334155'}`,
                textDecoration: 'none',
              }}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
