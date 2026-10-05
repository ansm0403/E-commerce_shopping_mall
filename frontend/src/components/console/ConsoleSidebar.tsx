'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { activeNavHref, type ConsoleLink, type ConsoleNavItem } from './nav';

interface ConsoleSidebarProps {
  /** 사이드바 맨 위 제목(예: "🛍 관리자 콘솔") */
  title: string;
  /** 메뉴 영역의 접근성 이름(`<nav aria-label>`) */
  navLabel: string;
  items: readonly ConsoleNavItem[];
  /** "쇼핑몰 홈으로" 옆에 더 둘 바깥 링크(마이페이지·다른 콘솔). 없으면 홈 링크만 */
  links?: readonly ConsoleLink[];
}

/**
 * 콘솔 내비게이션 — 관리자·셀러 셸이 같이 쓴다(항목·제목만 다르다).
 * - md 이상: 왼쪽 고정 사이드바(220px).
 * - md 미만: 상단 바(제목 + 홈) 아래 **가로 스크롤 칩 줄**. 드로어 대신 칩 줄을 고른 이유는
 *   항목이 10개 안쪽이라 한 줄에 다 들어가고, 열림 상태·오버레이·라우트 변경 시 닫기 같은
 *   상태가 없으며, 현재 위치가 항상 보이기 때문이다. 현재 항목은 라우트가 바뀔 때마다 보이는 자리로 스크롤한다.
 *
 * 둘 다 렌더하고 Tailwind `hidden md:flex` / `md:hidden` 으로 가른다 — JS 미디어 쿼리 훅은
 * 하이드레이션 전후로 다른 트리를 그려 깜빡인다. 인라인 `display` 를 두면 클래스를 이기므로 display 는 클래스로만 정한다.
 *
 * 현재 메뉴는 하나만 켠다(`activeNavHref` — 주소와 가장 길게 맞는 항목).
 */
export default function ConsoleSidebar({ title, navLabel, items, links = [] }: ConsoleSidebarProps) {
  const pathname = usePathname();
  const activeHref = activeNavHref(items, pathname);

  return (
    <>
      <DesktopSidebar title={title} navLabel={navLabel} items={items} links={links} activeHref={activeHref} />
      <MobileTopNav
        title={title}
        navLabel={navLabel}
        items={items}
        links={links}
        activeHref={activeHref}
        pathname={pathname}
      />
    </>
  );
}

interface NavViewProps extends Required<ConsoleSidebarProps> {
  activeHref: string | null;
}

const footerLinkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 12px',
  fontSize: '14px',
  color: '#94a3b8',
  textDecoration: 'none',
  borderRadius: '6px',
  transition: 'all 0.15s',
};

function highlightFooterLink(e: React.MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.style.background = '#0f172a';
  e.currentTarget.style.color = '#f8fafc';
}

function resetFooterLink(e: React.MouseEvent<HTMLAnchorElement>) {
  e.currentTarget.style.background = 'transparent';
  e.currentTarget.style.color = '#94a3b8';
}

function DesktopSidebar({ title, navLabel, items, links, activeHref }: NavViewProps) {
  return (
    <aside
      className="hidden md:flex md:min-h-screen md:w-[220px] md:shrink-0 md:flex-col"
      style={{ background: '#1e293b', color: '#f8fafc' }}
    >
      <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid #334155' }}>
        <span style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '-0.3px' }}>
          {title}
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
            e.currentTarget.style.color = '#f8fafc';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#94a3b8';
          }}
        >
          ← 쇼핑몰 홈으로
        </Link>
      </div>
      <nav aria-label={navLabel} style={{ flex: 1, padding: '12px 0' }}>
        {items.map(({ href, label }) => {
          const active = href === activeHref;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
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
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            style={footerLinkStyle}
            onMouseEnter={highlightFooterLink}
            onMouseLeave={resetFooterLink}
          >
            {label}
          </Link>
        ))}
        <Link
          href="/"
          style={footerLinkStyle}
          onMouseEnter={highlightFooterLink}
          onMouseLeave={resetFooterLink}
        >
          ← 쇼핑몰 홈으로
        </Link>
      </div>
    </aside>
  );
}

function MobileTopNav({ title, navLabel, items, links, activeHref, pathname }: NavViewProps & { pathname: string }) {
  const navRef = useRef<HTMLElement>(null);

  // 라우트가 바뀌면 현재 칩을 보이는 자리로. block:'nearest' 라 페이지 세로 스크롤은 건드리지 않는다.
  useEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [pathname]);

  const topLinkStyle: React.CSSProperties = { fontSize: '12px', color: '#94a3b8', textDecoration: 'none' };

  return (
    <div
      className="sticky top-0 z-header md:hidden"
      style={{ background: '#1e293b', color: '#f8fafc', boxShadow: '0 1px 3px rgba(15, 23, 42, 0.3)' }}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '-0.3px' }}>{title}</span>
        <div className="flex items-center gap-3">
          {links.map(({ href, label }) => (
            <Link key={href} href={href} style={topLinkStyle}>
              {label}
            </Link>
          ))}
          <Link href="/" style={topLinkStyle}>
            ← 쇼핑몰 홈으로
          </Link>
        </div>
      </div>
      <nav ref={navRef} aria-label={navLabel} className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
        {items.map(({ href, label }) => {
          const active = href === activeHref;
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
