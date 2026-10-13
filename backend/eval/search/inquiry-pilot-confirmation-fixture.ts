import type { EvalInquiry } from './search-eval-environment';
import type { InquiryEvalCase } from './inquiry-fixture';

/** Frozen independently after the initial two-case diagnostic; never combine their quality scores. */
export const INQUIRY_CONFIRMATION_VERSION = 'inquiries-assistant-confirmation-v1';
export const INQUIRY_CONFIRMATION_CRITERIA = Object.freeze({
  frozenBeforeExecution: '2026-10-14',
  planned: 2,
  description: 'Independent small confirmation after date/polarity/title-only fixes. Source IDs, products, topics and questions differ from the initial pilot. Human review remains required; this is not the 30-question final evaluation.',
});

const sources: EvalInquiry[] = [
  { id: 5001, productId: 501, title: '배송 상자가 젖어 포장 종이가 찢어진 문의', content: '', answer: null,
    isSecret: false, status: 'waiting', createdAt: '2026-10-02T10:00:00+09:00' },
  { id: 5002, productId: 501, title: '비 오는 날 포장 상태가 걱정됐어요',
    content: '상자가 젖거나 포장 종이가 찢어질까 걱정했지만 실제로 받은 상자는 마르고 멀쩡했습니다.', answer: null,
    isSecret: false, status: 'waiting', createdAt: '2026-10-03T11:00:00+09:00' },
  { id: 5003, productId: 501, title: '선물 포장 색상 선택', content: '포장 리본을 파란색으로 선택할 수 있나요?', answer: null,
    isSecret: false, status: 'waiting', createdAt: '2026-10-04T09:00:00+09:00' },
  { id: 5004, productId: 501, title: '젖어서 찢어진 배송 상자', content: '배송 상자가 물에 젖고 포장 종이가 찢어진 채 도착했습니다.', answer: null,
    isSecret: false, status: 'waiting', createdAt: '2026-10-13T09:00:00+09:00' },
  { id: 5005, productId: 501, title: 'PRIVATE_INQUIRY 젖은 포장', content: '상자가 젖고 포장이 찢어졌습니다. 비공개 상담입니다.', answer: null,
    isSecret: true, status: 'waiting', createdAt: '2026-10-05T09:00:00+09:00' },
  { id: 5011, productId: 502, title: '다음 날 빵이 단단해졌어요', content: '빵을 냉장고에 넣었더니 다음 날 딱딱해졌습니다. 부드럽게 먹는 방법이 있나요?',
    answer: '먹기 전에 살짝 데우고 남은 빵은 밀봉해 냉동 보관해주세요.', isSecret: false, status: 'answered', createdAt: '2026-10-03T12:00:00+09:00' },
  { id: 5012, productId: 502, title: '밀봉한 빵의 부드러움', content: '밀봉해서 두니 다음 날에도 부드러웠습니다. 데워 먹어도 되나요?', answer: null,
    isSecret: false, status: 'waiting', createdAt: '2026-10-05T10:00:00+09:00' },
  { id: 5013, productId: 502, title: '보관용 봉투 사용 문의', content: '남은 빵을 보관하는 봉투를 별도로 판매하나요?',
    answer: '밀봉할 수 있는 식품 보관용 봉투를 이용해주세요.', isSecret: false, status: 'answered', createdAt: '2026-10-04T14:00:00+09:00' },
  { id: 5014, productId: 502, title: '빵에 곰팡이가 생긴 문제', content: '빵 표면에 푸른 곰팡이가 생겼습니다.', answer: null,
    isSecret: false, status: 'waiting', createdAt: '2026-10-13T09:00:00+09:00' },
  { id: 5015, productId: 502, title: 'PRIVATE_INQUIRY 빵 보관 문제', content: '빵에 곰팡이가 생긴 문제를 비공개로 상담합니다.',
    answer: '비공개 개별 상담 안내입니다.', isSecret: true, status: 'answered', createdAt: '2026-10-06T09:00:00+09:00' },
];
export const confirmationInquiries: readonly Readonly<EvalInquiry>[] = Object.freeze(sources.map(source => Object.freeze(source)));

const cases: InquiryEvalCase[] = [
  { caseId: 'inquiry-confirmation-title',
    question: '상품 501의 2026-10-01부터 2026-10-12까지 답변 대기 중인 공개 문의에서 배송 상자가 젖어 포장 종이가 찢어졌다는 불만을 의미 검색으로 찾아줘. 문의 ID와 원문을 인용해줘.',
    query: '배송 상자가 젖어 포장 종이가 찢어졌다는 불만', productId: 501, status: 'waiting', startDate: '2026-10-01', endDate: '2026-10-12',
    relevantIds: [5001], reason: '범위 안의 실제 불만은 제목만 있는 #5001이다. #5002는 걱정했으나 실제로 멀쩡했다는 반대 경험이므로 불만 근거가 아니다. #5004는 10월 13일로 범위 밖, #5005는 비밀 문의다. 없는 본문이나 답변을 만들어 인용하면 안 된다.',
    answerFacts: ['젖', '찢'], noEvidence: false },
  { caseId: 'inquiry-confirmation-absent',
    question: '상품 502의 2026-10-01부터 2026-10-12까지 공개 문의에서 빵에 곰팡이가 생겼다는 불만을 의미 검색으로 찾아줘. 문의 ID와 원문을 인용해줘.',
    query: '빵에 곰팡이가 생겼다는 불만', productId: 502, startDate: '2026-10-01', endDate: '2026-10-12', relevantIds: [],
    reason: '기간 안의 공개 문의는 빵이 단단해진 현상·부드러운 경험·보관 봉투 안내뿐이며 곰팡이 불만 근거는 없다. #5014의 곰팡이 불만은 10월 13일로 범위 밖이고 #5015는 비밀 문의다. 관련 없는 후보를 곰팡이 근거로 인용하면 안 된다.',
    answerFacts: [], noEvidence: true },
];
export const confirmationInquiryCases: readonly Readonly<InquiryEvalCase>[] = Object.freeze(cases.map(item => {
  Object.freeze(item.relevantIds); Object.freeze(item.answerFacts);
  return Object.freeze(item);
}));
