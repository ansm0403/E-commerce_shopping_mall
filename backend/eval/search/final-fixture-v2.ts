import type { EvalReview } from './search-eval-environment';
import { FINAL_CRITERIA, FinalCase } from './final-fixture';

/** V1 became improvement data after observing answer failures. Freeze these new topics before V2 execution. */
export const FINAL_V2_VERSION = 'reviews-final-v2';
export const FINAL_V2_CRITERIA = { ...FINAL_CRITERIA, frozenBeforeFinalExecution: '2026-10-13',
  reason: 'V1 revealed literal matching and rating-based polarity errors. V2 shares no source/product/topic/question with either previous corpus.' };
const topics = [
  ['소매를 만지면 찌릿하고 천이 몸에 달라붙어요.', '옷에서 전기가 올라 착용이 불편한 불만', '찌릿', '자동 분류'],
  ['가방 끈이 어깨를 파고들어 멍이 들었어요.', '짐을 메면 어깨가 눌려 아픈 경험', '어깨', '야간 조도 감지'],
  ['햇빛이 비치면 커튼 너머 실루엣이 그대로 보여요.', '가림막으로 사생활을 보호하기 어렵다는 불만', '실루엣', '오프라인 번역'],
  ['같이 빤 흰 옷이 푸른색으로 물들어 버렸어요.', '세탁 중 색이 다른 빨래로 옮겨간 문제', '물들', '자동 세제 투입'],
  ['책표지 모서리가 일주일 만에 너덜너덜해졌어요.', '책의 겉면이 마찰을 견디지 못한 불만', '모서리', '자동 급식'],
  ['냉장 보관했는데 며칠 만에 곰팡이가 퍼졌어요.', '보관한 식품에 균이 생겨 먹기 힘든 경험', '곰팡이', '모션 인식'],
  ['마우스를 가만히 놔도 커서가 혼자 움직여요.', '입력 기기를 멈췄는데 포인터가 이동하는 문제', '커서', '생체 인증'],
  ['의자 높이를 맞춰도 앉으면 천천히 내려가요.', '좌석 높이 설정이 유지되지 않는 불만', '높이', '대기질 측정'],
  ['면도할 때 털이 뽑혀 피부가 따가워요.', '털을 깎는 과정에서 피부가 아픈 경험', '따가', '자동 분리 수거'],
  ['잔 테두리가 두꺼워 마시면 음료가 턱으로 흘러요.', '컵으로 음료를 넘길 때 입 밖으로 새는 불편', '턱', '무게 기록'],
] as const;

export const finalV2Reviews: EvalReview[] = topics.flatMap(([negative, , , absent], index) => Array.from({ length: 10 }, (_, slot) => ({
  id: 2001 + index * 10 + slot, productId: 201 + index, rating: slot === 1 || slot === 2 ? 2 : 5,
  comment: slot < 2 || slot === 3 ? negative : slot === 2
    ? `걱정했던 "${negative}"와 같은 문제는 실제로 없었습니다. 별점은 배송 일정 때문에 낮게 주었습니다.`
    : slot === 4 ? topics[(index + 1) % topics.length][0]
    : `상품 ${201 + index}의 디자인이 마음에 듭니다. ${absent} 기능은 사용하지 않아 관련 경험을 적지 않았습니다.`,
  createdAt: slot === 3 ? '2026-09-30T23:59:59+09:00' : slot < 2 ? '2026-10-02T09:00:00+09:00' : '2026-10-12T09:00:00+09:00',
})));
export const finalV2Cases: FinalCase[] = topics.flatMap(([, query, fact, absent], index) => [
  { caseId: `final-v2-${index + 1}-meaning`, query, productId: 201 + index, maxRating: null, startDate: '2026-10-01', endDate: '2026-10-13',
    relevantIds: [2001 + index * 10, 2002 + index * 10], reason: '본문으로 확인한 불만 두 건. 높은 별점 포함. 낮은 별점의 문제 없음·기간 밖·다른 문제는 비관련.',
    question: `상품 ${201 + index}의 2026년 10월 1일부터 13일까지 리뷰에서 ${query}을 찾아 원본 ID와 인용으로 알려줘.`, answerFacts: [fact], noEvidence: false },
  { caseId: `final-v2-${index + 1}-rating`, query: `${query}의 구체적 사례`, productId: 201 + index, maxRating: 2, startDate: '2026-10-01', endDate: '2026-10-13',
    relevantIds: [2002 + index * 10], reason: '상품·기간·2점 이하를 만족하며 본문에 해당 불만이 있는 한 건. 낮은 별점의 문제 없음은 비관련.',
    question: `상품 ${201 + index}의 2026년 10월 1일부터 13일까지 2점 이하 리뷰에서 ${query}을 찾아 원본 ID와 인용으로 알려줘.`, answerFacts: [fact], noEvidence: false },
  { caseId: `final-v2-${index + 1}-absent`, query: `${absent} 기능이 고장났다는 불만`, productId: 201 + index, maxRating: null, startDate: '2026-10-01', endDate: '2026-10-13',
    relevantIds: [], reason: '지정 기능의 고장 경험은 조건 범위에 없다. 미사용이라는 원문은 긍정·고장 경험의 근거가 아니다.',
    question: `상품 ${201 + index}의 2026년 10월 1일부터 13일까지 리뷰에서 ${absent} 기능이 고장났다는 불만을 찾아줘.`, answerFacts: [], noEvidence: true },
]);
