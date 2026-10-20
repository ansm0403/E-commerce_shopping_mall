import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CategoryController, AdminCategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { CategoryEntity } from './entity/category.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

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

const mockCategoryService = {
  getCategoryTree: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateVisibility: jest.fn(),
  remove: jest.fn(),
};

describe('CategoryController (공개 API)', () => {
  let controller: CategoryController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoryController],
      providers: [{ provide: CategoryService, useValue: mockCategoryService }],
    }).compile();

    controller = module.get<CategoryController>(CategoryController);
  });

  describe('GET /categories', () => {
    it('카테고리 트리를 반환한다', async () => {
      const tree = [{ id: 1, name: '모자', slug: 'hats', depth: 0, sortOrder: 0, children: [] }];
      mockCategoryService.getCategoryTree.mockResolvedValue(tree);

      const result = await controller.getCategoryTree();

      expect(result).toEqual(tree);
    });
  });
});

describe('AdminCategoryController (어드민 API)', () => {
  let controller: AdminCategoryController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminCategoryController],
      providers: [{ provide: CategoryService, useValue: mockCategoryService }],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminCategoryController>(AdminCategoryController);
  });

  describe('POST /admin/categories', () => {
    it('카테고리를 생성한다', async () => {
      const dto = { name: '신발', slug: 'shoes' };
      const created = mockCategory({ id: 5, name: '신발', slug: 'shoes', path: '/5/' });
      mockCategoryService.create.mockResolvedValue(created);

      const result = await controller.create(dto);

      expect(result).toEqual(created);
      expect(mockCategoryService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('PATCH /admin/categories/:id', () => {
    it('카테고리를 수정한다', async () => {
      const updated = mockCategory({ name: '수정됨' });
      mockCategoryService.update.mockResolvedValue(updated);

      const result = await controller.update(1, { name: '수정됨' });

      expect(result.name).toBe('수정됨');
    });
  });

  describe('PATCH /admin/categories/:id/visibility', () => {
    it('노출 여부를 변경한다', async () => {
      const updated = mockCategory({ isVisible: false });
      mockCategoryService.updateVisibility.mockResolvedValue(updated);

      const result = await controller.updateVisibility(1, { isVisible: false });

      expect(result.isVisible).toBe(false);
      expect(mockCategoryService.updateVisibility).toHaveBeenCalledWith(1, false);
    });
  });

  describe('DELETE /admin/categories/:id', () => {
    it('하위 없는 카테고리를 삭제한다', async () => {
      mockCategoryService.remove.mockResolvedValue(undefined);

      await expect(controller.remove(1)).resolves.toBeUndefined();
    });

    it('하위 존재 시 삭제 불가 → BadRequestException', async () => {
      mockCategoryService.remove.mockRejectedValue(new BadRequestException());

      await expect(controller.remove(1)).rejects.toThrow(BadRequestException);
    });
  });
});
