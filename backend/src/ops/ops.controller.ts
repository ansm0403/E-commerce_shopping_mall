import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/entity/role.entity';
import { OpsService } from './ops.service';
import { IncidentSummary } from './dto/incident-summary.dto';
import { IncidentDetail } from './dto/incident-detail.dto';

/**
 * /v1/ops — RN Ops Companion 전용 엔드포인트 (설계 §5.1).
 * 전역 prefix 가 v1 이므로 여기엔 붙이지 않는다(과거 이중 prefix 버그).
 * 관리자만: JwtAuthGuard(토큰) + RolesGuard(Role.ADMIN). 조회 전용이라 DemoAccountGuard 는 걸지 않는다.
 */
@Controller('ops')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  /**
   * GET /v1/ops/incidents — 최근 24h 인시던트 목록(축약형).
   * X-Cache: HIT|MISS 헤더로 Redis 캐시 적중 여부를 알린다(디버깅/e2e 검증용, body 는 설계 그대로 배열).
   */
  @Get('incidents')
  async getIncidents(@Res({ passthrough: true }) res: Response): Promise<IncidentSummary[]> {
    const { items, cached } = await this.opsService.getIncidents();
    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    return items;
  }

  /**
   * GET /v1/ops/incidents/:id — 인시던트 상세(스택트레이스·breadcrumbs 축약형). 푸시 딥링크의 도착지.
   * 없는 id 는 404 — 앱은 "지워졌거나 접근할 수 없는 인시던트" 화면을 그린다.
   */
  @Get('incidents/:id')
  async getIncident(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<IncidentDetail> {
    const { item, cached } = await this.opsService.getIncident(id);
    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    return item;
  }
}
