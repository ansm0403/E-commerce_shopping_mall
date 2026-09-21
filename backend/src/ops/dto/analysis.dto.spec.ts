import { parseAnalysis } from './analysis.dto';

/** 모델이 스키마를 지켰을 때의 정답 예시 */
const VALID = {
  severity: 'high',
  rootCause: 'axios 인스턴스가 401 을 받은 뒤 refresh 없이 곧바로 실패했다.',
  suggestedFix: '응답 인터셉터에서 refresh 를 1회 시도한다:\n```ts\nif (status === 401 && !config._retried) { ... }\n```',
  relatedFiles: ['src/lib/api.ts', 'src/contexts/AuthContext.tsx'],
  confidence: 'medium',
};

describe('parseAnalysis — AI 응답 스키마 검증(설계 §3.4 방어 처리)', () => {
  it('정확한 JSON 객체는 그대로 통과한다', () => {
    const r = parseAnalysis(JSON.stringify(VALID));
    expect(r).toEqual({ ok: true, value: VALID });
  });

  it('코드펜스(```json … ```)에 싸여 와도 벗겨서 읽는다 — 지시해도 모델이 자주 붙인다', () => {
    const r = parseAnalysis('```json\n' + JSON.stringify(VALID) + '\n```');
    expect(r.ok).toBe(true);
  });

  it('JSON 앞뒤에 잡담이 붙어도 첫 { 부터 마지막 } 까지를 읽는다', () => {
    const r = parseAnalysis('분석 결과입니다.\n' + JSON.stringify(VALID) + '\n도움이 되길 바랍니다.');
    expect(r.ok).toBe(true);
  });

  it('severity·confidence 의 대소문자·공백은 정규화한다(재호출로 쿼터를 쓰지 않는다)', () => {
    const r = parseAnalysis(JSON.stringify({ ...VALID, severity: ' HIGH ', confidence: 'Low' }));
    expect(r).toEqual({ ok: true, value: { ...VALID, severity: 'high', confidence: 'low' } });
  });

  it('relatedFiles 는 optional 취급 — 없거나 형식이 틀리면 빈 배열, 문자열 아닌 항목·중복은 걸러낸다', () => {
    const { relatedFiles: _omit, ...withoutFiles } = VALID;
    expect(parseAnalysis(JSON.stringify(withoutFiles))).toEqual({
      ok: true,
      value: { ...VALID, relatedFiles: [] },
    });
    expect(parseAnalysis(JSON.stringify({ ...VALID, relatedFiles: 'src/a.ts' }))).toMatchObject({
      ok: true,
      value: { relatedFiles: [] },
    });
    const r = parseAnalysis(
      JSON.stringify({ ...VALID, relatedFiles: ['src/a.ts', 42, ' src/a.ts ', '', null, 'src/b.ts'] }),
    );
    expect(r).toMatchObject({ ok: true, value: { relatedFiles: ['src/a.ts', 'src/b.ts'] } });
  });

  it.each([
    ['빈 문자열', '', 'JSON 객체를 찾을 수 없다'],
    ['산문만', '원인은 네트워크 오류로 보입니다. 재시도를 권장합니다.', 'JSON 객체를 찾을 수 없다'],
    ['닫히지 않은 JSON', '{"severity": "high", "rootCause": ', 'JSON 객체를 찾을 수 없다'],
    ['문법이 깨진 JSON', '{"severity": "high", "rootCause": }', 'JSON 파싱 실패'],
    ['severity 범위 밖', JSON.stringify({ ...VALID, severity: 'urgent' }), 'severity'],
    ['confidence 누락', JSON.stringify({ ...VALID, confidence: undefined }), 'confidence'],
    ['rootCause 빈 문자열', JSON.stringify({ ...VALID, rootCause: '   ' }), 'rootCause'],
    ['suggestedFix 가 문자열 아님', JSON.stringify({ ...VALID, suggestedFix: ['a'] }), 'suggestedFix'],
  ])('실패: %s → ok=false 와 사유(재시도 프롬프트에 실린다)', (_name, text, reasonPart) => {
    const r = parseAnalysis(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reasonPart);
  });

  it('객체를 배열로 감싸 보내도 안의 객체를 읽는다 — 첫 { 부터 마지막 } 까지 자르는 관대함의 부수 효과', () => {
    expect(parseAnalysis(JSON.stringify([VALID]))).toEqual({ ok: true, value: VALID });
  });

  it('본문 필드는 4,000자에서 자른다 — 장황한 응답이 DB·화면을 넘치지 않게', () => {
    const r = parseAnalysis(JSON.stringify({ ...VALID, rootCause: 'x'.repeat(10_000) }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rootCause).toHaveLength(4_000);
  });
});
