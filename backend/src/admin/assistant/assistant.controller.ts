import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AssistantService } from './assistant.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '../../user/entity/role.entity';

/**
 * 관리자 AI 어시스턴트 엔드포인트.
 * 대시보드/감사로그와 동일한 보호: JwtAuthGuard + RolesGuard + @Roles(ADMIN).
 *
 * - POST /v1/admin/assistant/chat   — (Phase 1) 비스트리밍 1턴 (임시 검증용)
 * - POST /v1/admin/assistant/stream — (Phase 2) 멀티턴 + SSE 스트리밍
 */
@Controller('admin/assistant')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('chat')
  chat(@Body() body: ChatRequestDto) {
    return this.assistantService.chat(body.message);
  }

  /**
   * SSE-over-POST: EventSource는 POST·Authorization 헤더를 못 쓰므로,
   * 프론트는 fetch + ReadableStream으로 받아 `data:` 프레임을 직접 파싱한다.
   * (가드는 핸들러 이전에 실행되므로 @Res 수동 응답이어도 admin 인증은 유지됨)
   */
  @Post('stream')
  async stream(@Body() body: ChatRequestDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 프록시 버퍼링 방지
    res.flushHeaders?.();

    try {
      for await (const ev of this.assistantService.streamChat(body)) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch {
      res.write(
        `data: ${JSON.stringify({ type: 'error', message: 'AI 응답 생성에 실패했습니다.' })}\n\n`,
      );
    } finally {
      res.end();
    }
  }
}
