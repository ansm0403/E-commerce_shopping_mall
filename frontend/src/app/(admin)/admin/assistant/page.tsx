import AssistantChat from './components/AssistantChat';

export default function AdminAssistantPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="m-0 text-[24px] font-bold text-slate-900">AI 어시스턴트</h1>
        <p className="mt-1 mb-0 text-[13px] text-slate-500">
          사내 운영 데이터를 자연어로 묻고 분석을 받습니다.
        </p>
      </header>

      <AssistantChat />
    </div>
  );
}
