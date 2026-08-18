import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModel } from '../user/entity/user.entity';
import { RoleEntity } from '../user/entity/role.entity';
import { SellerEntity } from '../seller/entity/seller.entity';
import { ReviewEntity } from '../review/entity/review.entity';
import { ProductEntity } from '../product/entity/product.entity';
import { InquiryEntity } from '../inquiry/entity/inquiry.entity';
import { ProductModule } from '../product/product.module';
import { DashboardSeedService } from './dashboard.seed.service';
import { ReviewSeedService } from './review.seed.service';
import { InquirySeedService } from './inquiry.seed.service';

/**
 * NODE_SEED=true 일 때만 AppModule 에 등록되는 시드 모듈.
 * AppModule 의 TypeOrmModule.forRoot 가 전역 DataSource 를 제공하므로,
 * forFeature 에는 이 모듈에서 직접 쓰는 엔티티만 등록.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserModel,
      RoleEntity,
      SellerEntity,
      ReviewEntity,
      ProductEntity,
      InquiryEntity,
    ]),
    // SEED_PRODUCTS=true 배치 경로에서 ProductSeedService 를 쓰기 위함
    ProductModule,
  ],
  providers: [DashboardSeedService, ReviewSeedService, InquirySeedService],
})
export class SeedModule {}
