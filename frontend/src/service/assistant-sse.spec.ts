import { parseSseChunk } from './assistant-sse';

type Ev = { type: string; delta?: string };

const frame = (ev: Ev) => `data: ${JSON.stringify(ev)}\n\n`;

describe('parseSseChunk — SSE data 프레임 파서', () => {
  it('한 청크에 프레임이 여러 개면 순서대로 모두 꺼낸다', () => {
    const { events, rest } = parseSseChunk<Ev>(
      frame({ type: 'meta' }) + frame({ type: 'text', delta: '안녕' }) + frame({ type: 'done' }),
    );
    expect(events.map((e) => e.type)).toEqual(['meta', 'text', 'done']);
    expect(rest).toBe('');
  });

  it('프레임 중간에서 잘린 청크는 rest 로 남기고, 다음 청크와 이어 붙이면 완성된다', () => {
    const whole = frame({ type: 'text', delta: '지난달 매출은' });
    const cut = 17; // JSON 문자열 한가운데

    const first = parseSseChunk<Ev>(whole.slice(0, cut));
    expect(first.events).toEqual([]);
    expect(first.rest).toBe(whole.slice(0, cut));

    const second = parseSseChunk<Ev>(first.rest + whole.slice(cut));
    expect(second.events).toEqual([{ type: 'text', delta: '지난달 매출은' }]);
    expect(second.rest).toBe('');
  });

  it('구분자(\\n\\n)가 두 청크에 나뉘어 와도 프레임을 한 번만 꺼낸다', () => {
    const whole = frame({ type: 'done' });
    const first = parseSseChunk<Ev>(whole.slice(0, -1)); // 마지막 \n 이 아직 안 옴
    expect(first.events).toEqual([]);

    const second = parseSseChunk<Ev>(first.rest + '\n');
    expect(second.events).toEqual([{ type: 'done' }]);
  });

  it('완성된 프레임 뒤에 잘린 프레임이 붙어 있으면 앞은 꺼내고 뒤는 rest 로', () => {
    const tail = 'data: {"type":"te';
    const { events, rest } = parseSseChunk<Ev>(frame({ type: 'meta' }) + tail);
    expect(events).toEqual([{ type: 'meta' }]);
    expect(rest).toBe(tail);
  });

  it('data: 줄이 없는 프레임(주석·keep-alive)은 건너뛴다', () => {
    const { events } = parseSseChunk<Ev>(': keep-alive\n\n' + 'event: ping\n\n' + frame({ type: 'done' }));
    expect(events).toEqual([{ type: 'done' }]);
  });

  it('data: 앞에 다른 필드가 있어도 data 줄을 찾는다', () => {
    const { events } = parseSseChunk<Ev>('event: message\ndata: {"type":"done"}\n\n');
    expect(events).toEqual([{ type: 'done' }]);
  });

  it('JSON 이 깨진 프레임은 건너뛰고 다음 프레임을 계속 읽는다', () => {
    const { events, rest } = parseSseChunk<Ev>(
      frame({ type: 'text', delta: 'a' }) + 'data: {"type":"text","delta":\n\n' + frame({ type: 'text', delta: 'b' }),
    );
    expect(events).toEqual([
      { type: 'text', delta: 'a' },
      { type: 'text', delta: 'b' },
    ]);
    expect(rest).toBe('');
  });

  it('data: 값이 비어 있으면 이벤트를 만들지 않는다', () => {
    expect(parseSseChunk<Ev>('data:\n\n').events).toEqual([]);
  });

  it('빈 버퍼는 그대로 돌려준다', () => {
    expect(parseSseChunk<Ev>('')).toEqual({ events: [], rest: '' });
  });
});
