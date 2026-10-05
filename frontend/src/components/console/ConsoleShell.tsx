import DemoModeBanner from './DemoModeBanner';

/**
 * 콘솔 셸 — 관리자(`(admin)`)와 셀러(`(seller)`) 라우트 그룹이 같이 쓰는 틀.
 * 위에서부터 데모 배너 → [사이드바 | 본문]. 사이드바와 가드는 그룹마다 달라서 밖에서 받는다
 * (`sidebar` 에 `ConsoleSidebar` 를 감싼 것, `children` 을 가드로 감싼 것).
 *
 * 반응형(2026-09-28): md(768px) 미만에서는 사이드바 대신 상단 바 + 가로 스크롤 내비가 되고
 * (ConsoleSidebar 내부 분기), 본문은 세로로 쌓인다. main 의 `min-w-0` 는 flex 자식이
 * 내용 폭만큼 커지지 않게 막아 안쪽 표의 가로 스크롤(table-ui `tableScrollStyle`)이 작동하게 한다.
 * 콘솔 구역은 인라인 스타일이 대부분이라 미디어 쿼리가 필요한 속성만 Tailwind 클래스로 뺐다.
 */
export default function ConsoleShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: '#f1f5f9' }}>
      <DemoModeBanner />
      <div className="flex flex-1 flex-col md:flex-row">
        {sidebar}
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
