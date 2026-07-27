import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SettlementService } from './settlement.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DemoAccountGuard } from '../auth/guards/demo-account.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/entity/role.entity';
import { User } from '../auth/decorators/user.decorator';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { SettlementResponseDto } from './dto/settlement-response.dto';
import { SettlementQueryDto } from './dto/settlement-query.dto';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction } from '../audit/entity/audit-log.entity';

// ── 셀러 정산 컨트롤러 ──

@Controller('seller/settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SELLER)
export class SellerSettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Get()
  @Serialize(SettlementResponseDto)
  getMySettlements(
    @User('sub') userId: number,
    @Query() query: SettlementQueryDto,
  ) {
    return this.settlementService.getSellerSettlements(userId, query);
  }

  @Get('summary')
  getSummary(@User('sub') userId: number) {
    return this.settlementService.getSellerSummary(userId);
  }
}

// ── Admin 정산 컨트롤러 ──

@Controller('admin/settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminSettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Get()
  @Serialize(SettlementResponseDto)
  getAllSettlements(@Query() query: SettlementQueryDto) {
    return this.settlementService.getAllSettlements(query);
  }

  @Patch(':id/confirm')
  @UseGuards(DemoAccountGuard)
  @Serialize(SettlementResponseDto)
  @Auditable(AuditAction.SETTLEMENT_CONFIRMED)
  confirm(@Param('id', ParseIntPipe) id: number) {
    return this.settlementService.confirmSettlement(id);
  }

  @Patch(':id/pay')
  @UseGuards(DemoAccountGuard)
  @Serialize(SettlementResponseDto)
  @Auditable(AuditAction.SETTLEMENT_PAID)
  markAsPaid(@Param('id', ParseIntPipe) id: number) {
    return this.settlementService.markAsPaid(id);
  }
}
