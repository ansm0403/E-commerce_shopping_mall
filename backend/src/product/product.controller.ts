import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  Logger,
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
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { RejectProductDto } from './dto/reject-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DemoAccountGuard } from '../auth/guards/demo-account.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/entity/role.entity';
import { ProductSeedService } from '../common/seeds/product.seed';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction } from '../audit/entity/audit-log.entity';

@Controller('products')
export class ProductController {
  private readonly logger = new Logger(ProductController.name);

  constructor(
    private readonly productService: ProductService,
    private readonly productSeedService: ProductSeedService,
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

  @Get(':id')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  @Serialize(ProductResponseDto)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Serialize(ProductResponseDto)
  @Auditable(AuditAction.PRODUCT_CREATED)
  create(@Body() dto: CreateProductDto, @Req() req: any) {
    return this.productService.create(dto, req.user.sub);
  }

  @Patch(':id')
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

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SELLER)
  @Auditable(AuditAction.PRODUCT_DELETED)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.productService.remove(id, req.user.sub);
  }

  // Admin 전용: 시드 데이터 삽입
  @Post('seed')
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles(Role.ADMIN)
  async seed() {
    try {
      return await this.productSeedService.seedProducts();
    } catch (e) {
      const err = e as {
        message?: string;
        name?: string;
        code?: string;
        detail?: string;
        stack?: string;
      };
      this.logger.error('SEED FAILED', err.stack || String(e));
      throw new InternalServerErrorException({
        message: err.message ?? 'seed failed',
        name: err.name,
        code: err.code,
        detail: err.detail,
        stack: err.stack?.split('\n').slice(0, 8),
      });
    }
  }

  @Post(':id/images')
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
