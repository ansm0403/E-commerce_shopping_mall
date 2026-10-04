import { AssistantStreamRegistry } from './assistant-stream-registry';

describe('AssistantStreamRegistry — 명시적 중지 요청', () => {
  it('본인의 진행 중 스트림을 중단한다', () => {
    const registry = new AssistantStreamRegistry();
    const controller = new AbortController();
    registry.register(1, 'req-a', controller);

    expect(registry.cancel(1, 'req-a')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it('다른 사용자는 requestId 를 알아도 끊을 수 없다', () => {
    const registry = new AssistantStreamRegistry();
    const controller = new AbortController();
    registry.register(1, 'req-a', controller);

    expect(registry.cancel(2, 'req-a')).toBe(false);
    expect(controller.signal.aborted).toBe(false);
  });

  it('모르는 id · 이미 끝난 스트림은 false(오류 아님)', () => {
    const registry = new AssistantStreamRegistry();
    const controller = new AbortController();
    registry.register(1, 'req-a', controller);
    registry.release(1, 'req-a', controller);

    expect(registry.cancel(1, 'req-a')).toBe(false);
    expect(registry.cancel(1, 'never')).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('release 는 자기 스트림만 지운다(같은 id 로 새 스트림이 등록된 뒤 늦게 끝난 옛 스트림)', () => {
    const registry = new AssistantStreamRegistry();
    const older = new AbortController();
    const newer = new AbortController();
    registry.register(1, 'req-a', older);
    registry.register(1, 'req-a', newer);

    registry.release(1, 'req-a', older);

    expect(registry.cancel(1, 'req-a')).toBe(true);
    expect(newer.signal.aborted).toBe(true);
    expect(older.signal.aborted).toBe(false);
  });
});
