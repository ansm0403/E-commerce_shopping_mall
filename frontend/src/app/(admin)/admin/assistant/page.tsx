import AssistantChat from './components/AssistantChat';

export default function AdminAssistantPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>
          AI 어시스턴트
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          사내 운영 데이터를 자연어로 묻고 분석을 받습니다.
        </p>
      </header>

      <AssistantChat />
    </div>
  );
}
