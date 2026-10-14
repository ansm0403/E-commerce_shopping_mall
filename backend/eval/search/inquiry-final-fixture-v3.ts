import type { EvalInquiry } from './search-eval-environment';
import type { InquiryEvalCase } from './inquiry-fixture';
import { INQUIRY_ANSWER_FINAL_CRITERIA } from './inquiry-final-fixture';

/**
 * V2 became diagnostic after its first live run (title-only waiting inquiries were demoted or dropped; 503s).
 * The answer rules and 5xx retry were changed after that. This disjoint corpus is frozen before any v3 live run:
 * new products, inquiry IDs and topics, and varied "or" connectives so a fix tuned to v2 wording is not rewarded.
 */
export const INQUIRY_ANSWER_FINAL_V3_VERSION = 'inquiries-answer-final-v3';
export const INQUIRY_ANSWER_FINAL_V3_CRITERIA = Object.freeze({ ...INQUIRY_ANSWER_FINAL_CRITERIA,
  reason: 'New products, inquiry IDs and topics after v2 diagnostics. Same structure as v2, varied or-connectives and placement. Do not combine v1, v2 and v3 quality scores.' });

// [title, body, seller answer, problem phrase, guidance phrase, absent complaint]
const topics = [
  ['우산 살이 휘어요', '바람이 조금만 불어도 우산 살 하나가 바깥으로 꺾입니다.', '꺾인 살은 억지로 펴지 말고 사진과 함께 수리를 접수해주세요.', '우산 살이 바람에 꺾이는 내용', '꺾인 우산 살의 수리 접수 안내', '우산 손잡이에서 녹물이 흘렀다'],
  ['텀블러 뚜껑에서 물이 새요', '가방에 넣으면 뚜껑 틈으로 음료가 흘러 가방이 젖습니다.', '뚜껑 안쪽 고무 패킹이 홈에 끝까지 끼워졌는지 확인해주세요.', '텀블러 뚜껑 틈으로 음료가 새는 내용', '뚜껑 고무 패킹 장착 확인 안내', '텀블러에서 플라스틱 냄새가 났다'],
  ['운동화 밑창이 떨어졌어요', '몇 번 신지 않았는데 앞코 부분 밑창이 들려 걸을 때 덜컥거립니다.', '들린 밑창 사진을 보내주시면 무상 수선을 안내해드립니다.', '운동화 밑창이 들뜨는 내용', '들뜬 밑창의 무상 수선 안내', '운동화 끈이 녹아 버렸다'],
  ['가습기에서 소리가 커요', '밤에 켜두면 물 끓는 듯한 소리가 계속 나서 잠들기 어렵습니다.', '물통을 끝까지 눌러 결합하고 평평한 곳에 두면 소음이 줄어듭니다.', '가습기 작동 소음이 큰 내용', '물통 결합과 설치 위치로 소음을 줄이는 안내', '가습기에서 불꽃이 튀었다'],
  ['이불 솜이 한쪽으로 몰려요', '세탁 후 안의 충전재가 아래쪽에 뭉쳐 위쪽이 얇아졌습니다.', '건조기 대신 그늘에서 말리며 중간중간 두드려 펴주세요.', '이불 충전재가 뭉치는 내용', '뭉친 충전재를 펴서 말리는 안내', '이불에서 바늘이 나왔다'],
  ['충전기를 꽂아도 충전이 안 돼요', '케이블을 연결해도 표시등이 켜지지 않고 배터리가 그대로입니다.', '다른 콘센트와 케이블로 시험하고 그래도 안 되면 교환을 신청해주세요.', '연결해도 충전되지 않는 내용', '다른 콘센트와 케이블로 시험한 뒤 교환을 신청하는 안내', '충전기가 녹아내렸다'],
  ['프라이팬 코팅이 벗겨져요', '몇 주 썼는데 바닥 코팅이 조각조각 일어납니다.', '금속 조리도구 대신 실리콘 도구를 쓰고 센 불을 피해주세요.', '프라이팬 코팅이 일어나는 내용', '실리콘 도구 사용과 불 세기 안내', '프라이팬에서 탄 냄새가 계속 났다'],
  ['화분 받침에 물이 넘쳐요', '물을 조금만 줘도 받침 밖으로 흘러 바닥이 젖습니다.', '물은 받침의 절반 정도만 주고 고인 물은 바로 비워주세요.', '화분 받침 밖으로 물이 넘치는 내용', '물 양 조절과 고인 물 비우기 안내', '화분이 저절로 갈라졌다'],
  ['블루투스 스피커 연결이 자꾸 끊겨요', '몇 분 간격으로 소리가 멈췄다가 다시 연결됩니다.', '기기와의 거리를 줄이고 다른 블루투스 기기의 연결을 해제해주세요.', '스피커 연결이 반복해서 끊기는 내용', '거리 조절과 다른 기기 연결 해제 안내', '스피커가 물에 젖어 고장 났다'],
  ['캐리어 바퀴가 덜컹거려요', '끌고 가면 바퀴 하나가 흔들리며 큰 소리가 납니다.', '바퀴 고정 나사를 조여 보시고 계속 흔들리면 바퀴 교체를 신청해주세요.', '캐리어 바퀴가 흔들리는 내용', '바퀴 나사 조임과 교체 신청 안내', '캐리어 지퍼가 뜯어졌다'],
] as const;

/** Korean object particle for the last syllable. */
const object = (phrase: string) => ((phrase.charCodeAt(phrase.length - 1) - 0xac00) % 28 ? `${phrase}을` : `${phrase}를`);
/** Rotate "or" connectives so the fix is not rewarded for matching v2's single "이나" wording. */
const either = (problem: string, guidance: string, index: number) =>
  [`${problem}이나 ${guidance}`, `${problem} 또는 ${guidance}`, `${problem} 혹은 ${guidance}`, `${problem}이거나 ${guidance}`][index % 4];

const sources: EvalInquiry[] = topics.flatMap(([title, body, answer, , , absent], index) => {
  const id = 8001 + index * 10; const common = { productId: 801 + index, isSecret: false, createdAt: '2026-10-03T11:00:00+09:00' };
  return [
    { ...common, id, title, content: '', answer: null, status: 'waiting' },
    { ...common, id: id + 1, title: '사용 중 생긴 문제', content: `${body} fixture@example.com, 010-1234-5678입니다.`, answer: `${answer} fixture-answer@example.com입니다.`, status: 'answered' },
    { ...common, id: id + 2, title: '판매자 관리 안내', content: '', answer, status: 'answered' },
    { ...common, id: id + 3, title: '문제 없이 사용했습니다', content: `걱정했지만 '${body}' 같은 문제는 실제로 겪지 않았습니다. 정상적으로 사용 중입니다.`, answer: null, status: 'waiting' },
    { ...common, id: id + 4, title: '배송 일정 문의', content: '주문한 제품이 언제 출고되는지 알 수 있을까요?', answer: null, status: 'waiting' },
    { ...common, id: id + 5, title: '기간 밖의 별도 불만', content: `${absent}는 문제를 겪었습니다.`, answer: null, status: 'waiting', createdAt: '2026-10-13T00:00:00+09:00' },
    { ...common, id: id + 6, title: 'PRIVATE_INQUIRY 별도 불만', content: `${absent}는 문제를 비공개로 상담합니다.`, answer: null, status: 'waiting', isSecret: true },
    { ...common, id: id + 7, title: '사용 중 생긴 문제', content: `${body} fixture@example.com, 010-1234-5678입니다.`, answer: `${answer} fixture-answer@example.com입니다.`, status: 'answered', createdAt: '2026-10-13T00:00:00+09:00' },
    { ...common, id: id + 8, title: `PRIVATE_INQUIRY ${title}`, content: body, answer, status: 'answered', isSecret: true },
  ] as EvalInquiry[];
});
const cases: InquiryEvalCase[] = topics.flatMap(([, , , problem, guidance, absent], index) => {
  const id = 8001 + index * 10, productId = 801 + index;
  const period = { startDate: '2026-10-01', endDate: '2026-10-12' }; const fullPeriod = [1, 6].includes(index), waiting = [0, 4, 7].includes(index);
  return [
    { productId, ...(fullPeriod ? {} : period), caseId: `inquiry-answer-v3-${index + 1}-meaning`, query: `${problem}과 ${guidance}`,
      question: `상품 ${productId}의 ${fullPeriod ? '전체 기간' : '2026-10-01부터 2026-10-12까지'} 공개 문의에서 ${object(either(problem, guidance, index))} 의미 검색으로 찾아줘. 문의 ID와 실제 원문을 인용해줘.${fullPeriod ? ' 기간 제한을 추가하지 말아줘.' : ''}`,
      relevantIds: fullPeriod ? [id, id + 1, id + 2, id + 7] : [id, id + 1, id + 2], answerFacts: [], noEvidence: false,
      reason: '제목·고객 본문·판매자 답변 중 실제 관련 근거를 모두 인용한다. 상태를 묻지 않았으므로 제목만 있는 미답변 문의도 같은 근거다. 문제 없음은 불만으로 해석하지 않고 원문에 없는 작성 의도를 추가하지 않는다.' },
    { productId, ...period, caseId: `inquiry-answer-v3-${index + 1}-status`, status: waiting ? 'waiting' : 'answered', query: waiting ? problem : guidance,
      question: `상품 ${productId}의 2026-10-01부터 2026-10-12까지 ${waiting ? '답변 대기 중인' : '답변 완료된'} 공개 문의에서 ${object(waiting ? problem : guidance)} 의미 검색으로 찾아줘. 문의 ID와 ${waiting ? '문의 제목 원문' : '판매자 답변 원문'}을 인용해줘.`,
      relevantIds: waiting ? [id] : [id + 1, id + 2], answerFacts: [], noEvidence: false,
      reason: waiting ? '제목만 있는 미답변 문의가 근거다. 없는 본문·답변을 만들지 않는다. 이 질문은 판매자 안내까지 동시에 요구하지 않는다.' : '판매자 답변이 실제로 있으면 고객 본문이 비어 있어도 안내 근거다. 미답변·기간 밖·비밀 문의는 제외한다.' },
    { productId, ...period, caseId: `inquiry-answer-v3-${index + 1}-absent`, query: `${absent}는 불만`,
      question: `상품 ${productId}의 2026-10-01부터 2026-10-12까지 공개 문의에서 ${absent}는 불만을 의미 검색으로 찾아줘. 문의 ID와 원문을 인용해줘.`,
      relevantIds: [], answerFacts: [], noEvidence: true, reason: '해당 불만은 기간 밖 공개 문의와 비밀 문의에만 있다. 기간 안의 다른 후보를 해당 불만으로 인용하지 않는다.' },
  ];
});
export const inquiryAnswerV3Sources = Object.freeze(sources.map(source => Object.freeze(source)));
export const inquiryAnswerV3Cases = Object.freeze(cases.map(item => { Object.freeze(item.relevantIds); Object.freeze(item.answerFacts); return Object.freeze(item); }));
