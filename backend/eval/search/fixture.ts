/** Synthetic improvement-only data. Never use these questions as the final evaluation. */
export const SEARCH_FIXTURE_VERSION = 'reviews-improvement-v1';
const topics = [
  ['팔 부분이 꽉 끼고 움직이기 어려워요.', '팔을 움직이기 어려울 만큼 옷이 조이는 불만'],
  ['한 번 세탁하니 길이가 줄어 버렸어요.', '빨래 후 옷이 수축했다는 반응'],
  ['봉제선이 피부를 계속 긁어서 따가워요.', '솔기가 피부를 자극한다는 불만'],
  ['비 오는 날 신었더니 양말까지 젖었어요.', '신발 안으로 물이 들어온 경험'],
  ['오래 걸으니 뒤꿈치에 물집이 생겨요.', '걸을 때 발뒤꿈치가 쓸린다는 불만'],
  ['충전해도 한 시간 만에 전원이 꺼져요.', '배터리가 너무 빨리 소모된다는 반응'],
  ['작동할 때 소리가 커서 잠을 잘 수 없어요.', '기계 소음 때문에 수면을 방해받은 경험'],
  ['포장을 열자마자 깨진 조각이 나왔어요.', '제품이 파손된 상태로 도착했다는 불만'],
  ['발랐더니 얼굴이 붉어지고 따가웠어요.', '화장품 사용 후 피부가 자극된 경험'],
  ['뚜껑을 닫아도 가방 안으로 내용물이 새요.', '용기가 제대로 밀폐되지 않는다는 반응'],
] as const;

export const improvementReviews = topics.flatMap(([negative], index) =>
  Array.from({ length: 10 }, (_, slot) => ({
    id: index * 10 + slot + 1,
    productId: index + 1,
    rating: slot === 0 ? 5 : 4,
    comment: slot === 0 ? negative : slot === 1
      ? `걱정했는데 그런 문제 없이 잘 쓰고 있어요. ${index === 0 ? '작을까 걱정했는데 잘 맞아요.' : '전체적으로 만족합니다.'}`
      : `상품 ${index + 1}의 색상과 디자인이 마음에 들어요. 잘 사용하고 있습니다.`,
    createdAt: `2026-10-${slot === 0 ? '01' : '10'}T${String(slot).padStart(2, '0')}:00:00+09:00`,
  })),
);

export const improvementCases = topics.flatMap(([, query], index) => [
  { caseId: `improve-${index + 1}-explicit`, query, productId: index + 1, maxRating: null, relevantIds: [index * 10 + 1], reason: '직접 해당 문제를 서술한 원문. 높은 별점이어도 불만 근거.' },
  { caseId: `improve-${index + 1}-paraphrase`, query: `고객이 겪은 문제를 찾아줘: ${query}`, productId: index + 1, maxRating: null, relevantIds: [index * 10 + 1], reason: '동일 근거의 표현 변경 질문. 같은 개선용 그룹에만 보관.' },
]);
