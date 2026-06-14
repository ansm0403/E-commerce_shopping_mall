import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/entity/role.entity';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';

@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Serialize(AuditLogResponseDto)
  getAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.auditService.getAuditLogs(query);
  }
}
