'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/admin/dashboard',   label: '대시보드' },
  { href: '/admin/orders',      label: '주문 관리' },
  { href: '/admin/products',    label: '상품 관리' },
  { href: '/admin/sellers',     label: '셀러 관리' },
  { href: '/admin/settlements', label: '정산 관리' },
  { href: '/admin/categories',  label: '카테고리' },
  { href: '/admin/audit-logs',  label: '감사 로그' },
] as const;

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside style={{
      width: '220px',
      minHeight: '100vh',
      background: '#1e293b',
      color: '#f8fafc',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      <div style={{ padding: '24px 20px 16px', borderBottom: '1px solid #334155' }}>
        <span style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '-0.3px' }}>
          🛍 관리자 콘솔
        </span>
      </div>
      <nav style={{ flex: 1, padding: '12px 0' }}>
        {NAV_ITEMS.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
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
