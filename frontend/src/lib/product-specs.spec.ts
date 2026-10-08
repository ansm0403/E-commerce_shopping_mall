import { specLabel, specValue } from './product-specs';

describe('상품 스펙 표시', () => {
  it('코드를 필드별로 번역하고 알 수 없는 값은 보존한다', () => {
    expect(specValue('skinType', 'ALL')).toBe('모든 피부');
    expect(specValue('season', 'ALL')).toBe('사계절');
    expect(specValue('gender', 'UNISEX')).toBe('공용');
    expect(specValue('size', 'L')).toBe('L');
    expect(specLabel('customField')).toBe('customField');
  });
  it('숫자에 단위를 붙이고 이미 단위가 있는 문자열은 보존한다', () => {
    expect(specValue('volume', 50)).toBe('50 ml');
    expect(specValue('volume', '50ml')).toBe('50ml');
    expect(specValue('pages', 1200)).toBe('1,200 쪽');
    expect(specValue('size', 270)).toBe('270');
  });
  it('중첩 정보와 배열, 빈 값을 표시한다', () => {
    expect(specValue('nutrition', { calories: '120kcal', protein: '3g' })).toBe('열량 120kcal · 단백질 3g');
    expect(specValue('color', ['블랙', '화이트'])).toBe('블랙, 화이트');
    expect(specValue('material', null)).toBe('—');
  });
});
