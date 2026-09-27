import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { PaymentEntity } from './entity/payment.entity';
import { OrderEntity } from '../order/entity/order.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import { ProductEntity } from '../product/entity/product.entity';
import { ShipmentEntity } from '../order/entity/shipment.entity';
import { PaymentController, PaymentWebhookController, AdminPaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PortOneWebhookVerifier } from './portone-webhook-verifier';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentEntity,
      OrderEntity,
      OrderItemEntity,
      ProductEntity,
      ShipmentEntity,
    ]),
    HttpModule.register({ timeout: 10000 }),
    AuthModule,
  ],
  controllers: [PaymentController, PaymentWebhookController, AdminPaymentController],
  providers: [PaymentService, PortOneWebhookVerifier],
  exports: [PaymentService],
})
export class PaymentModule {}
