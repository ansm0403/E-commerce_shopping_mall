import { Suspense } from 'react';
import TriageCards from './components/TriageCards';
import AuditFilters from './components/AuditFilters';
import AuditTable from './components/AuditTable';

/**
 * 관리자 감사 로그 조회 (ex-audit-log-admin §5).
 * - 상단: 트리아지 뷰(§5-A) — 3버킷 요약 카드 "봐야 할 것"
 * - 하단: 포렌식 검색 뷰(§5-B) — 필터 + 표 + 페이지네이션 "무슨 일이 있었나"
 *
 * 데이터 출처는 동일한 audit_logs(GET /admin/audit-logs). 버킷 분류는 프론트 표현일 뿐.
 * useSearchParams 를 쓰는 컴포넌트는 Next.js 15에서 Suspense 경계가 필요.
 */
export default function AdminAuditLogsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
          감사 로그
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          누가·언제·무엇을 했는지 — 보안·시스템 오류·관리자 행위 기록
        </p>
      </header>

      {/* §5-A 트리아지 요약 */}
      <Suspense fallback={<div style={{ height: 180 }} />}>
        <TriageCards />
      </Suspense>

      {/* §5-B 포렌식 검색 */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
          포렌식 검색
        </h2>
        <Suspense fallback={<div style={{ height: 64 }} />}>
          <AuditFilters />
        </Suspense>
        <Suspense fallback={<div style={{ height: 320 }} />}>
          <AuditTable />
        </Suspense>
      </section>
    </div>
  );
}
