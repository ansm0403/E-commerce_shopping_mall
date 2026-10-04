import { EventEmitter } from 'events';
import type { Response } from 'express';
import type { AssistantStreamEvent } from '@shopping-mall/shared';
import { AssistantController } from './assistant.controller';
import { AssistantStreamRegistry } from './assistant-stream-registry';
import type { AssistantService } from './assistant.service';

/**
 * 스트림 중단의 두 경로가 같은 signal 로 서비스에 닿는지 — 서비스는 mock(받은 signal 만 본다).
 *  ① 명시적 중지(stream/cancel + requestId) ② 연결 끊김(res 'close')
 */

// 서비스 모듈을 실제로 읽으면 엔티티 순환 import 가 @swc/jest 에서 TDZ 로 죽는다(타입만 쓴다)
jest.mock('./assistant.service', () => ({ AssistantService: class {} }));
jest.mock('../../auth/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('../../auth/guards/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('../../user/entity/role.entity', () => ({ Role: { ADMIN: 'admin' } }));

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
function setup() {
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
    const { controller, registry, res, signal } = setup();

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
    const { controller, res, signal } = setup();

    const running = controller.stream({ message: 'q', requestId: 'req-1' }, 1, res as unknown as Response);
    await tick();
    controller.cancelStream({ requestId: 'req-1' }, 2);
    await tick();
    expect(signal()?.aborted).toBe(false);

    controller.cancelStream({ requestId: 'req-1' }, 1); // 정리
    await running;
  });

  it('② 응답이 끝나기 전에 연결이 닫히면 signal 이 중단된다', async () => {
    const { controller, res, signal } = setup();

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
    const { controller } = setup();
    expect(() => controller.cancelStream({ requestId: 'gone' }, 1)).not.toThrow();
  });
});
