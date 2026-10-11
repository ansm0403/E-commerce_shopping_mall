import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DemoModule } from './demo.module';
import { DemoCheckoutController } from './demo-checkout.controller';

@Module({
  imports: [AuthModule, DemoModule],
  controllers: [DemoCheckoutController],
})
export class DemoCheckoutApiModule {}
