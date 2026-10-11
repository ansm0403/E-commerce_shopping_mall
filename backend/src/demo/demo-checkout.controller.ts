import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateDemoCheckoutDto } from './dto/demo-checkout.dto';
import { VerifyPaymentDto } from '../payment/dto/verify-payment.dto';
import {
  DemoCheckoutActor,
  DemoCheckoutService,
} from './demo-checkout.service';

@Controller('demo/checkout')
@UseGuards(JwtAuthGuard)
export class DemoCheckoutController {
  constructor(private readonly checkout: DemoCheckoutService) {}
  @Get('options') options(@Req() req: { user: DemoCheckoutActor }) {
    return this.checkout.options(req.user);
  }
  @Get('orders') list(@Req() req: { user: DemoCheckoutActor }) {
    return this.checkout.list(req.user);
  }
  @Post('orders')
  create(
    @Req() req: { user: DemoCheckoutActor },
    @Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
    dto: CreateDemoCheckoutDto
  ) {
    return this.checkout.create(req.user, dto.requestId);
  }
  @Get('orders/:orderNumber') detail(
    @Req() req: { user: DemoCheckoutActor },
    @Param('orderNumber') number: string
  ) {
    return this.checkout.detail(req.user, number);
  }
  @Patch('orders/:orderNumber/cancel') cancel(
    @Req() req: { user: DemoCheckoutActor },
    @Param('orderNumber') number: string
  ) {
    return this.checkout.cancel(req.user, number);
  }
  @Post('orders/:orderNumber/reconcile') reconcile(
    @Req() req: { user: DemoCheckoutActor },
    @Param('orderNumber') number: string
  ) {
    return this.checkout.reconcile(req.user, number);
  }
  @Post('verify') verify(
    @Req() req: { user: DemoCheckoutActor },
    @Body() dto: VerifyPaymentDto
  ) {
    return this.checkout.verify(req.user, dto.paymentId, dto.transactionId);
  }
}
