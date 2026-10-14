import type { EvalInquiry } from './search-eval-environment';
import type { InquiryEvalCase } from './inquiry-fixture';
import { INQUIRY_ANSWER_FINAL_CRITERIA } from './inquiry-final-fixture';

/** V1 supplied remediation examples; this disjoint corpus is frozen before any v2 live run. */
export const INQUIRY_ANSWER_FINAL_V2_VERSION = 'inquiries-answer-final-v2';
export const INQUIRY_ANSWER_FINAL_V2_CRITERIA = Object.freeze({ ...INQUIRY_ANSWER_FINAL_CRITERIA,
  reason: 'New products, inquiry IDs and topics after v1 diagnostics. Waiting questions ask the problem only; answered questions ask actual seller guidance. Do not combine v1 and v2 quality scores.' });
const topics = [
  ['머그 손잡이에 금이 갔어요', '손잡이에 실금이 보여 들고 마시기 불안합니다.', '금이 간 머그는 사용을 중단하고 사진을 보내 교환을 접수해주세요.', '머그 손잡이가 갈라졌다는 내용', '갈라진 머그의 교환 접수 안내', '머그 안에 벌레가 있었다'],
  ['헤드폰 한쪽에서만 소리가 나요', '오른쪽에서는 들리지만 왼쪽에서는 아무 소리가 들리지 않습니다.', '연결 단자를 다시 끼우고 다른 기기에서 시험해주세요. 한쪽 무음이 계속되면 점검을 신청해주세요.', '헤드폰 한쪽 소리가 나오지 않는 내용', '한쪽 무음의 연결 확인과 점검 안내', '헤드폰에서 연기가 났다'],
  ['수건에서 보풀이 계속 떨어져요', '몸을 닦으면 작은 섬유 조각이 피부에 붙습니다.', '처음에는 수건만 단독 세탁하고 섬유유연제를 줄여주세요.', '수건 섬유가 떨어져 몸에 붙는 내용', '수건의 보풀을 줄이는 세탁 안내', '수건에 기름 얼룩이 있었다'],
  ['냄비 바닥이 눌어붙어 닦이지 않아요', '음식이 타서 붙었는데 물로 씻어도 검은 자국이 남습니다.', '미지근한 물에 불린 뒤 부드러운 수세미로 닦아주세요. 금속 수세미는 피해주세요.', '냄비 바닥에 탄 음식이 달라붙는 내용', '눌어붙은 냄비를 불려 닦는 안내', '냄비 손잡이가 부러졌다'],
  ['저울 표시 숫자가 일부 보이지 않아요', '화면 숫자의 가운데 획이 사라져 무게를 읽기 어렵습니다.', '배터리를 교체하고 표시가 계속 빠지면 화면 점검을 신청해주세요.', '저울 화면 숫자가 제대로 표시되지 않는 내용', '저울 화면의 배터리 교체와 점검 안내', '저울에서 날카로운 파편이 떨어졌다'],
  ['접착테이프가 붙인 뒤 금방 떨어져요', '벽에 붙였는데 얼마 지나지 않아 접착한 부분이 벌어집니다.', '표면의 먼지와 물기를 제거하고 충분히 눌러 붙여주세요.', '테이프의 접착이 오래 유지되지 않는 내용', '테이프를 붙이기 전 표면 관리 안내', '테이프에서 벌레가 나왔다'],
  ['요가 블록 모서리가 부스러져요', '잡고 운동하면 가장자리의 작은 조각이 떨어집니다.', '손상된 블록은 사용을 멈추고 사진을 첨부해 교환을 문의해주세요.', '요가 블록 가장자리가 부서지는 내용', '손상된 요가 블록 교환 문의 안내', '요가 블록에 곰팡이가 폈다'],
  ['빗의 이가 쉽게 빠져요', '머리를 빗을 때 빗살 두 개가 떨어져 나왔습니다.', '빠진 빗살 사진과 제품 번호를 보내주시면 점검을 도와드립니다.', '빗살이 떨어져 나오는 내용', '빠진 빗살의 사진과 제품 번호 확인 안내', '빗에서 금속 가루가 떨어졌다'],
  ['냉동 보관 봉투 입구가 닫히지 않아요', '입구를 눌러도 서로 맞물리지 않아 내용물이 새어 나옵니다.', '입구 홈의 이물질을 제거하고 평평하게 맞춰 눌러주세요.', '보관 봉투 입구가 잠기지 않는 내용', '보관 봉투 입구의 이물질 제거 안내', '보관 봉투 안에 유리 조각이 있었다'],
  ['키보드 같은 글자가 두 번 입력돼요', '키를 한 번 눌렀는데 화면에 같은 글자가 두 개씩 나타납니다.', '키 반복 설정을 확인하고 다른 기기에서도 반복되면 점검을 신청해주세요.', '키를 한 번 눌러도 중복 입력되는 내용', '키 반복 설정 확인과 점검 안내', '키보드에서 연기가 났다'],
] as const;

const sources: EvalInquiry[] = topics.flatMap(([title, body, answer, , , absent], index) => {
  const id = 7001 + index * 10; const common = { productId: 701 + index, isSecret: false, createdAt: '2026-10-02T10:00:00+09:00' };
  return [
    { ...common, id, title, content: '', answer: null, status: 'waiting' },
    { ...common, id: id + 1, title: '사용 중 생긴 문제', content: `${body} fixture@example.com, 010-1234-5678입니다.`, answer: `${answer} fixture-answer@example.com입니다.`, status: 'answered' },
    { ...common, id: id + 2, title: '판매자 관리 안내', content: '', answer, status: 'answered' },
    { ...common, id: id + 3, title: '문제 없이 사용했습니다', content: `걱정했지만 '${body}' 같은 문제는 실제로 겪지 않았습니다. 정상적으로 사용 중입니다.`, answer: null, status: 'waiting' },
    { ...common, id: id + 4, title: '색상 선택 문의', content: '같은 제품의 다른 색상을 선택할 수 있나요?', answer: null, status: 'waiting' },
    { ...common, id: id + 5, title: '기간 밖의 별도 불만', content: `${absent}는 문제를 겪었습니다.`, answer: null, status: 'waiting', createdAt: '2026-10-13T00:00:00+09:00' },
    { ...common, id: id + 6, title: 'PRIVATE_INQUIRY 별도 불만', content: `${absent}는 문제를 비공개로 상담합니다.`, answer: null, status: 'waiting', isSecret: true },
    { ...common, id: id + 7, title: '사용 중 생긴 문제', content: `${body} fixture@example.com, 010-1234-5678입니다.`, answer: `${answer} fixture-answer@example.com입니다.`, status: 'answered', createdAt: '2026-10-13T00:00:00+09:00' },
    { ...common, id: id + 8, title: `PRIVATE_INQUIRY ${title}`, content: body, answer, status: 'answered', isSecret: true },
  ] as EvalInquiry[];
});
const cases: InquiryEvalCase[] = topics.flatMap(([, , , problem, guidance, absent], index) => {
  const id = 7001 + index * 10, productId = 701 + index;
  const period = { startDate: '2026-10-01', endDate: '2026-10-12' }; const fullPeriod = [3, 8].includes(index), waiting = [2, 5, 8].includes(index);
  return [
    { productId, ...(fullPeriod ? {} : period), caseId: `inquiry-answer-v2-${index + 1}-meaning`, query: `${problem}과 ${guidance}`,
      question: `상품 ${productId}의 ${fullPeriod ? '전체 기간' : '2026-10-01부터 2026-10-12까지'} 공개 문의에서 ${problem}이나 ${guidance}를 의미 검색으로 찾아줘. 문의 ID와 실제 원문을 인용해줘.${fullPeriod ? ' 기간 제한을 추가하지 말아줘.' : ''}`,
      relevantIds: fullPeriod ? [id, id + 1, id + 2, id + 7] : [id, id + 1, id + 2], answerFacts: [], noEvidence: false,
      reason: '제목·고객 본문·판매자 답변 중 실제 관련 근거를 인용한다. 문제 없음은 불만으로 해석하지 않고 원문에 없는 작성 의도를 추가하지 않는다.' },
    { productId, ...period, caseId: `inquiry-answer-v2-${index + 1}-status`, status: waiting ? 'waiting' : 'answered', query: waiting ? problem : guidance,
      question: `상품 ${productId}의 2026-10-01부터 2026-10-12까지 ${waiting ? '답변 대기 중인' : '답변 완료된'} 공개 문의에서 ${waiting ? problem : guidance}를 의미 검색으로 찾아줘. 문의 ID와 ${waiting ? '문의 제목 원문' : '판매자 답변 원문'}을 인용해줘.`,
      relevantIds: waiting ? [id] : [id + 1, id + 2], answerFacts: [], noEvidence: false,
      reason: waiting ? '제목만 있는 미답변 문의가 근거다. 없는 본문·답변을 만들지 않는다. 이 질문은 판매자 안내까지 동시에 요구하지 않는다.' : '판매자 답변이 실제로 있으면 고객 본문이 비어 있어도 안내 근거다. 미답변·기간 밖·비밀 문의는 제외한다.' },
    { productId, ...period, caseId: `inquiry-answer-v2-${index + 1}-absent`, query: `${absent}는 불만`,
      question: `상품 ${productId}의 2026-10-01부터 2026-10-12까지 공개 문의에서 ${absent}는 불만을 의미 검색으로 찾아줘. 문의 ID와 원문을 인용해줘.`,
      relevantIds: [], answerFacts: [], noEvidence: true, reason: '해당 불만은 기간 밖 공개 문의와 비밀 문의에만 있다. 기간 안의 다른 후보를 해당 불만으로 인용하지 않는다.' },
  ];
});
export const inquiryAnswerV2Sources = Object.freeze(sources.map(source => Object.freeze(source)));
export const inquiryAnswerV2Cases = Object.freeze(cases.map(item => { Object.freeze(item.relevantIds); Object.freeze(item.answerFacts); return Object.freeze(item); }));
