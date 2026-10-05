import Link from 'next/link';

/** 대시보드의 흰 카드 — 표 카드(`table-ui cardStyle`)와 같은 모서리·그림자 */
export const panelStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: '12px',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
};

/** 구역 머리 — 제목 + 오른쪽 "전체 보기 →" */
export function SectionHeader({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '16px 16px 12px',
      }}
    >
      <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{title}</h2>
      <Link href={href} style={{ fontSize: '13px', fontWeight: 600, color: '#2563eb', whiteSpace: 'nowrap' }}>
        {linkLabel} →
      </Link>
    </div>
  );
}
