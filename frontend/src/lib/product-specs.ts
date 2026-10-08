const labels: Record<string, string> = {
  color: '색상', material: '소재', size: '사이즈', dimensions: '크기',
  gender: '성별', season: '계절', style: '스타일', madeIn: '제조국',
  origin: '원산지', skinType: '피부 타입', volume: '용량', weight: '중량',
  nutrition: '영양 정보', usage: '용도', capacity: '용량', author: '저자',
  genre: '장르', publisher: '출판사', pages: '쪽수', publicationDate: '출간일',
  calories: '열량', protein: '단백질', fat: '지방', carbohydrates: '탄수화물',
  sodium: '나트륨', sugar: '당류',
};

const codes: Record<string, Record<string, string>> = {
  gender: { UNISEX: '공용', MALE: '남성', FEMALE: '여성', MEN: '남성', WOMEN: '여성' },
  season: { SPRING: '봄', SUMMER: '여름', FALL: '가을', AUTUMN: '가을', WINTER: '겨울', ALL: '사계절' },
  skinType: { DRY: '건성', OILY: '지성', COMBINATION: '복합성', SENSITIVE: '민감성', ALL: '모든 피부' },
};

export function specLabel(key: string): string {
  return labels[key] ?? key;
}

export function specValue(key: string, value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.map((item) => specValue(key, item)).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value).map(([field, item]) => `${specLabel(field)} ${specValue(field, item)}`).join(' · ');
  }
  if (typeof value === 'boolean') return value ? '예' : '아니요';
  if (typeof value === 'number') {
    const unit = { volume: 'ml', weight: 'g', pages: '쪽' }[key];
    return `${value.toLocaleString('ko-KR')}${unit ? ` ${unit}` : ''}`;
  }
  return codes[key]?.[String(value)] ?? String(value);
}
