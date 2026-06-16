import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InquiryEntity } from './entity/inquiry.entity';
import { ProductEntity } from '../product/entity/product.entity';
import { SellerEntity } from '../seller/entity/seller.entity';
import { InquiryService } from './inquiry.service';
import { InquiryController, SellerInquiryController } from './inquiry.controller';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InquiryEntity, ProductEntity, SellerEntity]),
    AuthModule,
    CommonModule,
  ],
  controllers: [InquiryController, SellerInquiryController],
  providers: [InquiryService],
  exports: [InquiryService],
})
export class InquiryModule {}
