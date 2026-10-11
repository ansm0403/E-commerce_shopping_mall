import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mockProductCatalog } from './mock-product-catalog';
import { planMockOwnership } from '../../seed/demo-ownership-plan';
import { ProductEntity } from '../../product/entity/product.entity';
import { ProductImageEntity } from '../../product/entity/product-image.entity';
import { CategoryEntity } from '../../category/entity/category.entity';

@Injectable()
export class ProductSeedService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
    @InjectRepository(ProductImageEntity)
    private readonly productImageRepository: Repository<ProductImageEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
  ) {}

  async seedProducts() {
    const seller = await this.productRepository.manager.query(
      `SELECT s.id FROM sellers s JOIN users u ON u.id = s.user_id
       WHERE u.email = $1 AND u.is_demo=false AND s.status = 'approved'
         AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                     WHERE ur.user_id = u.id AND r.name = 'seller')`,
      [process.env.TEST_SELLER_EMAIL || 'seller1@seed.com'],
    );
    if (!seller[0]) throw new Error('승인된 테스트 셀러를 먼저 준비하세요. TEST_SELLER_EMAIL을 확인하세요.');
    const rawData = mockProductCatalog;
    const existingProducts = await this.productRepository.find({ relations: ['images'] });
    const plan = planMockOwnership(existingProducts.map((p) => ({
      ...p, urls: p.images.map((img) => img.url),
    })), rawData, seller[0].id);
    if (plan.ambiguous.length) throw new Error('중복 mock 상품이 있습니다. 데이터 보정 대상을 확인하세요.');

    // slug 및 대문자 변형 모두 지원하는 category → id 맵 구성
    const categories = await this.categoryRepository.find();
    const categoryMap = new Map<string, number>();
    for (const cat of categories) {
      categoryMap.set(cat.slug, cat.id);
      categoryMap.set(cat.slug.toUpperCase(), cat.id);
    }

    for (const { category, imageUrl, ...rest } of rawData as any[]) {
      const existing = await this.productRepository.findOne({ where: { seedKey: rest.seedKey } });
      if (existing) continue;
      const legacy = plan.updates.find((p) => p.seedKey === rest.seedKey);
      if (legacy) {
        await this.productRepository.update(legacy.id, { seedKey: legacy.seedKey, sellerId: legacy.sellerId });
        continue;
      }
      const product = await this.productRepository.save({
        ...rest,
        sellerId: seller[0].id,
        categoryId: category ? (categoryMap.get(category) ?? null) : null,
      });

      if (imageUrl) {
        await this.productImageRepository.save([
          { url: imageUrl, isPrimary: true, sortOrder: 0, product },
          { url: imageUrl, isPrimary: false, sortOrder: 1, product },
          { url: imageUrl, isPrimary: false, sortOrder: 2, product },
        ]);
      }
    }

    return {
      message: `총 ${rawData.length}개 mock 상품 준비 완료 (테스트 셀러: ${seller[0].id})`,
    };
  }
}
