import { Controller, Delete, Get, Logger, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AssistantService } from '../assistant.service';
import { createShopMcpServer } from './shop-mcp-server';
import { McpEnabledGuard } from './mcp-enabled.guard';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { User } from '../../../auth/decorators/user.decorator';
import { Role } from '../../../user/entity/role.entity';
import { adminToolContext } from '../../../search/tool-execution-context';

/**
 * 관리자 어시스턴트 도구 6개를 내보내는 MCP 엔드포인트(ex-mcp-practice.md §4, 로컬 연습용 — 플래그 기본 off).
 *
 * - 인증은 채팅과 같은 관리자 가드(D5). `DemoAccountGuard` 없음 — 데모 관리자도 채팅을 쓰므로 MCP 도 같게.
 *   가드 순서: JwtAuthGuard → RolesGuard → McpEnabledGuard(D6).
 * - Streamable HTTP **stateless**(D4): 요청마다 서버·전송 객체를 새로 만들고 응답이 끝나면 닫는다.
 *   그래서 요청마다 그 요청의 인증 결과(관리자 id·역할)로 도구 실행 context 를 묶을 수 있다.
 * - 본문은 DTO 없이 `req.body` 를 그대로 넘긴다 — JSON-RPC 키(jsonrpc·method…)를 전역 ValidationPipe(forbidNonWhitelisted)가 400 으로 거절하지 않게.
 * - GET(서버→클라이언트 SSE)·DELETE(세션 종료)는 stateless 라 405. SDK 클라이언트는 405 를 "SSE 없음"으로 조용히 넘기지만
 *   404 는 오류로 올린다 — 그래서 라우트를 두고 405 를 준다.
 */
@Controller('admin/mcp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly assistant: AssistantService) {}

  @Post()
  @UseGuards(McpEnabledGuard)
  async handle(@Req() req: Request, @Res() res: Response, @User('sub') adminUserId: number, @User('roles') roles: Role[] = []): Promise<void> {
    const requestId = randomUUID();
    const server = createShopMcpServer({
      listTools: () => this.assistant.availableTools(),
      // 클라이언트가 호출을 취소하면 SDK 가 signal 을 끊는다 → executeTool 이 남은 조회를 멈춘다.
      // 채팅과 구분은 context 가 아니라 이 로그로 한다(D8 — 권한 판정 코드인 ToolExecutionContext 는 건드리지 않는다).
      callTool: (call, signal) => {
        this.logger.log(`[mcp] tools/call ${call.name} argKeys=${Object.keys(call.args ?? {}).join(',') || '-'} admin=${adminUserId} req=${requestId}`);
        return this.assistant.executeTool(call, adminToolContext(adminUserId, roles, requestId, signal));
      },
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  @Get()
  @UseGuards(McpEnabledGuard)
  rejectGet(@Res() res: Response): void {
    this.methodNotAllowed(res);
  }

  @Delete()
  @UseGuards(McpEnabledGuard)
  rejectDelete(@Res() res: Response): void {
    this.methodNotAllowed(res);
  }

  /** SDK 의 stateless 전송이 같은 상황에서 내는 응답과 같은 모양(JSON-RPC 오류 -32000). */
  private methodNotAllowed(res: Response): void {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  }
}
