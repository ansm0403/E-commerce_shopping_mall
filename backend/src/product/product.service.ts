import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, FindOptionsWhere, In, Repository } from 'typeorm';
import { ProductEntity, ProductStatus, ApprovalStatus } from './entity/product.entity';
import { CategoryEntity } from '../category/entity/category.entity';
import { ProductImageEntity } from './entity/product-image.entity';
import { SellerEntity, SellerStatus } from '../seller/entity/seller.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import { RedisService } from '../intrastructure/redis/redis.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { ProductCreatedEvent, ProductApprovedEvent, ProductRejectedEvent } from './events/product.events';
import { CommonService } from '../common/common.service';
import {
  IProductSearchService,
  PRODUCT_SEARCH_SERVICE,
} from './interfaces/product-search.interface';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(ProductImageEntity)
    private readonly productImageRepository: Repository<ProductImageEntity>,
    @InjectRepository(SellerEntity)
    private readonly sellerRepository: Repository<SellerEntity>,
    @InjectRepository(OrderItemEntity)
    private readonly orderItemRepository: Repository<OrderItemEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly redisService: RedisService,
    private readonly commonService: CommonService,
    @Inject(PRODUCT_SEARCH_SERVICE)
    private readonly searchService: IProductSearchService,
  ) {}

  private static readonly CACHE_TTL_LIST = 60;      // 목록 60초
  private static readonly CACHE_TTL_DETAIL = 300;   // 상세 5분
  private static readonly MAX_IMAGES_PER_PRODUCT = 10;

  /** 해당 카테고리 + 모든 하위 카테고리 ID 반환 (path LIKE 활용) */
  private async getCategoryIds(categoryId: number): Promise<number[]> {
    const category = await this.categoryRepository.findOne({ where: { id: categoryId } });
    if (!category) return [categoryId];

    const descendants = await this.categoryRepository
      .createQueryBuilder('cat')
      .where('cat.path LIKE :path', { path: `${category.path}%` })
      .getMany();

    return descendants.map(c => c.id);
  }

  /** 승인된 셀러 조회 — 미승인이면 ForbiddenException */
  private async getApprovedSeller(userId: number): Promise<SellerEntity> {
    const seller = await this.sellerRepository.findOne({
      where: { userId, status: SellerStatus.APPROVED },
    });
    if (!seller) {
      throw new ForbiddenException('승인된 셀러만 상품을 관리할 수 있습니다.');
    }
    return seller;
  }

  /** 구매자용: APPROVED + PUBLISHED 상품만 조회 (Redis 캐싱) */
  async findAll(query: ProductQueryDto) {
    // keyword가 있으면 검색 서비스로 위임 (캐싱 없음 — 검색은 동적 쿼리라 캐시 효과 낮음)
    if (query.keyword) {
      // 비검색 경로와 동일하게 categoryId → 하위 카테고리까지 확장해서 넘긴다.
      // (상품은 리프 카테고리에 저장되므로 정확 일치 필터는 0건을 만든다)
      const categoryIds = query.categoryId
        ? await this.getCategoryIds(query.categoryId)
        : undefined;

      return this.searchService.search({
        keyword: query.keyword,
        tags: query.tags,
        categoryId: query.categoryId,
        categoryIds,
        sellerId: query.sellerId,
        page: query.page,
        take: query.take,
        sortBy: query.sortBy ?? 'createdAt',
        sortOrder: query.sortOrder ?? 'DESC',
        cursor: query.cursor,
        filter: query.filter,
      });
    }

    const cacheKey = `products:list:${JSON.stringify(query)}`;
    const cached = await this.redisService.getCache<{ data: unknown[]; meta: unknown }>(cacheKey);
    // 캐시 corrupt 방어: data 배열과 meta 객체가 없으면 캐시를 무효화하고 DB 조회
    if (cached) {
      if (Array.isArray(cached.data) && cached.meta && typeof cached.meta === 'object') {
        return cached;
      }
      await this.redisService.delCache(cacheKey);
    }

    const fixedWhere: FindOptionsWhere<ProductEntity> = {
      approvalStatus: ApprovalStatus.APPROVED,
      status: ProductStatus.PUBLISHED,
    };
    if (query.categoryId) {
      const categoryIds = await this.getCategoryIds(query.categoryId);
      fixedWhere.categoryId = In(categoryIds);
    }
    if (query.sellerId) fixedWhere.sellerId = query.sellerId;

    const result = await this.commonService.paginate(
      query,
      this.productRepository,
      'products',
      { where: fixedWhere, relations: ['images', 'category', 'seller'] },
    );

    await this.redisService.setCache(cacheKey, result, ProductService.CACHE_TTL_LIST);
    return result;
  }

  /** 상품 상세 조회 (Redis 캐싱) */
  async findOne(id: number): Promise<ProductEntity> {
    const cacheKey = `products:detail:${id}`;
    const cached = await this.redisService.getCache<ProductEntity>(cacheKey);
    if (cached) {
      // 캐시 유령 방어 + EC7: 비공개 상품 노출 방어
      const exists = await this.productRepository.findOne({
        where: { id },
        select: ['id', 'status', 'approvalStatus'],
      });
      if (!exists) {
        await this.redisService.delCache(cacheKey);
        throw new NotFoundException(`상품 ID ${id}를 찾을 수 없습니다.`);
      }
      // EC7: 승인되지 않았거나 비공개 상태인 상품은 구매자에게 노출 차단
      if (
        exists.approvalStatus !== ApprovalStatus.APPROVED ||
        exists.status === ProductStatus.HIDDEN ||
        exists.status === ProductStatus.DISCONTINUED
      ) {
        await this.redisService.delCache(cacheKey);
        throw new NotFoundException(`상품 ID ${id}를 찾을 수 없습니다.`);
      }

      await this.productRepository.increment({ id }, 'viewCount', 1);
      return { ...cached, viewCount: (cached.viewCount ?? 0) + 1 };
    }

    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['images', 'category', 'seller', 'tags'],
    });
    if (!product) {
      throw new NotFoundException(`상품 ID ${id}를 찾을 수 없습니다.`);
    }
    // EC7: 비승인/비공개 상품 조회 차단 (DB 직접 조회 경로)
    if (
      product.approvalStatus !== ApprovalStatus.APPROVED ||
      product.status === ProductStatus.HIDDEN ||
      product.status === ProductStatus.DISCONTINUED
    ) {
      throw new NotFoundException(`상품 ID ${id}를 찾을 수 없습니다.`);
    }
    await this.productRepository.increment({ id }, 'viewCount', 1);
    product.viewCount += 1;

    await this.redisService.setCache(cacheKey, product, ProductService.CACHE_TTL_DETAIL);
    return product;
  }

  /** 셀러: 본인 상품 목록 (모든 상태) */
  async findMyProducts(userId: number, query: ProductQueryDto) {
    const seller = await this.getApprovedSeller(userId);

    const fixedWhere: FindOptionsWhere<ProductEntity> = { sellerId: seller.id };
    if (query.categoryId)    fixedWhere.categoryId    = query.categoryId;
    if (query.status)        fixedWhere.status        = query.status;
    if (query.approvalStatus) fixedWhere.approvalStatus = query.approvalStatus;

    return this.commonService.paginate(
      query,
      this.productRepository,
      'products/my',
      { where: fixedWhere, relations: ['images', 'category'] },
    );
  }

  /** 셀러: 상품 등록 (approvalStatus = PENDING) */
  async create(dto: CreateProductDto, userId: number): Promise<ProductEntity> {
    const seller = await this.getApprovedSeller(userId);

    const product = await this.dataSource.transaction(async (manager) => {
      const entity = manager.create(ProductEntity, {
        name: dto.name,
        description: dto.description,
        price: dto.price,
        brand: dto.brand,
        stockQuantity: dto.stockQuantity ?? 0,
        isEvent: dto.isEvent ?? false,
        discountRate: dto.discountRate,
        categoryId: dto.categoryId ?? null,
        salesType: dto.salesType,
        sellerId: seller.id,
        status: ProductStatus.DRAFT,
        approvalStatus: ApprovalStatus.PENDING,
      });
      return manager.save(entity);
    });

    this.eventEmitter.emit('product.created', new ProductCreatedEvent(product.id, seller.id));
    return product;
  }

  /** 셀러: 본인 상품 수정 */
  async update(id: number, dto: UpdateProductDto, userId: number): Promise<ProductEntity> {
    const seller = await this.getApprovedSeller(userId);

    const saved = await this.dataSource.transaction(async (manager) => {
      const product = await manager.findOne(ProductEntity, { where: { id } });
      if (!product) {
        throw new NotFoundException(`상품 ID ${id}를 찾을 수 없습니다.`);
      }
      if (product.sellerId !== seller.id) {
        throw new ForbiddenException('본인의 상품만 수정할 수 있습니다.');
      }

      Object.assign(product, {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.brand !== undefined && { brand: dto.brand }),
        ...(dto.stockQuantity !== undefined && { stockQuantity: dto.stockQuantity }),
        ...(dto.isEvent !== undefined && { isEvent: dto.isEvent }),
        ...(dto.discountRate !== undefined && { discountRate: dto.discountRate }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.salesType !== undefined && { salesType: dto.salesType }),
      });

      // EC1: 승인된 상품을 수정하면 재검토가 필요하므로 approvalStatus를 PENDING으로 초기화
      if (product.approvalStatus === ApprovalStatus.APPROVED) {
        product.approvalStatus = ApprovalStatus.PENDING;
        product.approvedAt = null;
      }

      return manager.save(product);
    });

    // 캐시 무효화 (상세 + 목록)
    await this.redisService.delCache(`products:detail:${id}`);
    await this.redisService.delCacheByPattern('products:list:*');

    return saved;
  }

  /** 셀러: 본인 상품 삭제 */
  async remove(id: number, userId: number): Promise<void> {
    const seller = await this.getApprovedSeller(userId);
    const product = await this.productRepository.findOne({ where: { id } });
    if (!product) {
      throw new NotFoundException(`상품 ID ${id}를 찾을 수 없습니다.`);
    }
    if (product.sellerId !== seller.id) {
      throw new ForbiddenException('본인의 상품만 삭제할 수 있습니다.');
    }

    // EC4: 판매 중인 상품은 즉시 삭제 불가 — 먼저 HIDDEN/DISCONTINUED로 변경해야 함
    if (product.status === ProductStatus.PUBLISHED) {
      throw new BadRequestException(
        '판매 중인 상품은 삭제할 수 없습니다. 먼저 상품을 숨김 처리하거나 판매 중지 상태로 변경해주세요.',
      );
    }

    // EC5: 주문 이력이 있는 상품은 삭제 불가 — FK 제약 위반 방지
    const orderItemCount = await this.orderItemRepository.count({
      where: { productId: id },
    });
    if (orderItemCount > 0) {
      throw new BadRequestException(
        '주문 이력이 있는 상품은 삭제할 수 없습니다. 판매 중지(DISCONTINUED) 상태로 변경해주세요.',
      );
    }

    await this.productRepository.remove(product);

    // 캐시 무효화
    await this.redisService.delCache(`products:detail:${id}`);
    await this.redisService.delCacheByPattern('products:list:*');
  }

  /** 셀러: 본인 상품 이미지 추가 */
  async addImage(productId: number, userId: number, file: Express.Multer.File): Promise<ProductImageEntity> {
    // EC2: Multer 파이프라인 실패 등으로 file이 undefined인 경우 방어
    if (!file) {
      throw new BadRequestException('업로드할 이미지 파일이 없습니다.');
    }

    const seller = await this.getApprovedSeller(userId);
    const product = await this.productRepository.findOne({
      where: { id: productId },
      relations: ['images'],
    });
    if (!product) {
      throw new NotFoundException(`상품 ID ${productId}를 찾을 수 없습니다.`);
    }
    if (product.sellerId !== seller.id) {
      throw new ForbiddenException('본인의 상품에만 이미지를 추가할 수 있습니다.');
    }

    // EC3: 상품당 최대 이미지 수 제한
    if (product.images.length >= ProductService.MAX_IMAGES_PER_PRODUCT) {
      throw new BadRequestException(
        `이미지는 상품당 최대 ${ProductService.MAX_IMAGES_PER_PRODUCT}장까지 등록할 수 있습니다.`,
      );
    }

    const isPrimary = product.images.length === 0;
    const sortOrder = product.images.length;

    const image = this.productImageRepository.create({
      url: `/uploads/${file.filename}`,
      isPrimary,
      sortOrder,
      product,
    });
    return this.productImageRepository.save(image);
  }

  // ──────────── 관리자 메서드 ────────────

  /** 관리자: 전체 상품 조회 (모든 상태) */
  async findAllAdmin(query: ProductQueryDto) {
    const fixedWhere: FindOptionsWhere<ProductEntity> = {};
    if (query.categoryId)     fixedWhere.categoryId     = query.categoryId;
    if (query.status)         fixedWhere.status         = query.status;
    if (query.approvalStatus) fixedWhere.approvalStatus = query.approvalStatus;
    if (query.sellerId)       fixedWhere.sellerId       = query.sellerId;

    return this.commonService.paginate(
      query,
      this.productRepository,
      'admin/products',
      { where: fixedWhere, relations: ['images', 'category', 'seller'] },
    );
  }

  /**
   * (AI 어시스턴트 5a) 카테고리 ID 목록에 속한 상품 ID만 반환 (읽기 전용, id만 select).
   * - 디스패처가 categoryName→categoryIds→productIds 변환 체인에서 사용.
   * - 빈 입력이면 빈 배열. 상품 핵심 row 전체를 끌어오지 않고 id 컬럼만 조회.
   */
  async getProductIdsByCategoryIds(categoryIds: number[]): Promise<number[]> {
    if (categoryIds.length === 0) return [];
    const rows = await this.productRepository.find({
      where: { categoryId: In(categoryIds) },
      select: ['id'],
    });
    return rows.map((p) => p.id);
  }

  /** 관리자: 상품 승인 */
  async approve(productId: number): Promise<ProductEntity> {
    const product = await this.dataSource.transaction(async (manager) => {
      const entity = await manager.findOne(ProductEntity, { where: { id: productId } });
      if (!entity) {
        throw new NotFoundException(`상품 ID ${productId}를 찾을 수 없습니다.`);
      }
      if (entity.approvalStatus !== ApprovalStatus.PENDING) {
        throw new BadRequestException('대기 중인 상품만 승인할 수 있습니다.');
      }

      entity.approvalStatus = ApprovalStatus.APPROVED;
      entity.approvedAt = new Date();
      entity.rejectionReason = null;
      return manager.save(entity);
    });

    // 캐시 무효화: 승인 후 buyer 목록에 노출되어야 함
    await this.redisService.delCache(`products:detail:${product.id}`);
    await this.redisService.delCacheByPattern('products:list:*');

    this.eventEmitter.emit('product.approved', new ProductApprovedEvent(product.id, product.sellerId ?? 0));
    return product;
  }

  /** 관리자: 상품 거절 */
  async reject(productId: number, reason: string): Promise<ProductEntity> {
    const product = await this.dataSource.transaction(async (manager) => {
      const entity = await manager.findOne(ProductEntity, { where: { id: productId } });
      if (!entity) {
        throw new NotFoundException(`상품 ID ${productId}를 찾을 수 없습니다.`);
      }
      if (entity.approvalStatus !== ApprovalStatus.PENDING) {
        throw new BadRequestException('대기 중인 상품만 거절할 수 있습니다.');
      }

      entity.approvalStatus = ApprovalStatus.REJECTED;
      entity.rejectionReason = reason;
      return manager.save(entity);
    });

    // 캐시 무효화: 거절 후 buyer 목록에서 제외되어야 함
    await this.redisService.delCache(`products:detail:${product.id}`);
    await this.redisService.delCacheByPattern('products:list:*');

    this.eventEmitter.emit('product.rejected', new ProductRejectedEvent(product.id, product.sellerId ?? 0, reason));
    return product;
  }
}
