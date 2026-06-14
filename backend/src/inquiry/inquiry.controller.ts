import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InquiryService } from './inquiry.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/entity/role.entity';
import { User } from '../auth/decorators/user.decorator';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { AnswerInquiryDto } from './dto/answer-inquiry.dto';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { InquiryResponseDto } from './dto/inquiry-response.dto';
import { BasePaginateDto } from '../common/dto/paginate.dto';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction } from '../audit/entity/audit-log.entity';

// ── Buyer 문의 컨트롤러 ──

@Controller('inquiries')
export class InquiryController {
  constructor(private readonly inquiryService: InquiryService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @Serialize(InquiryResponseDto)
  create(
    @User('sub') userId: number,
    @Body() dto: CreateInquiryDto,
  ) {
    return this.inquiryService.create(userId, dto);
  }

  // 공개: 상품별 문의 목록 (비밀 문의는 마스킹)
  @Get('product/:productId')
  @Serialize(InquiryResponseDto)
  getByProduct(
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: BasePaginateDto,
    @User('sub') userId?: number,
  ) {
    return this.inquiryService.getByProduct(productId, userId ?? null, query);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @Serialize(InquiryResponseDto)
  getMyInquiries(
    @User('sub') userId: number,
    @Query() query: BasePaginateDto,
  ) {
    return this.inquiryService.getMyInquiries(userId, query);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  delete(
    @User('sub') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.inquiryService.delete(userId, id);
  }
}

// ── Seller 문의 컨트롤러 ──

@Controller('seller/inquiries')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SELLER)
export class SellerInquiryController {
  constructor(private readonly inquiryService: InquiryService) {}

  @Get()
  @Serialize(InquiryResponseDto)
  getMyProductInquiries(
    @User('sub') userId: number,
    @Query() query: BasePaginateDto,
  ) {
    return this.inquiryService.getSellerInquiries(userId, query);
  }

  @Patch(':id/answer')
  @Serialize(InquiryResponseDto)
  @Auditable(AuditAction.INQUIRY_ANSWERED)
  answer(
    @User('sub') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AnswerInquiryDto,
  ) {
    return this.inquiryService.answer(userId, id, dto);
  }
}
