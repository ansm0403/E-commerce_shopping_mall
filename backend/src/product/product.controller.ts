import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { Throttle } from '@nestjs/throttler';
import { ProductService } from './product.service';
import { ProductSummaryService } from './product-summary.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStatusDto } from './dto/update-product-status.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { RejectProductDto } from './dto/reject-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DemoAccountGuard } from '../auth/guards/demo-account.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/entity/role.entity';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction } from '../audit/entity/audit-log.entity';

@Controller('products')
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly productSummaryService: ProductSummaryService,
  ) {}

  /** 구매자용: APPROVED + PUBLISHED 상품만 */
  @Get()
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Serialize(ProductResponseDto)
  findAll(@Query() query: ProductQueryDto) {
    return this.productService.findAll(query);
  }

  /** 셀러: 본인 상품 목록 — :id 보다 위에 선언해야 라우트 충돌 방지 */
  @Get('my')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Serialize(ProductResponseDto)
  findMyProducts(@Query() query: ProductQueryDto, @Req() req: any) {
    return this.productService.findMyProducts(req.user.sub, query);
  }

  /** 셀러: 본인 상품 단건(수정 화면용) — 공개 :id 와 달리 HIDDEN 등 모든 상태를 보여준다 */
  @Get('my/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Serialize(ProductResponseDto)
  findMyProduct(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.productService.findMyProduct(id, req.user.sub);
  }

  @Get(':id')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Serialize(ProductResponseDto)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productService.findOne(id);
  }

  /**
   * (Phase 5c) 구매자 AI 리뷰 요약 — 공개, 상품 상세와 분리해 지연 로드한다.
   * SWR: 캐시를 즉시 반환하고 낡았으면 백그라운드 재생성(읽기 경로 LLM 호출 0).
   */
  @Get(':id/review-summary')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  getReviewSummary(@Param('id', ParseIntPipe) id: number) {
    return this.productSummaryService.getReviewSummary(id);
  }

  @Post()
  @UseGuards(DemoAccountGuard)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Serialize(ProductResponseDto)
  @Auditable(AuditAction.PRODUCT_CREATED)
  create(@Body() dto: CreateProductDto, @Req() req: any) {
    return this.productService.create(dto, req.user.sub);
  }

  @Patch(':id')
  @UseGuards(DemoAccountGuard)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Serialize(ProductResponseDto)
  @Auditable(AuditAction.PRODUCT_UPDATED)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
    @Req() req: any,
  ) {
    return this.productService.update(id, dto, req.user.sub);
  }

  /** 셀러: 게시/숨김/단종 토글 — 내용 수정(PATCH :id)과 달리 재심사를 발동하지 않는다 */
  @Patch(':id/status')
  @UseGuards(DemoAccountGuard)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Serialize(ProductResponseDto)
  @Auditable(AuditAction.PRODUCT_UPDATED, { captureBody: ['status'] })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductStatusDto,
    @Req() req: any,
  ) {
    return this.productService.updateStatus(id, dto.status, req.user.sub);
  }

  @Delete(':id')
  @UseGuards(DemoAccountGuard)
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Auditable(AuditAction.PRODUCT_DELETED)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.productService.remove(id, req.user.sub);
  }

  // `POST /products/seed` 는 2026-10-20 에 삭제했다 — 호출하는 화면이 없고(운영 부트스트랩은 SEED_PRODUCTS=true 배치 경로),
  // 관리자 가드만 있어 공개 데모 관리자 토큰으로 운영 상품을 다시 쓰게 할 수 있었다(DemoAccountGuard 없음).
  // 쓰지 않는 라우트는 가드를 고치는 게 아니라 지운다 — docs/roadmap/ex-security-api-boundary.md §9.

  @Post(':id/images')
  @UseGuards(DemoAccountGuard)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      // 업로드 파일은 /uploads 로 정적 서빙되므로(main.ts) 이미지 외 확장자를 막지 않으면
      // .html 등이 same-origin 으로 열리는 저장형 XSS 벡터가 된다. 확장자+mimetype 화이트리스트
      // (스크립트를 품을 수 있는 svg 는 제외) + helmet 의 X-Content-Type-Options: nosniff 조합으로 방어.
      fileFilter: (_req, file, cb) => {
        const extOk = /\.(jpe?g|png|gif|webp|avif)$/i.test(file.originalname);
        const mimeOk = /^image\/(jpeg|png|gif|webp|avif)$/.test(file.mimetype);
        if (extOk && mimeOk) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              '이미지 파일(jpg·jpeg·png·gif·webp·avif)만 업로드할 수 있습니다.',
            ),
            false,
          );
        }
      },
    }),
  )
  addImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    return this.productService.addImage(id, req.user.sub, file);
  }
}

/** 관리자 상품 관리 컨트롤러 */
@Controller('admin/products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  @Serialize(ProductResponseDto)
  findAll(@Query() query: ProductQueryDto) {
    return this.productService.findAllAdmin(query);
  }

  @Patch(':id/approve')
  @UseGuards(DemoAccountGuard)
  @Serialize(ProductResponseDto)
  @Auditable(AuditAction.PRODUCT_APPROVED)
  approve(@Param('id', ParseIntPipe) id: number) {
    return this.productService.approve(id);
  }

  @Patch(':id/reject')
  @UseGuards(DemoAccountGuard)
  @Serialize(ProductResponseDto)
  @Auditable(AuditAction.PRODUCT_REJECTED, { captureBody: ['reason'] })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectProductDto,
  ) {
    return this.productService.reject(id, dto.reason);
  }
}
