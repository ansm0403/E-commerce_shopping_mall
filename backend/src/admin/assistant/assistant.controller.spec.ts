import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { AssistantStreamEvent } from '@shopping-mall/shared';
import { AssistantController } from './assistant.controller';
import { AssistantStreamRegistry } from './assistant-stream-registry';
import type { AssistantService } from './assistant.service';
import { Role } from '../../user/entity/role.entity';

jest.mock('./assistant.service', () => ({ AssistantService: class {} }));
jest.mock('../../auth/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('../../auth/guards/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('../../user/entity/role.entity', () => ({ Role: { ADMIN: 'admin' } }));

class StreamResponse extends EventEmitter {
  writableEnded = false;
  destroyed = false;
  setHeader = jest.fn();
  flushHeaders = jest.fn();
  write = jest.fn((frame: string) => {
    if (this.writableEnded || this.destroyed) throw new Error('WRITE_AFTER_RESPONSE_CLOSED');
    return true;
  });
  end = jest.fn(() => { this.writableEnded = true; });
}

function setup(fail = false) {
  let complete!: () => void;
  const pending = new Promise<void>(resolve => { complete = resolve; });
  let signal!: AbortSignal;
  const streamChat = jest.fn(async function* (_params: unknown, receivedSignal: AbortSignal) {
    signal = receivedSignal;
    // Deliberately ignores cancellation until complete(): heartbeat cleanup must not await the service.
    await pending;
    if (fail) throw new Error('synthetic provider detail must not reach SSE');
    yield { type: 'done' as const };
  });
  const registry = new AssistantStreamRegistry();
  const controller = new AssistantController({ streamChat } as unknown as AssistantService, registry);
  const response = new StreamResponse();
  const request = controller.stream({ message: '테스트 질문', requestId: 'heartbeat-test' }, 1, response as unknown as Response, [Role.ADMIN]);
  return { controller, registry, response, request, complete, get signal() { return signal; } };
}

const frames = (response: StreamResponse) => response.write.mock.calls.map(([frame]) => frame);

describe('AssistantController — SSE keep-alive lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends only comment heartbeats every 15 seconds while generation is pending', async () => {
    const state = setup();
    await jest.advanceTimersByTimeAsync(14999);
    expect(frames(state.response)).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(frames(state.response)).toEqual([': keep-alive\n\n']);
    await jest.advanceTimersByTimeAsync(15000);
    expect(frames(state.response)).toEqual([': keep-alive\n\n', ': keep-alive\n\n']);
    expect(frames(state.response).every(frame => !frame.startsWith('data:'))).toBe(true);
    expect(state.response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');
    expect(state.response.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    state.complete();
    await state.request;
    expect(frames(state.response).filter(frame => frame.startsWith('data:'))).toEqual(['data: {"type":"done"}\n\n']);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('normal completion removes the timer, close listener and registry entry before ending the response', async () => {
    const state = setup();
    expect(state.response.listenerCount('close')).toBe(1);
    expect(state.registry.size).toBe(1);
    state.complete();
    await state.request;
    expect(state.response.end).toHaveBeenCalledTimes(1);
    expect(state.response.listenerCount('close')).toBe(0);
    expect(state.registry.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    const savedFrames = frames(state.response);
    await jest.advanceTimersByTimeAsync(60000);
    expect(frames(state.response)).toEqual(savedFrames);
  });

  it('generation errors emit the safe error event and clear pending heartbeats', async () => {
    const state = setup(true);
    await jest.advanceTimersByTimeAsync(15000);
    state.complete();
    await state.request;
    expect(frames(state.response)).toEqual([
      ': keep-alive\n\n',
      'data: {"type":"error","message":"AI 응답 생성에 실패했습니다."}\n\n',
    ]);
    expect(state.response.listenerCount('close')).toBe(0);
    expect(state.registry.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60000);
    expect(state.response.write).toHaveBeenCalledTimes(2);
  });

  it('explicit cancellation clears heartbeats immediately even if the service settles late', async () => {
    const state = setup();
    await jest.advanceTimersByTimeAsync(15000);
    state.controller.cancelStream({ requestId: 'heartbeat-test' }, 1);
    expect(state.signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60000);
    expect(frames(state.response)).toEqual([': keep-alive\n\n']);
    state.complete();
    await state.request;
    expect(frames(state.response)).toEqual([': keep-alive\n\n']);
    expect(state.response.listenerCount('close')).toBe(0);
    expect(state.registry.size).toBe(0);
  });

  it('socket closure aborts generation and clears the timer before late service completion', async () => {
    const state = setup();
    await jest.advanceTimersByTimeAsync(15000);
    state.response.destroyed = true;
    state.response.emit('close');
    expect(state.signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60000);
    expect(frames(state.response)).toEqual([': keep-alive\n\n']);
    state.complete();
    await state.request;
    expect(frames(state.response)).toEqual([': keep-alive\n\n']);
    expect(state.response.listenerCount('close')).toBe(0);
    expect(state.registry.size).toBe(0);
  });

  it('never writes a heartbeat after the response has already ended', async () => {
    const state = setup();
    state.response.writableEnded = true;
    state.response.emit('close');
    await jest.advanceTimersByTimeAsync(60000);
    expect(state.response.write).not.toHaveBeenCalled();
    state.complete();
    await state.request;
    expect(state.response.write).not.toHaveBeenCalled();
    expect(state.response.listenerCount('close')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

class FakeResponse extends EventEmitter {
  writes: string[] = [];
  writableEnded = false;
  setHeader = jest.fn();
  flushHeaders = jest.fn();
  write(chunk: string) {
    this.writes.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
    this.emit('close'); // 정상 종료 뒤에도 close 는 발생한다
  }
  events(): AssistantStreamEvent[] {
    return this.writes.map((w) => JSON.parse(w.replace(/^data: /, '')) as AssistantStreamEvent);
  }
}

/** signal 이 중단될 때까지 기다리는 스트림 — "도구 실행 중" 상태를 흉내 낸다 */
function setupCancellation() {
  let seenSignal: AbortSignal | undefined;
  const streamChat = jest.fn(async function* (_params: unknown, signal?: AbortSignal) {
    seenSignal = signal;
    yield { type: 'meta', conversationId: '7' } as AssistantStreamEvent;
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve();
      signal?.addEventListener('abort', () => resolve());
    });
    // 중단되면 서비스는 done 없이 끝낸다
  });
  const registry = new AssistantStreamRegistry();
  const controller = new AssistantController({ streamChat } as unknown as AssistantService, registry);
  const res = new FakeResponse();
  return { controller, registry, res, streamChat, signal: () => seenSignal };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('AssistantController — 스트림 중단', () => {
  it('① stream/cancel 로 같은 requestId 를 보내면 진행 중인 스트림의 signal 이 중단된다', async () => {
    const { controller, registry, res, signal } = setupCancellation();

    const running = controller.stream({ message: 'q', requestId: 'req-1' }, 1, res as unknown as Response);
    await tick();
    expect(signal()?.aborted).toBe(false);
    expect(registry.size).toBe(1);

    controller.cancelStream({ requestId: 'req-1' }, 1);
    await running;

    expect(signal()?.aborted).toBe(true);
    expect(res.events()).toEqual([{ type: 'meta', conversationId: '7' }]);
    expect(res.writableEnded).toBe(true);
    expect(registry.size).toBe(0); // 끝나면 보관소에서 빠진다
  });

  it('다른 사용자의 cancel 은 스트림을 끊지 못한다', async () => {
    const { controller, res, signal } = setupCancellation();

    const running = controller.stream({ message: 'q', requestId: 'req-1' }, 1, res as unknown as Response);
    await tick();
    controller.cancelStream({ requestId: 'req-1' }, 2);
    await tick();
    expect(signal()?.aborted).toBe(false);

    controller.cancelStream({ requestId: 'req-1' }, 1); // 정리
    await running;
  });

  it('② 응답이 끝나기 전에 연결이 닫히면 signal 이 중단된다', async () => {
    const { controller, res, signal } = setupCancellation();

    const running = controller.stream({ message: 'q' }, 1, res as unknown as Response);
    await tick();
    res.emit('close'); // 클라이언트가 끊음(writableEnded 는 아직 false)
    await running;

    expect(signal()?.aborted).toBe(true);
  });

  it('정상 종료 뒤의 close 는 중단이 아니다', async () => {
    const streamChat = jest.fn(async function* (_params: unknown, _signal?: AbortSignal) {
      yield { type: 'done' } as AssistantStreamEvent;
    });
    const controller = new AssistantController(
      { streamChat } as unknown as AssistantService,
      new AssistantStreamRegistry(),
    );
    const res = new FakeResponse();

    await controller.stream({ message: 'q', requestId: 'req-1' }, 1, res as unknown as Response);

    const passed = streamChat.mock.calls[0][1] as AbortSignal;
    expect(passed.aborted).toBe(false);
    expect(res.events()).toEqual([{ type: 'done' }]);
  });

  it('끝난 스트림·모르는 id 의 cancel 은 아무 일도 하지 않는다(예외 없음)', () => {
    const { controller } = setupCancellation();
    expect(() => controller.cancelStream({ requestId: 'gone' }, 1)).not.toThrow();
  });
});
