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
import { Throttle } from '@nestjs/throttler';
import { ReviewService } from './review.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/entity/role.entity';
import { User } from '../auth/decorators/user.decorator';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { ReviewResponseDto } from './dto/review-response.dto';
import { BasePaginateDto } from '../common/dto/paginate.dto';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction } from '../audit/entity/audit-log.entity';

@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @Serialize(ReviewResponseDto)
  @Auditable(AuditAction.REVIEW_CREATED, { captureBody: ['productId', 'rating'] })
  create(
    @User('sub') userId: number,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewService.create(userId, dto);
  }

  // 공개 엔드포인트: 상품별 평점 분포 집계 (상품 상세 분포 막대용)
  @Get('product/:productId/summary')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  getProductSummary(@Param('productId', ParseIntPipe) productId: number) {
    return this.reviewService.getProductReviewSummary(productId);
  }

  // 공개 엔드포인트: 상품별 리뷰 목록
  @Get('product/:productId')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Serialize(ReviewResponseDto)
  getByProduct(
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: BasePaginateDto,
  ) {
    return this.reviewService.getByProduct(productId, query);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @Serialize(ReviewResponseDto)
  getMyReviews(
    @User('sub') userId: number,
    @Query() query: BasePaginateDto,
  ) {
    return this.reviewService.getMyReviews(userId, query);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER)
  @Serialize(ReviewResponseDto)
  @Auditable(AuditAction.REVIEW_UPDATED)
  update(
    @User('sub') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviewService.update(userId, id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BUYER, Role.ADMIN)
  @Auditable(AuditAction.REVIEW_DELETED)
  delete(
    @User('sub') userId: number,
    @User('roles') roles: Role[],
    @Param('id', ParseIntPipe) id: number,
  ) {
    const isAdmin = roles.includes(Role.ADMIN);
    return this.reviewService.delete(userId, id, isAdmin);
  }
}
