import { createDeltaBatcher } from './delta-batcher';

/** 프레임을 손으로 넘기는 가짜 스케줄러 */
function fakeFrames() {
  let next = 1;
  const pending = new Map<number, () => void>();
  return {
    schedule: (run: () => void) => {
      const id = next++;
      pending.set(id, run);
      return id;
    },
    cancel: (id: number) => {
      pending.delete(id);
    },
    /** 예약된 프레임을 모두 실행 */
    tick: () => {
      const runs = [...pending.values()];
      pending.clear();
      runs.forEach((run) => run());
    },
    count: () => pending.size,
  };
}

function setup() {
  const frames = fakeFrames();
  const applied: string[] = [];
  const batcher = createDeltaBatcher((text) => applied.push(text), frames.schedule, frames.cancel);
  return { frames, applied, batcher };
}

describe('createDeltaBatcher — 프레임당 1회 반영', () => {
  it('한 프레임 안에 온 델타 여러 개는 합쳐서 한 번만 반영한다', () => {
    const { frames, applied, batcher } = setup();

    batcher.push('지난달 ');
    batcher.push('매출은 ');
    batcher.push('0원');
    expect(applied).toEqual([]); // 프레임 전에는 반영하지 않는다
    expect(frames.count()).toBe(1); // 예약은 하나뿐

    frames.tick();
    expect(applied).toEqual(['지난달 매출은 0원']);
  });

  it('프레임마다 따로 반영한다(다음 델타는 새 프레임을 예약)', () => {
    const { frames, applied, batcher } = setup();

    batcher.push('a');
    frames.tick();
    batcher.push('b');
    batcher.push('c');
    frames.tick();

    expect(applied).toEqual(['a', 'bc']);
  });

  it('flush 는 프레임을 기다리지 않고 즉시 반영하고, 예약된 프레임은 취소한다(중복 반영 없음)', () => {
    const { frames, applied, batcher } = setup();

    batcher.push('마지막 ');
    batcher.push('글자');
    batcher.flush(); // done·중지 직전

    expect(applied).toEqual(['마지막 글자']);
    expect(frames.count()).toBe(0);
    frames.tick();
    expect(applied).toEqual(['마지막 글자']);
  });

  it('버퍼가 비어 있으면 flush 는 아무것도 반영하지 않는다', () => {
    const { applied, batcher } = setup();
    batcher.flush();
    expect(applied).toEqual([]);
  });

  it('flush 뒤에도 다시 쓸 수 있다', () => {
    const { frames, applied, batcher } = setup();
    batcher.push('a');
    batcher.flush();
    batcher.push('b');
    frames.tick();
    expect(applied).toEqual(['a', 'b']);
  });

  it('cancel 은 예약과 버퍼를 버린다(언마운트 뒤 setState 방지)', () => {
    const { frames, applied, batcher } = setup();
    batcher.push('버려질 글자');
    batcher.cancel();
    frames.tick();
    batcher.flush();
    expect(applied).toEqual([]);
  });

  it('델타 100개가 3프레임에 걸쳐 오면 반영은 3번이고 글자는 하나도 빠지지 않는다', () => {
    const { frames, applied, batcher } = setup();
    const deltas = Array.from({ length: 100 }, (_, i) => `d${i} `);

    deltas.forEach((delta, i) => {
      batcher.push(delta);
      if (i === 32 || i === 65) frames.tick();
    });
    batcher.flush();

    expect(applied).toHaveLength(3);
    expect(applied.join('')).toBe(deltas.join(''));
  });
});
