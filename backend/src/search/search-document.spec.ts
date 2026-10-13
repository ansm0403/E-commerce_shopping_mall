import { inquiryDocument, queryInput, reviewDocument } from './search-document';
import { INITIAL_SEARCH_PROFILE as PROFILE, searchFlags } from './search-profile';

describe('search preprocessing', () => {
  it('masks contacts before hashing and embedding, retaining negation and punctuation', () => {
    const doc = reviewDocument('  작을까 걱정했는데 잘 맞아요!\r\n연락: buyer@test.local / +82 10 9876 5432  ');
    expect(doc.text).toBe('작을까 걱정했는데 잘 맞아요!\n연락: b***@*** / ***');
    expect(doc.chunks[0].input).toBe(`title: none | text: ${doc.text}`);
    expect(doc.contentHash).toBe(reviewDocument(doc.text).contentHash);
  });

  it('keeps empty documents at zero chunks, including inquiry with all fields blank', () => {
    expect(reviewDocument(' \r\n ').chunks).toEqual([]);
    expect(inquiryDocument({ title: ' ', content: '', answer: null, isSecret: false })?.chunks).toEqual([]);
    expect(inquiryDocument({ title: '제목만', content: '', answer: null, isSecret: false })?.chunks).toHaveLength(1);
  });

  it('never prepares a secret inquiry for external transmission', () => {
    expect(inquiryDocument({ title: '비밀', content: '고객 원문', answer: '답변', isSecret: true })).toBeNull();
  });

  it('hashes inquiry title and answer changes and labels their text separately', () => {
    const source = { title: '배송', content: '언제 오나요?', answer: '내일', isSecret: false };
    const doc = inquiryDocument(source);
    if (!doc) throw new Error('Expected a public document');
    expect(doc.text).toBe('[문의 본문]\n언제 오나요?\n\n[답변]\n내일');
    expect(doc.contentHash).not.toBe(inquiryDocument({ ...source, title: '출고' })?.contentHash);
    expect(doc.contentHash).not.toBe(inquiryDocument({ ...source, answer: '모레' })?.contentHash);
  });

  it('splits Korean and emoji without splitting surrogate pairs or losing source text', () => {
    const text = '😀한글'.repeat(700);
    const doc = reviewDocument(text);
    expect(doc.chunks.length).toBeGreaterThan(1);
    for (const chunk of doc.chunks) {
      expect(Array.from(chunk.text).length).toBeLessThanOrEqual(1000);
      expect(Buffer.byteLength(chunk.input, 'utf8')).toBeLessThanOrEqual(4096);
      expect(chunk.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    const reconstructed = doc.chunks.map((chunk, i) => Array.from(chunk.text).slice(i ? 100 : 0).join('')).join('');
    expect(reconstructed).toBe(text);
  });

  it('accounts for title bytes when splitting and terminates on frequent paragraph boundaries', () => {
    const doc = inquiryDocument({ title: '가'.repeat(200), content: '문단입니다.\n\n'.repeat(300), answer: null, isSecret: false });
    if (!doc) throw new Error('Expected a public document');
    expect(doc.chunks.length).toBeLessThan(32);
    expect(doc.chunks.every(chunk => Buffer.byteLength(chunk.input) <= PROFILE.maxInputBytes)).toBe(true);
  });

  it('rejects oversized sources and invalid queries instead of silently truncating', () => {
    expect(() => reviewDocument('가'.repeat(40000))).toThrow('SOURCE_TOO_LARGE');
    expect(() => queryInput('   ')).toThrow('INVALID_INPUT');
    expect(() => queryInput('가'.repeat(1001))).toThrow('INVALID_INPUT');
    expect(queryInput('전화 010-1234-5678')).toBe('task: search result | query: 전화 ***');
  });

  it('starts all capabilities disabled and uses explicit string activation', () => {
    expect(Object.values(searchFlags(() => undefined))).toEqual([false, false, false, false]);
    expect(searchFlags(() => true).reviews).toBe(false);
    expect(searchFlags(() => 'true').reviews).toBe(true);
  });

  it('accepts exactly 32 full ASCII chunks and rejects the next character', () => {
    const limit = PROFILE.maxCodePoints + (PROFILE.maxChunks - 1) * (PROFILE.maxCodePoints - PROFILE.overlapCodePoints);
    expect(reviewDocument('a'.repeat(limit)).chunks).toHaveLength(32);
    expect(() => reviewDocument('a'.repeat(limit + 1))).toThrow('SOURCE_TOO_LARGE');
  });

  it('measures query length by Unicode code points at the exact boundary', () => {
    expect(queryInput('😀'.repeat(1000))).toBe(`task: search result | query: ${'😀'.repeat(1000)}`);
    expect(() => queryInput('😀'.repeat(1001))).toThrow('INVALID_INPUT');
  });

  it('keeps the full body when a long emoji title reduces the available byte budget', () => {
    const doc = inquiryDocument({ title: '😀'.repeat(200), content: '😀'.repeat(2000), answer: null, isSecret: false });
    if (!doc) throw new Error('public document');
    expect(doc.chunks.length).toBeGreaterThan(2);
    expect(doc.chunks.every(chunk => Buffer.byteLength(chunk.input) <= PROFILE.maxInputBytes)).toBe(true);
    expect(doc.chunks.map((chunk, index) => Array.from(chunk.text).slice(index ? 100 : 0).join('')).join('')).toBe(doc.text);
  });
});
