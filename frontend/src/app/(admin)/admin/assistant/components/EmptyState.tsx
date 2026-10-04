interface Props {
  /** 추천 질문을 누르면 그대로 전송한다 */
  onPick: (question: string) => void;
}

/**
 * 추천 질문 — eval 골든셋(`backend/eval/golden-set.json`)에서 도구 선택이 통과한 문장 그대로.
 * 매출 · 리뷰 · 문의 · 감사 로그 각 1개(처음 온 사람이 무엇을 물을 수 있는지 보이게).
 */
const SUGGESTIONS = [
  '지난달 매출 알려줘',
  '부정적인 리뷰들 핵심만 요약해줘',
  '아직 답변 안 한 고객 문의 요약해줘',
  '최근에 뭔가 수상한 로그인 움직임이 있었는지 봐줘',
];

export default function EmptyState({ onPick }: Props) {
  return (
    <div className="m-auto flex flex-col items-center gap-4 text-center">
      <p className="m-0 text-sm leading-[1.7] text-slate-500">
        관리자 어시스턴트입니다.
        <br />
        궁금한 운영 내용을 자연어로 물어보세요.
        <br />
        <span className="text-[12px]">
          매출·주문·감사로그·상품을 실데이터로 조회합니다. 대화는 저장되어 새로고침 후에도 이어집니다.
        </span>
      </p>

      <ul aria-label="추천 질문" className="m-0 p-0 list-none flex flex-wrap justify-center gap-2 max-w-[560px]">
        {SUGGESTIONS.map((question) => (
          <li key={question}>
            <button
              type="button"
              onClick={() => onPick(question)}
              className="px-3 py-1.5 rounded-full border border-slate-300 bg-white text-[13px] text-slate-700 hover:bg-slate-50 hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              {question}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
