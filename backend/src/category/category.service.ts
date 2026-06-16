import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Like, Repository } from 'typeorm';
import { CategoryEntity } from './entity/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

export interface CategoryTreeNode {
  id: number;
  name: string;
  slug: string;
  depth: number;
  sortOrder: number;
  children: CategoryTreeNode[];
}

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
    private readonly dataSource: DataSource,
  ) {}

  // ─── 공개 API ─────────────────────────────────────────

  /**
   * 전체 카테고리 트리 조회 (is_visible = true만)
   * DB에서 flat하게 꺼낸 후 메모리에서 트리 조립
   */
  async getCategoryTree(): Promise<CategoryTreeNode[]> {
    const all = await this.categoryRepository.find({
      where: { isVisible: true },
      order: { depth: 'ASC', sortOrder: 'ASC', name: 'ASC' },
    });
    return this.buildTree(all);
  }

  /**
   * slug로 단일 카테고리 조회 + 하위 카테고리 전체 (path LIKE)
   */
  async findBySlug(slug: string): Promise<{ category: CategoryEntity; descendants: CategoryEntity[] }> {
    const category = await this.categoryRepository.findOne({ where: { slug } });
    if (!category) {
      throw new NotFoundException(`카테고리 '${slug}'를 찾을 수 없습니다.`);
    }

    const descendants = await this.categoryRepository.find({
      where: { path: Like(`${category.path}%`), isVisible: true },
      order: { depth: 'ASC', sortOrder: 'ASC' },
    });

    // 자기 자신 제외
    const children = descendants.filter((d) => d.id !== category.id);

    return { category, descendants: children };
  }

  /**
   * (AI 어시스턴트 5a) 카테고리 이름 → 자신 + 모든 하위 카테고리 ID (path LIKE 하위 확장).
   *
   * - 상품은 리프 카테고리에 저장되므로, 부모 이름으로 거르려면 하위까지 펼쳐야 매칭된다(D4).
   * - 이름 정확 일치(동명 카테고리가 여럿이면 각각의 서브트리를 합집합).
   * - 매칭 0건이면 빈 배열 → 호출 측(디스패처)이 환각 방지용 에러로 처리한다.
   */
  async getCategoryIdsByName(name: string): Promise<number[]> {
    const matched = await this.categoryRepository.find({ where: { name } });
    if (matched.length === 0) return [];

    const ids = new Set<number>();
    for (const cat of matched) {
      const subtree = await this.categoryRepository.find({
        where: { path: Like(`${cat.path}%`) },
      });
      for (const c of subtree) ids.add(c.id);
    }
    return [...ids];
  }

  // ─── 어드민 API ────────────────────────────────────────

  /**
   * 카테고리 생성 — path 자동 생성
   *
   * 1. parentId가 있으면 부모의 path 조회
   * 2. INSERT로 새 id 확보
   * 3. path = 부모path + id + '/' 로 UPDATE
   */
  async create(dto: CreateCategoryDto): Promise<CategoryEntity> {
    // EC6: slug 중복 방어 — unique constraint 위반 시 500 대신 명확한 400 응답
    const existingSlug = await this.categoryRepository.findOne({
      where: { slug: dto.slug },
    });
    if (existingSlug) {
      throw new BadRequestException(`slug '${dto.slug}'는 이미 사용 중입니다.`);
    }

    let parentPath = '/';
    let depth = 0;

    if (dto.parentId) {
      const parent = await this.categoryRepository.findOne({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new NotFoundException(`부모 카테고리 ID ${dto.parentId}를 찾을 수 없습니다.`);
      }
      parentPath = parent.path;
      depth = parent.depth + 1;
    }

    // EC8: 2-step path 생성을 트랜잭션으로 감싸 원자성 보장
    // INSERT 후 UPDATE 전에 실패하면 path='/'인 고아 레코드가 남는 것을 방지
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CategoryEntity);

      // 1단계: INSERT (path는 임시값)
      const category = repo.create({
        name: dto.name,
        slug: dto.slug,
        parentId: dto.parentId ?? null,
        depth,
        sortOrder: dto.sortOrder ?? 0,
        path: '/', // 임시
      });
      const saved = await repo.save(category);

      // 2단계: path 확정 (부모path + 새id + '/')
      saved.path = `${parentPath}${saved.id}/`;
      await repo.save(saved);

      return saved;
    });
  }

  /**
   * 카테고리 수정 (이름, slug, sortOrder만)
   * parentId 변경(카테고리 이동)은 path 재계산이 필요하므로 별도 기능으로 분리
   */
  async update(id: number, dto: UpdateCategoryDto): Promise<CategoryEntity> {
    const category = await this.categoryRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException(`카테고리 ID ${id}를 찾을 수 없습니다.`);
    }

    if (dto.name !== undefined) category.name = dto.name;
    if (dto.slug !== undefined) category.slug = dto.slug;
    if (dto.sortOrder !== undefined) category.sortOrder = dto.sortOrder;

    return this.categoryRepository.save(category);
  }

  /**
   * 노출 여부 변경
   */
  async updateVisibility(id: number, isVisible: boolean): Promise<CategoryEntity> {
    const category = await this.categoryRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException(`카테고리 ID ${id}를 찾을 수 없습니다.`);
    }

    category.isVisible = isVisible;
    return this.categoryRepository.save(category);
  }

  /**
   * 카테고리 삭제 — 하위 카테고리 존재 시 삭제 불가
   */
  async remove(id: number): Promise<void> {
    const category = await this.categoryRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException(`카테고리 ID ${id}를 찾을 수 없습니다.`);
    }

    // path LIKE로 하위 카테고리 존재 여부 확인 (자기 자신 포함이므로 > 1)
    const descendantCount = await this.categoryRepository.count({
      where: { path: Like(`${category.path}%`) },
    });

    if (descendantCount > 1) {
      throw new BadRequestException(
        '하위 카테고리가 존재하여 삭제할 수 없습니다. 하위 카테고리를 먼저 삭제해주세요.',
      );
    }

    await this.categoryRepository.remove(category);
  }

  // ─── 유틸리티 ──────────────────────────────────────────

  /**
   * flat 배열 → 트리 구조로 변환
   */
  private buildTree(flatCategories: CategoryEntity[]): CategoryTreeNode[] {
    const map = new Map<number, CategoryTreeNode>();
    const roots: CategoryTreeNode[] = [];

    for (const cat of flatCategories) {
      map.set(cat.id, {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        depth: cat.depth,
        sortOrder: cat.sortOrder,
        children: [],
      });
    }

    for (const cat of flatCategories) {
      const node = map.get(cat.id);
      if (!node) continue;

      const parent = cat.parentId ? map.get(cat.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}
