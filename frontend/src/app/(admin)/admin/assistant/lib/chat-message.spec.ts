import { applyStreamEvent, closeInterrupted, toolLabel, toolStatusText, type ChatMessage } from './chat-message';

const empty: ChatMessage = { role: 'assistant', content: '' };

describe('applyStreamEvent — 도구 진행 상태 전이', () => {
  it('tool → 실행 중으로 추가된다', () => {
    const m = applyStreamEvent(empty, { type: 'tool', name: 'get_sales_summary' });
    expect(m.tools).toEqual([{ name: 'get_sales_summary', status: 'running' }]);
  });

  it('tool 다음 text 가 오면 그 도구는 완료가 되고 텍스트가 이어 붙는다', () => {
    let m = applyStreamEvent(empty, { type: 'tool', name: 'get_sales_summary' });
    m = applyStreamEvent(m, { type: 'text', delta: '지난달 ' });
    m = applyStreamEvent(m, { type: 'text', delta: '매출은' });
    expect(m.tools).toEqual([{ name: 'get_sales_summary', status: 'done' }]);
    expect(m.content).toBe('지난달 매출은');
  });

  it('tool 다음 tool 이 오면 앞 도구는 완료, 새 도구가 실행 중(여러 줄)', () => {
    let m = applyStreamEvent(empty, { type: 'tool', name: 'get_sales_summary' });
    m = applyStreamEvent(m, { type: 'tool', name: 'get_order_stats' });
    expect(m.tools).toEqual([
      { name: 'get_sales_summary', status: 'done' },
      { name: 'get_order_stats', status: 'running' },
    ]);
  });

  it('텍스트 없이 done 이 와도 실행 중이던 도구가 완료로 닫힌다', () => {
    let m = applyStreamEvent(empty, { type: 'tool', name: 'get_product_info' });
    m = applyStreamEvent(m, { type: 'done' });
    expect(m.tools).toEqual([{ name: 'get_product_info', status: 'done' }]);
  });

  it('도구가 없는 답변은 tools 를 만들지 않는다', () => {
    let m = applyStreamEvent(empty, { type: 'text', delta: '안녕하세요' });
    m = applyStreamEvent(m, { type: 'done' });
    expect(m).toEqual({ role: 'assistant', content: '안녕하세요', tools: undefined });
  });

  it('원본 메시지를 바꾸지 않는다(불변)', () => {
    const before = applyStreamEvent(empty, { type: 'tool', name: 'get_sales_summary' });
    const snapshot = JSON.parse(JSON.stringify(before));
    applyStreamEvent(before, { type: 'text', delta: 'x' });
    expect(before).toEqual(snapshot);
  });
});

describe('closeInterrupted — done 없이 끝남', () => {
  it('사용자 중지: 실행 중 도구는 중단, 부분 답변은 유지하고 stopped 표시', () => {
    let m = applyStreamEvent(empty, { type: 'tool', name: 'get_sales_summary' });
    m = applyStreamEvent(m, { type: 'text', delta: '6월 매출은' });
    m = applyStreamEvent(m, { type: 'tool', name: 'get_order_stats' });
    m = closeInterrupted(m, true);
    expect(m).toEqual({
      role: 'assistant',
      content: '6월 매출은',
      tools: [
        { name: 'get_sales_summary', status: 'done' },
        { name: 'get_order_stats', status: 'stopped' },
      ],
      stopped: true,
    });
  });

  it('오류로 끝남: 실행 중 도구만 중단으로 닫고 stopped 표시는 달지 않는다', () => {
    let m = applyStreamEvent(empty, { type: 'tool', name: 'summarize_reviews' });
    m = closeInterrupted(m, false);
    expect(m.tools).toEqual([{ name: 'summarize_reviews', status: 'stopped' }]);
    expect(m.stopped).toBeUndefined();
  });

  it('바꿀 것이 없으면 같은 객체를 돌려준다', () => {
    const m: ChatMessage = { role: 'assistant', content: '완성된 답변' };
    expect(closeInterrupted(m, false)).toBe(m);
  });
});

describe('toolLabel / toolStatusText — 이름 → 문구', () => {
  it.each([
    ['get_sales_summary', '매출 데이터'],
    ['get_order_stats', '주문 통계'],
    ['query_audit_logs', '감사 로그'],
    ['get_product_info', '상품 정보'],
    ['summarize_reviews', '리뷰'],
    ['summarize_inquiries', '고객 문의'],
  ])('%s → %s', (name, label) => {
    expect(toolLabel(name)).toBe(label);
  });

  it('모르는 도구 이름은 기본 문구', () => {
    expect(toolLabel('some_future_tool')).toBe('데이터');
    expect(toolStatusText({ name: 'some_future_tool', status: 'running' })).toBe('데이터 조회 중');
  });

  it('상태별 문구', () => {
    expect(toolStatusText({ name: 'get_sales_summary', status: 'running' })).toBe('매출 데이터 조회 중');
    expect(toolStatusText({ name: 'get_sales_summary', status: 'done' })).toBe('매출 데이터 조회 완료');
    expect(toolStatusText({ name: 'get_sales_summary', status: 'stopped' })).toBe('매출 데이터 조회 중단');
  });
});
