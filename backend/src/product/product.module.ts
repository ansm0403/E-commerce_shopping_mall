import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../common/common.module';
import { ProductEntity } from './entity/product.entity';
import { ProductImageEntity } from './entity/product-image.entity';
import { TagEntity } from './entity/tag.entity';
import { BookEntity } from './entity/book/book.entity';
import { BeautyEntity } from './entity/beauty/beauty.entity';
import { LivingProductEntity } from './entity/living-product/living-product.entity';
import { ClothingEntity } from './entity/clothing/clothing.entity';
import { ShoesEntity } from './entity/shoes/shoes.entity';
import { FoodEntity } from './entity/food/food.entity';
import { SellerEntity } from '../seller/entity/seller.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import { CategoryEntity } from '../category/entity/category.entity';
import { ProductSummaryEntity } from './entity/product-summary.entity';
import { ProductController, AdminProductController } from './product.controller';
import { ProductService } from './product.service';
import { ProductSummaryService } from './product-summary.service';
import { ReviewModule } from '../review/review.module';
import { TypeOrmProductSearchService } from './product-search.service';
import { PRODUCT_SEARCH_SERVICE } from './interfaces/product-search.interface';
import { ProductSeedService } from '../common/seeds/product.seed';
import { ProductEventListener } from './listeners/product-event.listener';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProductEntity,
      ProductImageEntity,
      TagEntity,
      BeautyEntity,
      ClothingEntity,
      FoodEntity,
      BookEntity,
      LivingProductEntity,
      ShoesEntity,
      SellerEntity,
      OrderItemEntity,
      CategoryEntity,
      ProductSummaryEntity,
    ]),
    CommonModule,
    AuthModule,
    ReviewModule, // Phase 5c: ProductSummaryService 가 ReviewService.getReviewsForAssistant 재사용
  ],
  controllers: [ProductController, AdminProductController],
  providers: [
    ProductService,
    ProductSummaryService,
    {
      provide: PRODUCT_SEARCH_SERVICE,
      useClass: TypeOrmProductSearchService,
    },
    ProductSeedService,
    ProductEventListener,
  ],
  // ProductSeedService: SeedModule 배치(SEED_PRODUCTS=true)가 재사용 — HTTP 엔드포인트 없이 시드 가능
  exports: [TypeOrmModule, ProductService, ProductSeedService],
})
export class ProductModule {}
