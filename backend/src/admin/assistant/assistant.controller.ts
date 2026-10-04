import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AssistantService } from './assistant.service';
import { AssistantStreamRegistry } from './assistant-stream-registry';
import { CancelStreamDto, ChatRequestDto } from './dto/chat-request.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { User } from '../../auth/decorators/user.decorator';
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
  constructor(
    private readonly assistantService: AssistantService,
    private readonly streams: AssistantStreamRegistry,
  ) {}

  @Post('chat')
  chat(@Body() body: ChatRequestDto) {
    return this.assistantService.chat(body.message);
  }

  /**
   * 새로고침 후 UI 복원용 — 대화의 메시지를 시간순으로 조회.
   * 본인(@User('sub')) 소유 대화만 반환(아니면 빈 배열).
   */
  @Get('conversations/:id/messages')
  getConversationMessages(
    @Param('id', ParseIntPipe) id: number,
    @User('sub') adminUserId: number,
  ) {
    return this.assistantService.getConversationMessages(id, adminUserId);
  }

  /**
   * SSE-over-POST: EventSource는 POST·Authorization 헤더를 못 쓰므로,
   * 프론트는 fetch + ReadableStream으로 받아 `data:` 프레임을 직접 파싱한다.
   * (가드는 핸들러 이전에 실행되므로 @Res 수동 응답이어도 admin 인증은 유지됨)
   */
  @Post('stream')
  async stream(
    @Body() body: ChatRequestDto,
    @User('sub') adminUserId: number,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 프록시 버퍼링 방지
    res.flushHeaders?.();

    // 중단 신호 하나를 서비스·LLM 까지 전파한다. 끊는 길은 둘이다.
    //  ① 명시적 중지: 클라이언트가 stream/cancel 로 requestId 를 보낸다 — 프록시와 무관하게 동작(운영의 주 경로).
    //  ② 연결 끊김: 응답 소켓이 닫힘(탭 닫기 등). 'close' 는 정상 종료 뒤에도 발생하므로 끝나기 전에 닫힌 경우만.
    //     ⚠ 운영(Vercel 프록시 → nginx)에서는 브라우저가 끊어도 이 이벤트가 오지 않았다(실측) → ① 이 필요한 이유.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    const { requestId } = body;
    if (requestId) this.streams.register(adminUserId, requestId, abort);

    try {
      for await (const ev of this.assistantService.streamChat(
        {
          message: body.message,
          conversationId: body.conversationId,
          adminUserId,
        },
        abort.signal,
      )) {
        if (!abort.signal.aborted) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch {
      if (!abort.signal.aborted) {
        res.write(
          `data: ${JSON.stringify({ type: 'error', message: 'AI 응답 생성에 실패했습니다.' })}\n\n`,
        );
      }
    } finally {
      if (requestId) this.streams.release(adminUserId, requestId, abort);
      res.end();
    }
  }

  /**
   * 진행 중인 스트림 중지 — "중지" 버튼이 부른다. 본인(@User('sub'))의 스트림만 끊을 수 있다.
   * 이미 끝났거나 모르는 id 여도 204(중지는 "더 이상 진행되지 않게"가 목적이라 결과가 같다).
   */
  @Post('stream/cancel')
  @HttpCode(204)
  cancelStream(@Body() body: CancelStreamDto, @User('sub') adminUserId: number): void {
    this.streams.cancel(adminUserId, body.requestId);
  }
}
