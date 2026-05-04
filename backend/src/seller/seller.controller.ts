import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SellerService } from './seller.service';
import { ApplySellerDto } from './dto/apply-seller.dto';
import { RejectSellerDto } from './dto/reject-seller.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DemoAccountGuard } from '../auth/guards/demo-account.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/entity/role.entity';
import { User } from '../auth/decorators/user.decorator';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction } from '../audit/entity/audit-log.entity';
import { SellerApplicationQueryDto } from './dto/seller-application-query.dto';

@Controller('seller')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SellerController {
  constructor(private readonly sellerService: SellerService) {}

  // 셀러 신청 (BUYER만)
  @Post('apply')
  @Roles(Role.BUYER)
  apply(@User('sub') userId: number, @Body() dto: ApplySellerDto) {
    return this.sellerService.apply(userId, dto);
  }

  // 내 셀러 신청 현황 조회
  @Get('me')
  @Roles(Role.BUYER, Role.SELLER)
  getMyInfo(@User('sub') userId: number) {
    return this.sellerService.getMySellerInfo(userId);
  }

  // 관리자: 신청 목록 조회
  @Get('applications')
  @Roles(Role.ADMIN)
  getApplications(@Query() query: SellerApplicationQueryDto) {
    return this.sellerService.getApplications(query);
  }

  // 관리자: 승인
  @Patch('applications/:id/approve')
  @UseGuards(DemoAccountGuard)
  @Roles(Role.ADMIN)
  @Auditable(AuditAction.SELLER_APPROVED)
  approve(@Param('id', ParseIntPipe) id: number) {
    return this.sellerService.approve(id);
  }

  // 관리자: 거절
  @Patch('applications/:id/reject')
  @UseGuards(DemoAccountGuard)
  @Roles(Role.ADMIN)
  @Auditable(AuditAction.SELLER_REJECTED, { captureBody: ['reason'] })
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectSellerDto) {
    return this.sellerService.reject(id, dto.reason);
  }
}
