import { nextAnnouncement, toSpeechText } from './announcement';
import type { ChatMessage } from './chat-message';

const assistant = (over: Partial<ChatMessage> = {}): ChatMessage => ({ role: 'assistant', content: '', ...over });

describe('nextAnnouncement — 상태만 실시간, 본문은 완성 후 1회', () => {
  it('전송 직후: "응답 생성 중"', () => {
    expect(nextAnnouncement(false, true, assistant())).toBe('응답 생성 중');
  });

  it('도구 실행 중: 도구 문구', () => {
    const m = assistant({ tools: [{ name: 'get_sales_summary', status: 'running' }] });
    expect(nextAnnouncement(true, true, m)).toBe('매출 데이터 조회 중');
  });

  it('도구가 연달아 돌면 지금 실행 중인 것을 알린다', () => {
    const m = assistant({
      tools: [
        { name: 'get_sales_summary', status: 'done' },
        { name: 'get_order_stats', status: 'running' },
      ],
    });
    expect(nextAnnouncement(true, true, m)).toBe('주문 통계 조회 중');
  });

  it('답변이 흘러나오는 동안에는 문구를 바꾸지 않는다(조각 읽기 방지)', () => {
    const m = assistant({ content: '지난달 매출은', tools: [{ name: 'get_sales_summary', status: 'done' }] });
    expect(nextAnnouncement(true, true, m)).toBeNull();
    expect(nextAnnouncement(true, true, { ...m, content: '지난달 매출은 3,240,000원' })).toBeNull();
  });

  it('완료: "응답 완료" 뒤에 본문을 한 번(마크다운 기호 없이)', () => {
    const m = assistant({ content: '지난달 매출은 **3,240,000원**입니다.' });
    expect(nextAnnouncement(true, false, m)).toBe('응답 완료. 지난달 매출은 3,240,000원입니다.');
  });

  it('중지: 본문을 읽지 않고 중지했다고만 알린다', () => {
    const m = assistant({ content: '지난달 매출은', stopped: true });
    expect(nextAnnouncement(true, false, m)).toBe('응답을 중지했습니다.');
  });

  it('오류로 끝나 본문이 없으면 알리지 않는다(오류 문구는 role=alert 가 맡는다)', () => {
    expect(nextAnnouncement(true, false, assistant())).toBeNull();
  });

  it('진행한 적이 없으면 알리지 않는다 — 새로고침으로 복원된 대화를 읽어 대지 않는다', () => {
    expect(nextAnnouncement(false, false, assistant({ content: '복원된 답변' }))).toBeNull();
    expect(nextAnnouncement(false, false, undefined)).toBeNull();
  });
});

describe('toSpeechText — 마크다운 기호 없이 읽을 글자', () => {
  it('굵게·기울임·코드·제목 기호를 걷어 낸다', () => {
    expect(toSpeechText('## 9월 매출 요약\n\n총 매출은 **18,560,700원**, `get_sales_summary` 기준 *173건*')).toBe(
      '9월 매출 요약 총 매출은 18,560,700원, get_sales_summary 기준 173건',
    );
  });

  it('표는 구분선을 빼고 칸을 쉼표로 이어 읽는다', () => {
    const table = ['| 상태 | 주문 건수 |', '| :--- | :---: |', '| 결제 완료 | 39 |', '| **합계** | **232** |'].join('\n');
    expect(toSpeechText(table)).toBe('상태, 주문 건수 결제 완료, 39 합계, 232');
  });

  it('목록·체크리스트·인용 표시를 걷어 낸다', () => {
    expect(toSpeechText('- 배송 지연\n* 사이즈 불만\n1. 첫째\n- [x] 완료한 일\n> 참고')).toBe(
      '배송 지연 사이즈 불만 1. 첫째 완료한 일 참고',
    );
  });

  it('링크는 글자만, 이미지는 대체 텍스트만 남긴다(주소를 읽지 않는다)', () => {
    expect(toSpeechText('[보고서](https://example.com/r) ![차트](https://example.com/c.png)')).toBe('보고서 차트');
  });

  it('수평선·빈 줄은 건너뛴다', () => {
    expect(toSpeechText('위\n\n---\n\n아래')).toBe('위 아래');
  });
});
