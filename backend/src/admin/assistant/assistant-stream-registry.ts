import { Injectable } from '@nestjs/common';

/**
 * 진행 중인 어시스턴트 스트림의 중단 손잡이 보관소 — "중지" 요청이 다른 HTTP 요청으로 와도 해당 스트림을 끊을 수 있게 한다.
 *
 * 왜 필요한가: 중지를 "연결이 끊겼다"로만 알아내면 중간 프록시에 달려 있다. 운영 경로(Vercel 프록시 → nginx)에서는
 * 브라우저가 연결을 끊어도 백엔드의 응답 소켓이 닫히지 않아 서버가 끝까지 돌았다(2026-10-04 실측).
 * 그래서 클라이언트가 스트림을 시작할 때 requestId 를 보내고, 중지할 때 그 id 로 명시적으로 요청한다.
 *
 * - 키에 사용자 id 를 넣는다 → 남의 스트림은 id 를 알아도 끊을 수 없다.
 * - 메모리 보관 = 백엔드 인스턴스가 1개라는 전제(현재 EC2 단일 컨테이너). 여러 대로 늘리면 Redis pub/sub 로 바꿔야 한다.
 */
@Injectable()
export class AssistantStreamRegistry {
  private readonly active = new Map<string, AbortController>();

  private key(adminUserId: number, requestId: string): string {
    return `${adminUserId}:${requestId}`;
  }

  register(adminUserId: number, requestId: string, controller: AbortController): void {
    this.active.set(this.key(adminUserId, requestId), controller);
  }

  /** 스트림이 끝나면(정상·중단·오류) 반드시 부른다. 같은 id 로 새 스트림이 등록돼 있으면 그것은 건드리지 않는다. */
  release(adminUserId: number, requestId: string, controller: AbortController): void {
    const key = this.key(adminUserId, requestId);
    if (this.active.get(key) === controller) this.active.delete(key);
  }

  /** 본인의 진행 중 스트림을 중단한다. 끊었으면 true, 없으면(이미 끝남·남의 것·모르는 id) false. */
  cancel(adminUserId: number, requestId: string): boolean {
    const controller = this.active.get(this.key(adminUserId, requestId));
    if (!controller) return false;
    controller.abort();
    return true;
  }

  get size(): number {
    return this.active.size;
  }
}
