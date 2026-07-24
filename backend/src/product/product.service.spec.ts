import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

// circular dependency 방지: OrderEntity → ShipmentEntity → OrderEntity 순환 차단
jest.mock('../order/entity/order.entity', () => ({
  OrderEntity: class OrderEntity {},
  OrderStatus: { PENDING: 'pending', PREPARING: 'preparing', SHIPPED: 'shipped', DELIVERED: 'delivered', COMPLETED: 'completed', CANCELLED: 'cancelled' },
}));

import { ProductService } from './product.service';
import { ProductEntity, ProductStatus, ApprovalStatus, SalesType } from './entity/product.entity';
import { ProductImageEntity } from './entity/product-image.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import { SellerEntity, SellerStatus } from '../seller/entity/seller.entity';
import { CategoryEntity } from '../category/entity/category.entity';
import { RedisService } from '../intrastructure/redis/redis.service';
import { CommonService } from '../common/common.service';
import { PRODUCT_SEARCH_SERVICE } from './interfaces/product-search.interface';

const mockProduct = (overrides: Partial<ProductEntity> = {}): ProductEntity =>
  ({
    id: 1,
    name: '테스트 상품',
    description: '설명',
    price: 10000,
    brand: '브랜드',
    stockQuantity: 10,
    isEvent: false,
    discountRate: null,
    rating: null,
    specs: {},
    status: ProductStatus.DRAFT,
    approvalStatus: ApprovalStatus.PENDING,
    salesType: SalesType.NORMAL,
    rejectionReason: null,
    approvedAt: null,
    salesCount: 0,
    viewCount: 0,
    sellerId: 1,
    categoryId: null,
    images: [],
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProductEntity);

const mockSeller = (overrides: Partial<SellerEntity> = {}): SellerEntity =>
  ({
    id: 1,
    userId: 100,
    businessName: '테스트 사업자',
    status: SellerStatus.APPROVED,
    ...overrides,
  } as SellerEntity);

const createQueryBuilder: any = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
};

const mockProductRepository = {
  createQueryBuilder: jest.fn().mockReturnValue(createQueryBuilder),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  increment: jest.fn(),
};

const mockImageRepository = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockSellerRepository = {
  findOne: jest.fn(),
};

const mockOrderItemRepository = {
  count: jest.fn(),
};

const mockCategoryRepository = {
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
};

/** 트랜잭션 내부에서 사용되는 EntityManager mock */
const mockManager = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
};

const mockDataSource = {
  transaction: jest.fn((cb: (manager: any) => Promise<any>) => cb(mockManager)),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const mockRedisService = {
  getCache: jest.fn().mockResolvedValue(null),
  setCache: jest.fn().mockResolvedValue(undefined),
  delCache: jest.fn().mockResolvedValue(undefined),
  delCacheByPattern: jest.fn().mockResolvedValue(undefined),
};

/** 목록 조회는 QueryBuilder가 아니라 CommonService.paginate에 위임된다 */
const mockCommonService = {
  paginate: jest.fn(),
};

const mockSearchService = {
  search: jest.fn(),
};

describe('ProductService', () => {
  let service: ProductService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockProductRepository.createQueryBuilder.mockReturnValue(createQueryBuilder);
    createQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
    mockDataSource.transaction.mockImplementation((cb: (manager: any) => Promise<any>) => cb(mockManager));
    mockRedisService.getCache.mockResolvedValue(null);
    mockCommonService.paginate.mockResolvedValue({ data: [], meta: { total: 0 } });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: getRepositoryToken(ProductEntity), useValue: mockProductRepository },
        { provide: getRepositoryToken(ProductImageEntity), useValue: mockImageRepository },
        { provide: getRepositoryToken(SellerEntity), useValue: mockSellerRepository },
        { provide: getRepositoryToken(OrderItemEntity), useValue: mockOrderItemRepository },
        { provide: getRepositoryToken(CategoryEntity), useValue: mockCategoryRepository },
        { provide: DataSource, useValue: mockDataSource },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: RedisService, useValue: mockRedisService },
        { provide: CommonService, useValue: mockCommonService },
        { provide: PRODUCT_SEARCH_SERVICE, useValue: mockSearchService },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
  });

  // ──────────── 구매자 조회 ────────────

  describe('findAll', () => {
    it('상품 목록을 페이지네이션과 함께 반환한다', async () => {
      const products = [mockProduct({ approvalStatus: ApprovalStatus.APPROVED, status: ProductStatus.PUBLISHED })];
      mockCommonService.paginate.mockResolvedValue({ data: products, meta: { total: 1 } });

      const result = await service.findAll({ page: 1, take: 20 }) as any;

      expect(result.data).toEqual(products);
      expect(result.meta.total).toBe(1);
    });

    it('기본적으로 approvalStatus=APPROVED + PUBLISHED 필터를 적용한다', async () => {
      await service.findAll({ page: 1, take: 20 });

      expect(mockCommonService.paginate).toHaveBeenCalledWith(
        expect.anything(),
        mockProductRepository,
        'products',
        expect.objectContaining({
          where: expect.objectContaining({
            approvalStatus: ApprovalStatus.APPROVED,
            status: ProductStatus.PUBLISHED,
          }),
        }),
      );
    });

    it('keyword가 있으면 검색 서비스로 위임한다', async () => {
      const found = { data: [mockProduct()], meta: { total: 1 } };
      mockSearchService.search.mockResolvedValue(found);

      const result = await service.findAll({ page: 1, take: 20, keyword: '노트북' });

      expect(result).toEqual(found);
      expect(mockSearchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: '노트북' }),
      );
      expect(mockCommonService.paginate).not.toHaveBeenCalled();
    });
  });

  // ──────────── 상세 조회 ────────────

  describe('findOne', () => {
    it('존재하는 상품을 반환하고 viewCount를 증가시킨다', async () => {
      const product = mockProduct({
        approvalStatus: ApprovalStatus.APPROVED,
        status: ProductStatus.PUBLISHED,
      });
      mockProductRepository.findOne.mockResolvedValue(product);
      mockProductRepository.increment.mockResolvedValue(undefined);

      const result = await service.findOne(1);

      expect(result).toEqual(product);
      expect(mockProductRepository.increment).toHaveBeenCalledWith({ id: 1 }, 'viewCount', 1);
    });

    it('존재하지 않으면 NotFoundException을 던진다', async () => {
      mockProductRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });

    // EC7: 비승인/비공개 상품 조회 차단
    it('[EC7] 미승인(PENDING) 상품은 NotFoundException을 던진다', async () => {
      const product = mockProduct({ approvalStatus: ApprovalStatus.PENDING });
      mockProductRepository.findOne.mockResolvedValue(product);

      await expect(service.findOne(1)).rejects.toThrow(NotFoundException);
    });

    it('[EC7] HIDDEN 상품은 NotFoundException을 던진다', async () => {
      const product = mockProduct({
        approvalStatus: ApprovalStatus.APPROVED,
        status: ProductStatus.HIDDEN,
      });
      mockProductRepository.findOne.mockResolvedValue(product);

      await expect(service.findOne(1)).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────── 셀러: 본인 상품 목록 ────────────

  describe('findMyProducts', () => {
    it('승인된 셀러의 본인 상품 목록을 반환한다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);
      const products = [mockProduct({ sellerId: 1 })];
      mockCommonService.paginate.mockResolvedValue({ data: products, meta: { total: 1 } });

      const result = await service.findMyProducts(100, { page: 1, take: 20 }) as any;

      expect(result.data).toEqual(products);
      expect(mockCommonService.paginate).toHaveBeenCalledWith(
        expect.anything(),
        mockProductRepository,
        'products/my',
        expect.objectContaining({ where: expect.objectContaining({ sellerId: 1 }) }),
      );
    });

    it('미승인 셀러는 ForbiddenException을 던진다', async () => {
      mockSellerRepository.findOne.mockResolvedValue(null);

      await expect(service.findMyProducts(100, {})).rejects.toThrow(ForbiddenException);
    });
  });

  // ──────────── 셀러: 상품 등록 ────────────

  describe('create', () => {
    it('승인된 셀러가 상품을 등록하면 PENDING 상태로 생성된다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const dto = { name: '신상품', description: '설명', price: 5000, brand: '브랜드' };
      const product = mockProduct({ ...dto, sellerId: 1 });
      mockManager.create.mockReturnValue(product);
      mockManager.save.mockResolvedValue(product);

      const result = await service.create(dto, 100);

      expect(result.sellerId).toBe(1);
      expect(mockManager.create).toHaveBeenCalledWith(
        ProductEntity,
        expect.objectContaining({
          status: ProductStatus.DRAFT,
          approvalStatus: ApprovalStatus.PENDING,
          sellerId: 1,
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'product.created',
        expect.objectContaining({ productId: 1, sellerId: 1 }),
      );
    });

    it('미승인 셀러는 상품을 등록할 수 없다', async () => {
      mockSellerRepository.findOne.mockResolvedValue(null);
      const dto = { name: '신상품', description: '설명', price: 5000, brand: '브랜드' };

      await expect(service.create(dto, 100)).rejects.toThrow(ForbiddenException);
    });
  });

  // ──────────── 셀러: 상품 수정 ────────────

  describe('update', () => {
    it('본인 상품을 수정한다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({ sellerId: 1 });
      const updated = mockProduct({ name: '수정됨', sellerId: 1 });
      mockManager.findOne.mockResolvedValue(product);
      mockManager.save.mockResolvedValue(updated);

      const result = await service.update(1, { name: '수정됨' }, 100);

      expect(result.name).toBe('수정됨');
    });

    it('타인 상품 수정 시 ForbiddenException을 던진다', async () => {
      const seller = mockSeller({ id: 2, userId: 200 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({ sellerId: 1 });
      mockManager.findOne.mockResolvedValue(product);

      await expect(service.update(1, { name: '수정' }, 200)).rejects.toThrow(ForbiddenException);
    });

    it('존재하지 않는 상품은 NotFoundException을 던진다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);
      mockManager.findOne.mockResolvedValue(null);

      await expect(service.update(999, {}, 100)).rejects.toThrow(NotFoundException);
    });

    // EC1: 승인된 상품 수정 시 재검토 로직
    it('[EC1] 승인된 상품을 수정하면 approvalStatus가 PENDING으로 초기화된다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({
        sellerId: 1,
        approvalStatus: ApprovalStatus.APPROVED,
        approvedAt: new Date(),
      });
      mockManager.findOne.mockResolvedValue(product);
      mockManager.save.mockImplementation(async (p: any) => p);

      const result = await service.update(1, { price: 9000 }, 100);

      expect(result.approvalStatus).toBe(ApprovalStatus.PENDING);
      expect(result.approvedAt).toBeNull();
    });

    it('[EC1] 승인된 상품 수정 후 상세 캐시가 무효화된다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({ sellerId: 1, approvalStatus: ApprovalStatus.APPROVED });
      mockManager.findOne.mockResolvedValue(product);
      mockManager.save.mockImplementation(async (p: any) => p);

      await service.update(1, { name: '변경' }, 100);

      expect(mockRedisService.delCache).toHaveBeenCalledWith('products:detail:1');
    });

    it('[EC1] PENDING 상품은 수정해도 approvalStatus가 변경되지 않는다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({ sellerId: 1, approvalStatus: ApprovalStatus.PENDING });
      mockManager.findOne.mockResolvedValue(product);
      mockManager.save.mockImplementation(async (p: any) => p);

      const result = await service.update(1, { price: 9000 }, 100);

      expect(result.approvalStatus).toBe(ApprovalStatus.PENDING);
    });
  });

  // ──────────── 셀러: 상품 삭제 ────────────

  describe('remove', () => {
    it('본인 상품을 삭제한다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({ sellerId: 1 });
      mockProductRepository.findOne.mockResolvedValue(product);
      mockOrderItemRepository.count.mockResolvedValue(0);
      mockProductRepository.remove.mockResolvedValue(undefined);

      await expect(service.remove(1, 100)).resolves.toBeUndefined();
      expect(mockProductRepository.remove).toHaveBeenCalledWith(product);
    });

    it('타인 상품 삭제 시 ForbiddenException을 던진다', async () => {
      const seller = mockSeller({ id: 2, userId: 200 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({ sellerId: 1 });
      mockProductRepository.findOne.mockResolvedValue(product);

      await expect(service.remove(1, 200)).rejects.toThrow(ForbiddenException);
    });

    // EC4: PUBLISHED 상품 삭제 차단
    it('[EC4] PUBLISHED 상태의 상품은 삭제할 수 없다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({ sellerId: 1, status: ProductStatus.PUBLISHED });
      mockProductRepository.findOne.mockResolvedValue(product);

      await expect(service.remove(1, 100)).rejects.toThrow(BadRequestException);
      expect(mockProductRepository.remove).not.toHaveBeenCalled();
    });

    // EC5: 주문 이력이 있는 상품 삭제 차단
    it('[EC5] 주문 이력이 있는 상품은 삭제할 수 없다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({ sellerId: 1, status: ProductStatus.DRAFT });
      mockProductRepository.findOne.mockResolvedValue(product);
      mockOrderItemRepository.count.mockResolvedValue(3);

      await expect(service.remove(1, 100)).rejects.toThrow(BadRequestException);
      expect(mockProductRepository.remove).not.toHaveBeenCalled();
    });

    it('[EC5] 주문 이력이 없으면 정상 삭제된다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({ sellerId: 1, status: ProductStatus.DRAFT });
      mockProductRepository.findOne.mockResolvedValue(product);
      mockOrderItemRepository.count.mockResolvedValue(0);
      mockProductRepository.remove.mockResolvedValue(undefined);

      await expect(service.remove(1, 100)).resolves.toBeUndefined();
      expect(mockProductRepository.remove).toHaveBeenCalledWith(product);
    });

    it('[EC4] 삭제 후 상세 캐시가 무효화된다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({ sellerId: 1, status: ProductStatus.DRAFT });
      mockProductRepository.findOne.mockResolvedValue(product);
      mockOrderItemRepository.count.mockResolvedValue(0);
      mockProductRepository.remove.mockResolvedValue(undefined);

      await service.remove(1, 100);

      expect(mockRedisService.delCache).toHaveBeenCalledWith('products:detail:1');
    });
  });

  // ──────────── 셀러: 이미지 추가 ────────────

  describe('addImage', () => {
    const mockFile = { filename: 'test.jpg' } as any;

    it('[EC2] file이 undefined이면 BadRequestException을 던진다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      await expect(
        service.addImage(1, 100, undefined as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('[EC3] 이미지가 10장이면 추가 시 BadRequestException을 던진다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const images = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
      const product = mockProduct({ sellerId: 1, images: images as any });
      mockProductRepository.findOne.mockResolvedValue(product);

      await expect(service.addImage(1, 100, mockFile)).rejects.toThrow(BadRequestException);
      expect(mockImageRepository.save).not.toHaveBeenCalled();
    });

    it('이미지가 없으면 첫 번째 이미지는 isPrimary=true로 저장된다', async () => {
      const seller = mockSeller({ id: 1, userId: 100 });
      mockSellerRepository.findOne.mockResolvedValue(seller);

      const product = mockProduct({ sellerId: 1, images: [] });
      mockProductRepository.findOne.mockResolvedValue(product);

      const savedImage = { id: 1, url: '/uploads/test.jpg', isPrimary: true, sortOrder: 0 };
      mockImageRepository.create.mockReturnValue(savedImage);
      mockImageRepository.save.mockResolvedValue(savedImage);

      const result = await service.addImage(1, 100, mockFile);

      expect(mockImageRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isPrimary: true, sortOrder: 0 }),
      );
      expect(result.isPrimary).toBe(true);
    });
  });

  // ──────────── 관리자: 전체 조회 ────────────

  describe('findAllAdmin', () => {
    it('모든 상태의 상품을 조회한다', async () => {
      const products = [
        mockProduct({ approvalStatus: ApprovalStatus.PENDING }),
        mockProduct({ id: 2, approvalStatus: ApprovalStatus.APPROVED }),
      ];
      mockCommonService.paginate.mockResolvedValue({ data: products, meta: { total: 2 } });

      const result = await service.findAllAdmin({ page: 1, take: 20 }) as any;

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });

    it('approvalStatus 필터를 적용할 수 있다', async () => {
      await service.findAllAdmin({ page: 1, take: 20, approvalStatus: ApprovalStatus.PENDING });

      expect(mockCommonService.paginate).toHaveBeenCalledWith(
        expect.anything(),
        mockProductRepository,
        'admin/products',
        expect.objectContaining({
          where: expect.objectContaining({ approvalStatus: ApprovalStatus.PENDING }),
        }),
      );
    });
  });

  // ──────────── 관리자: 승인 ────────────

  describe('approve', () => {
    it('대기 중인 상품을 승인한다', async () => {
      const product = mockProduct({ approvalStatus: ApprovalStatus.PENDING });
      mockManager.findOne.mockResolvedValue(product);
      mockManager.save.mockResolvedValue({
        ...product,
        approvalStatus: ApprovalStatus.APPROVED,
        approvedAt: expect.any(Date),
      });

      await service.approve(1);

      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalStatus: ApprovalStatus.APPROVED,
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'product.approved',
        expect.objectContaining({ productId: 1 }),
      );
    });

    it('이미 승인된 상품은 BadRequestException을 던진다', async () => {
      const product = mockProduct({ approvalStatus: ApprovalStatus.APPROVED });
      mockManager.findOne.mockResolvedValue(product);

      await expect(service.approve(1)).rejects.toThrow(BadRequestException);
    });

    it('존재하지 않는 상품은 NotFoundException을 던진다', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(service.approve(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ──────────── 관리자: 거절 ────────────

  describe('reject', () => {
    it('대기 중인 상품을 거절하고 사유를 기록한다', async () => {
      const product = mockProduct({ approvalStatus: ApprovalStatus.PENDING });
      mockManager.findOne.mockResolvedValue(product);
      mockManager.save.mockResolvedValue({
        ...product,
        approvalStatus: ApprovalStatus.REJECTED,
        rejectionReason: '상품 설명 부족',
      });

      await service.reject(1, '상품 설명 부족');

      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalStatus: ApprovalStatus.REJECTED,
          rejectionReason: '상품 설명 부족',
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'product.rejected',
        expect.objectContaining({ productId: 1, reason: '상품 설명 부족' }),
      );
    });

    it('이미 거절된 상품은 BadRequestException을 던진다', async () => {
      const product = mockProduct({ approvalStatus: ApprovalStatus.REJECTED });
      mockManager.findOne.mockResolvedValue(product);

      await expect(service.reject(1, '사유')).rejects.toThrow(BadRequestException);
    });
  });
});
