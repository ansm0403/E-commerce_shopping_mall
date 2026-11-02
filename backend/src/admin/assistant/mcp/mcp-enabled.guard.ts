import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * MCP 연습 라우트 스위치(ex-mcp-practice.md D6) — `MCP_SERVER_ENABLED=true` 가 아니면 404(라우트가 없는 것처럼).
 *
 * - 모듈의 `controllers` 를 process.env 로 고르지 않고 요청 시점에 판정한다: 모듈 평가가 ConfigModule 의 .env 로드보다
 *   먼저일 수 있어 늘 꺼진 것으로 보일 수 있다.
 * - 클래스 가드(JwtAuthGuard·RolesGuard) **뒤에** 붙인다: 꺼져 있어도 비관리자는 401/403 — 역할 경계 테스트가 플래그와 무관해진다.
 * - 운영에는 켜지 않는다(연습용, OAuth·감사 설계 전).
 */
@Injectable()
export class McpEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (this.config.get<string>('MCP_SERVER_ENABLED') !== 'true') throw new NotFoundException();
    return true;
  }
}
