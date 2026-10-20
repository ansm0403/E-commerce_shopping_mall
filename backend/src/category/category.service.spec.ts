import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CategoryService } from './category.service';
import { CategoryEntity } from './entity/category.entity';

// ─── 픽스처 ───────────────────────────────────────────
const mockCategory = (overrides: Partial<CategoryEntity> = {}): CategoryEntity => ({
  id: 1,
  name: '모자',
  slug: 'hats',
  parentId: null,
  parent: null,
  children: [],
  products: [],
  path: '/1/',
  depth: 0,
  sortOrder: 0,
  isVisible: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mockRepository = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  count: jest.fn(),
};

/** 트랜잭션 내부 repository mock */
const mockTxRepository = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockDataSource = {
  transaction: jest.fn((cb: (manager: any) => Promise<any>) =>
    cb({ getRepository: () => mockTxRepository }),
  ),
};

describe('CategoryService', () => {
  let service: CategoryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDataSource.transaction.mockImplementation((cb: (manager: any) => Promise<any>) =>
      cb({ getRepository: () => mockTxRepository }),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryService,
        { provide: getRepositoryToken(CategoryEntity), useValue: mockRepository },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<CategoryService>(CategoryService);
  });

  // ─── getCategoryTree ────────────────────────────────
  describe('getCategoryTree', () => {
    it('flat 데이터를 트리 구조로 변환하여 반환한다', async () => {
      const flat = [
        mockCategory({ id: 1, name: '모자', slug: 'hats', parentId: null, path: '/1/', depth: 0 }),
        mockCategory({ id: 2, name: '스냅백', slug: 'snapback', parentId: 1, path: '/1/2/', depth: 1 }),
        mockCategory({ id: 3, name: '플랫브림', slug: 'flat-brim', parentId: 2, path: '/1/2/3/', depth: 2 }),
      ];
      mockRepository.find.mockResolvedValue(flat);

      const result = await service.getCategoryTree();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('모자');
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].name).toBe('스냅백');
      expect(result[0].children[0].children).toHaveLength(1);
      expect(result[0].children[0].children[0].name).toBe('플랫브림');
    });

    it('is_visible = true인 것만 조회한다', async () => {
      mockRepository.find.mockResolvedValue([]);

      await service.getCategoryTree();

      expect(mockRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isVisible: true } }),
      );
    });
  });

  // ─── create ─────────────────────────────────────────
  describe('create', () => {
    it('최상위 카테고리를 생성한다 — path = /id/', async () => {
      const dto = { name: '신발', slug: 'shoes' };
      const saved = mockCategory({ id: 5, name: '신발', slug: 'shoes', path: '/' });
      const withPath = { ...saved, path: '/5/' };

      // EC6: slug 중복 체크 — 중복 없음
      mockRepository.findOne.mockResolvedValue(null);
      mockTxRepository.create.mockReturnValue(saved);
      mockTxRepository.save
        .mockResolvedValueOnce(saved)    // 1단계: INSERT
        .mockResolvedValueOnce(withPath); // 2단계: path UPDATE

      const result = await service.create(dto);

      expect(result.path).toBe('/5/');
      expect(mockTxRepository.save).toHaveBeenCalledTimes(2);
    });

    it('하위 카테고리를 생성한다 — path = 부모path + id/', async () => {
      const parent = mockCategory({ id: 1, path: '/1/' });
      const dto = { name: '스니커즈', slug: 'sneakers', parentId: 1 };
      const saved = mockCategory({ id: 10, name: '스니커즈', slug: 'sneakers', parentId: 1, path: '/' });
      const withPath = { ...saved, path: '/1/10/' };

      // slug 중복 체크 → 없음, parentId 조회 → parent
      mockRepository.findOne
        .mockResolvedValueOnce(null)    // slug 중복 체크
        .mockResolvedValueOnce(parent); // parent 조회
      mockTxRepository.create.mockReturnValue(saved);
      mockTxRepository.save
        .mockResolvedValueOnce(saved)
        .mockResolvedValueOnce(withPath);

      const result = await service.create(dto);

      expect(result.path).toBe('/1/10/');
    });

    it('depth = 부모depth + 1로 자동 설정된다', async () => {
      const parent = mockCategory({ id: 1, path: '/1/', depth: 0 });
      const dto = { name: '하위', slug: 'child', parentId: 1 };

      mockRepository.findOne
        .mockResolvedValueOnce(null)    // slug 중복 체크
        .mockResolvedValueOnce(parent); // parent 조회
      mockTxRepository.create.mockImplementation((data) => ({ ...mockCategory(), ...data }));
      mockTxRepository.save.mockImplementation(async (entity) => entity);

      await service.create(dto);

      expect(mockTxRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ depth: 1 }),
      );
    });

    it('존재하지 않는 parentId → NotFoundException', async () => {
      mockRepository.findOne
        .mockResolvedValueOnce(null)   // slug 중복 체크
        .mockResolvedValueOnce(null);  // parent 조회 → 없음

      await expect(service.create({ name: '하위', slug: 'child', parentId: 999 }))
        .rejects.toThrow(NotFoundException);
    });

    // EC6: slug 중복 방어
    it('[EC6] 이미 존재하는 slug로 생성하면 BadRequestException을 던진다', async () => {
      const existing = mockCategory({ slug: 'shoes' });
      mockRepository.findOne.mockResolvedValue(existing);

      await expect(service.create({ name: '신발', slug: 'shoes' }))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ─── update ─────────────────────────────────────────
  describe('update', () => {
    it('이름과 slug를 수정한다', async () => {
      const category = mockCategory();
      const updated = { ...category, name: '캡모자', slug: 'caps' };
      mockRepository.findOne.mockResolvedValue(category);
      mockRepository.save.mockResolvedValue(updated);

      const result = await service.update(1, { name: '캡모자', slug: 'caps' });

      expect(result.name).toBe('캡모자');
      expect(result.slug).toBe('caps');
    });

    it('존재하지 않는 ID → NotFoundException', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.update(999, { name: '수정' })).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateVisibility ───────────────────────────────
  describe('updateVisibility', () => {
    it('노출 여부를 false로 변경한다', async () => {
      const category = mockCategory({ isVisible: true });
      const updated = { ...category, isVisible: false };
      mockRepository.findOne.mockResolvedValue(category);
      mockRepository.save.mockResolvedValue(updated);

      const result = await service.updateVisibility(1, false);

      expect(result.isVisible).toBe(false);
    });

    it('존재하지 않는 ID → NotFoundException', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.updateVisibility(999, false)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── remove ─────────────────────────────────────────
  describe('remove', () => {
    it('하위 카테고리가 없으면 삭제한다', async () => {
      const category = mockCategory({ path: '/1/' });
      mockRepository.findOne.mockResolvedValue(category);
      mockRepository.count.mockResolvedValue(1); // 자기 자신만
      mockRepository.remove.mockResolvedValue(undefined);

      await expect(service.remove(1)).resolves.toBeUndefined();
      expect(mockRepository.remove).toHaveBeenCalledWith(category);
    });

    it('하위 카테고리가 존재하면 삭제 불가 → BadRequestException', async () => {
      const category = mockCategory({ path: '/1/' });
      mockRepository.findOne.mockResolvedValue(category);
      mockRepository.count.mockResolvedValue(3); // 자기 + 하위 2개

      await expect(service.remove(1)).rejects.toThrow(BadRequestException);
      expect(mockRepository.remove).not.toHaveBeenCalled();
    });

    it('존재하지 않는 ID → NotFoundException', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    });
  });
});
