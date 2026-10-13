import { Global, Module } from '@nestjs/common';
// Nx currently misidentifies this installed external dependency as a local project.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { TypeOrmModule } from '@nestjs/typeorm';
import { DemoFixtureEntity } from './entity/demo-fixture.entity';
import { DemoPolicyService } from './demo-policy.service';
import { UserModel } from '../user/entity/user.entity';
import { SellerEntity } from '../seller/entity/seller.entity';
import { InquiryEntity } from '../inquiry/entity/inquiry.entity';
import { OrderEntity } from '../order/entity/order.entity';
import { DemoInquiryRateGuard } from './demo-inquiry-rate.guard';
import { HttpModule } from '@nestjs/axios';
import {
  DemoCheckoutOrderEntity,
  DemoCheckoutVisitEntity,
} from './entity/demo-checkout.entity';
import { DemoCheckoutService } from './demo-checkout.service';
import { DemoPortOneService } from './demo-portone.service';
import { SearchIndexJobsModule } from '../search/search-index-jobs.module';

@Global()
@Module({
  imports: [
    HttpModule,
    SearchIndexJobsModule,
    TypeOrmModule.forFeature([
      DemoFixtureEntity,
      UserModel,
      SellerEntity,
      InquiryEntity,
      OrderEntity,
      DemoCheckoutOrderEntity,
      DemoCheckoutVisitEntity,
    ]),
  ],
  providers: [
    DemoPolicyService,
    DemoInquiryRateGuard,
    DemoCheckoutService,
    DemoPortOneService,
  ],
  exports: [DemoPolicyService, DemoInquiryRateGuard, DemoCheckoutService],
})
export class DemoModule {}
