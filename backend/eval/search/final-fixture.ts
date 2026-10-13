import type { EvalCase, EvalReview } from './search-eval-environment';

/** Held out: no source, product, topic or paraphrase is shared with improvement-v1. */
export const FINAL_FIXTURE_VERSION = 'reviews-final-v1';
const topics = [
  ['지퍼를 끝까지 올려도 이가 벌어져 열려요.', '잠금 장치가 저절로 풀리는 불만', '지퍼', '얼굴 인식'],
  ['한여름에 입으니 공기가 통하지 않아 땀이 차요.', '열기가 빠져나가지 못해 답답했던 경험', '땀', '털 알레르기'],
  ['화면이 몇 초 간격으로 번쩍거려 눈이 피곤해요.', '디스플레이 밝기가 반복해서 흔들린다는 반응', '화면', 'GPS 위치'],
  ['무선 연결이 계속 끊겨 다시 페어링해야 해요.', '블루투스 접속이 자꾸 해제되는 불만', '연결', '수중 촬영'],
  ['버튼을 눌러도 반응이 없어 여러 번 눌러야 해요.', '조작 입력이 한 번에 인식되지 않는 문제', '버튼', '음성 통역'],
  ['용기 안에 화학약품 같은 냄새가 남아 음식에 배어요.', '보관통의 이상한 향이 내용물에 옮겨가는 불만', '냄새', '전자 결제'],
  ['손잡이가 너무 뜨거워 맨손으로 들 수 없어요.', '잡는 부분이 달아올라 사용하기 힘든 경험', '뜨거', 'UV 차단'],
  ['침대 가장자리가 꺼져서 누우면 한쪽으로 기울어요.', '매트리스 모서리 지지력이 약하다는 불만', '꺼', '음식 냉동'],
  ['흡입구가 자꾸 막혀 먼지를 다시 뱉어내요.', '청소 중 빨아들인 먼지가 밖으로 되돌아오는 문제', '먼지', '심박수 측정'],
  ['프린터가 종이를 여러 장 한꺼번에 물고 걸려요.', '용지 공급 장치가 겹쳐 잡아 인쇄를 멈추는 불만', '종이', '자동 주차'],
] as const;

export const finalReviews: EvalReview[] = topics.flatMap(([negative, , , absent], index) => Array.from({ length: 10 }, (_, slot) => ({
  id: 1001 + index * 10 + slot, productId: 101 + index, rating: slot === 1 ? 2 : 5,
  comment: slot < 2 || slot === 3 ? negative : slot === 2
    ? `걱정했던 "${negative}"와 같은 문제는 실제로 없었고 정상적으로 작동해 만족합니다.`
    : slot === 4 ? topics[(index + 1) % topics.length][0]
    : `상품 ${101 + index}의 디자인이 마음에 듭니다. ${absent} 기능에 대한 사용 경험은 적지 않았습니다.`,
  createdAt: slot === 3 ? '2026-09-30T23:59:59+09:00' : slot < 2 ? '2026-10-02T09:00:00+09:00' : '2026-10-12T09:00:00+09:00',
})));

export interface FinalCase extends EvalCase { question: string; answerFacts: string[]; noEvidence: boolean; }
export const finalCases: FinalCase[] = topics.flatMap(([, query, fact, absent], index) => [
  { caseId: `final-${index + 1}-meaning`, query, productId: 101 + index, maxRating: null,
    startDate: '2026-10-01', endDate: '2026-10-13', relevantIds: [1001 + index * 10, 1002 + index * 10],
    reason: '범위 안의 직접 불만 두 건. 높은 별점 포함. 긍정 부정문·기간 밖 원문·다른 문제는 비관련.',
    question: `상품 ${101 + index}의 2026년 10월 1일부터 13일까지 리뷰에서 ${query}을 찾아 원본 ID와 인용으로 알려줘.`, answerFacts: [fact], noEvidence: false },
  { caseId: `final-${index + 1}-rating`, query: `${query}의 구체적 사례`, productId: 101 + index, maxRating: 2,
    startDate: '2026-10-01', endDate: '2026-10-13', relevantIds: [1002 + index * 10],
    reason: '명시한 2점 이하·상품·기간을 모두 만족하는 직접 불만 한 건.',
    question: `상품 ${101 + index}의 2026년 10월 1일부터 13일까지 2점 이하 리뷰에서 ${query}을 찾아 원본 ID와 인용으로 알려줘.`, answerFacts: [fact], noEvidence: false },
  { caseId: `final-${index + 1}-absent`, query: `${absent} 기능이 고장났다는 불만`, productId: 101 + index, maxRating: null,
    startDate: '2026-10-01', endDate: '2026-10-13', relevantIds: [],
    reason: '해당 기능의 고장 경험은 전체 범위에 없다. 사용 경험을 적지 않았다는 문장은 불만이 아니다.',
    question: `상품 ${101 + index}의 2026년 10월 1일부터 13일까지 리뷰에서 ${absent} 기능이 고장났다는 불만을 찾아줘.`, answerFacts: [], noEvidence: true },
]);

/** Set before final execution; do not relax after reading held-out results. */
export const FINAL_CRITERIA = Object.freeze({
  retrieval: { hitAt5: 0.95, recallAt5: 0.9, maxApiErrors: 0 },
  answer: { minimumEvidenceSuccessRate: 0.9, minimumNoEvidenceSuccessRate: 0.9, unmaskedContacts: 0, invalidCitations: 0 },
  review: 'Developer reviews all 30 final answers. Automated citation/fact checks are necessary checks, not final correctness judgments.',
  frozenBeforeFinalExecution: '2026-10-13',
});
