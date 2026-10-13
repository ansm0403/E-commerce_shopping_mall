import type { EvalInquiry } from './search-eval-environment';

export interface InquiryEvalCase {
  caseId: string;
  question: string;
  query: string;
  productId: number;
  status?: 'waiting' | 'answered';
  startDate?: string;
  endDate?: string;
  relevantIds: number[];
  reason: string;
  answerFacts: string[];
  noEvidence: boolean;
}

/** Synthetic corpora only. Keep improvement topics separate from the frozen validation topics. */
export const INQUIRY_IMPROVEMENT_VERSION = 'inquiries-improvement-v1';
export const INQUIRY_FINAL_VERSION = 'inquiries-final-small-v1';
export const INQUIRY_FINAL_CRITERIA = {
  frozenBeforeExecution: '2026-10-14',
  retrieval: { hitAt5: 0.95, recallAt5: 0.9 },
  protection: { secretSourcesReturned: 0, rawContactLeaks: 0 },
  scope: 'Small synthetic retrieval validation. Final answer evaluation and human review remain separate.',
};

interface Topic {
  title: string;
  content: string;
  answer: string;
  query: string;
  absent: string;
  facts: string[];
  mockTerms: string[];
}
const improvementTopics: readonly Topic[] = [
  { title: '빨래하면 길이가 짧아지나요?', content: '한 번 세탁했더니 옷자락이 올라갔습니다. 교환 가능한가요?',
    answer: '건조기 사용은 피해주세요. 세탁 후 수축 문제가 있으면 교환 접수를 도와드립니다.', query: '세탁 후 옷이 수축한 문의와 교환 안내',
    absent: '자동으로 세탁 온도를 조절하는 기능', facts: ['세탁', '교환'], mockTerms: ['세탁', '수축', '건조기', '옷자락'] },
  { title: '물이 들어간 신발을 바꿀 수 있나요?', content: '비 오는 날 양말까지 젖었습니다. 방수에 문제가 있는지 궁금합니다.',
    answer: '방수 제품이 아니므로 빗물 유입이 가능합니다. 젖은 신발을 말린 후 상태를 확인해주세요.', query: '빗물이 신발 안으로 들어온 문의와 방수 답변',
    absent: '자동으로 신발끈을 묶는 기능', facts: ['방수', '빗물'], mockTerms: ['빗물', '방수', '양말', '신발'] },
  { title: '충전해도 금방 전원이 꺼집니다', content: '완전히 충전하고 켰는데 한 시간 만에 멈췄습니다.',
    answer: '배터리 소모가 빠르면 충전기와 케이블을 확인한 뒤 점검을 신청해주세요.', query: '전원이 오래 유지되지 않는 문의와 배터리 점검 안내',
    absent: '기계가 스스로 먼지를 비우는 기능', facts: ['배터리', '점검'], mockTerms: ['배터리', '충전', '전원', '케이블'] },
];
const finalTopics: readonly Topic[] = [
  { title: '끈이 어깨를 눌러 아픈 가방 교환 문의', content: '짐을 넣고 메면 끈 자국이 남고 어깨가 아픕니다. 바꿀 수 있나요?',
    answer: '끈 길이를 조절해도 압박이 계속되면 교환 접수를 도와드립니다.', query: '가방 끈 압박으로 어깨가 아프다는 문의와 교환 답변',
    absent: '가방이 자동으로 짐 무게를 기록하는 기능', facts: ['어깨', '교환'], mockTerms: ['어깨', '가방', '압박', '끈'] },
  { title: '커튼 뒤 사람이 보이는 문제', content: '햇빛이 비치면 밖에서 사람 윤곽이 보입니다. 가림막으로 충분한가요?',
    answer: '이 제품은 완전한 암막 커튼이 아닙니다. 사생활 보호가 필요하면 안감을 추가해주세요.', query: '빛이 통과해 사생활을 가리기 어렵다는 문의와 안감 안내',
    absent: '커튼이 자동으로 공기 질을 측정하는 기능', facts: ['암막', '안감'], mockTerms: ['커튼', '사생활', '암막', '안감', '윤곽'] },
  { title: '맞춰 둔 의자 높이가 내려갑니다', content: '높이를 올려도 앉아 있으면 조금씩 낮아집니다. 부품이 고장난 건가요?',
    answer: '좌석이 내려가는 경우 가스 실린더 점검이 필요합니다. 부품 교체를 접수해주세요.', query: '앉으면 좌석 높이가 유지되지 않는 문의와 부품 교체 안내',
    absent: '의자가 자동으로 수면 시간을 측정하는 기능', facts: ['실린더', '교체'], mockTerms: ['의자', '좌석', '높이', '실린더'] },
];

function corpus(topics: readonly Topic[], sourceBase: number, productBase: number): EvalInquiry[] {
  return topics.flatMap((topic, index) => Array.from({ length: 9 }, (_, slot): EvalInquiry => ({
    id: sourceBase + index * 10 + slot,
    productId: productBase + index,
    title: slot === 0 ? topic.title : slot === 1 ? '사용 중 생긴 문제' : slot === 2 ? '관리 방법을 알려주세요' : slot === 6 ? '연락처 fixture@example.com' : slot === 8 ? `PRIVATE_INQUIRY ${topic.title}` : `상품 ${productBase + index} 일반 문의`,
    content: slot === 0 ? '' : slot === 1 || slot === 8 ? topic.content : slot === 2 ? '제품을 안전하게 사용하는 방법이 궁금합니다.' : slot === 6 ? '문의 연락처 010-1234-5678입니다.'
      : slot === 3 ? `걱정했지만 ${topic.content} 같은 문제는 실제로 없었습니다.` : '색상과 포장 상태를 문의합니다.',
    answer: slot === 1 || slot === 2 || slot === 8 ? topic.answer : slot === 4 ? '색상은 상품 상세 페이지에서 확인해주세요.' : slot === 6 ? 'fixture-answer@example.com으로 연락해주세요.' : null,
    isSecret: slot === 8,
    status: [1, 2, 4, 8].includes(slot) ? 'answered' : 'waiting',
    createdAt: slot < 3 || slot === 8 ? '2026-10-02T09:00:00+09:00' : slot === 7 ? '2026-09-30T23:59:59+09:00' : '2026-10-12T09:00:00+09:00',
  })));
}
function cases(topics: readonly Topic[], sourceBase: number, productBase: number, prefix: string): InquiryEvalCase[] {
  return topics.flatMap((topic, index) => {
    const base = { query: topic.query, productId: productBase + index, startDate: '2026-10-01', endDate: '2026-10-13' };
    return [
      { ...base, caseId: `${prefix}-${index + 1}-all`, relevantIds: [sourceBase + index * 10, sourceBase + index * 10 + 1, sourceBase + index * 10 + 2],
        question: `상품 ${base.productId}의 2026년 10월 1일부터 13일까지 공개 문의에서 ${topic.query}를 찾아 ID와 원문을 인용해줘.`,
        reason: '제목만 있는 공개 문의, 문의 본문, 판매자 답변의 근거 세 건. 문제 없다는 반대 경험과 비밀 문의는 비관련.', answerFacts: topic.facts, noEvidence: false },
      { ...base, caseId: `${prefix}-${index + 1}-answered`, status: 'answered' as const, relevantIds: [sourceBase + index * 10 + 1, sourceBase + index * 10 + 2],
        question: `상품 ${base.productId}의 같은 기간 답변 완료된 공개 문의에서 ${topic.query}를 찾아줘.`,
        reason: '현재 상태가 answered인 공개 문의 본문·답변 두 건. 제목만 있는 미답변 문의는 상태 조건에서 제외.', answerFacts: topic.facts, noEvidence: false },
      { ...base, caseId: `${prefix}-${index + 1}-waiting`, status: 'waiting' as const, relevantIds: [sourceBase + index * 10],
        question: `상품 ${base.productId}의 같은 기간 답변 대기 중인 공개 문의에서 ${topic.query}를 찾아줘.`,
        reason: '제목만 있는 공개 미답변 문의 한 건. 반대 경험을 불만으로 사용하지 않는다.', answerFacts: [topic.facts[0]], noEvidence: false },
      { ...base, caseId: `${prefix}-${index + 1}-absent`, query: `${topic.absent}의 고장 문의`, relevantIds: [],
        question: `상품 ${base.productId}의 같은 기간 공개 문의에서 ${topic.absent}가 고장났다는 근거를 찾아줘.`,
        reason: '조건 범위의 모든 공개 문의에 해당 기능 고장 근거가 없다. 임계값 없는 검색 후보를 정답으로 확정하지 않는다.', answerFacts: [], noEvidence: true },
    ];
  });
}

export const improvementInquiries = corpus(improvementTopics, 3001, 301);
export const improvementInquiryCases = cases(improvementTopics, 3001, 301, 'inquiry-improve');
export const finalInquiries = corpus(finalTopics, 4001, 401);
export const finalInquiryCases = cases(finalTopics, 4001, 401, 'inquiry-final');

/** Deterministic topic vectors test pipeline behavior only; they do not measure real semantic quality. */
export function mockInquiryVector(input: string): number[] {
  const topics = [...improvementTopics, ...finalTopics];
  const vector = Array<number>(768).fill(0);
  const matched = topics.map((topic, index) => ({ index, count: topic.mockTerms.filter(term => input.includes(term)).length }))
    .filter(item => item.count > 0).sort((a, b) => b.count - a.count || a.index - b.index)[0];
  vector[matched?.index ?? 6] = 1;
  return vector;
}
