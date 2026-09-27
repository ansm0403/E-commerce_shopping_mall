import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { PortOneWebhookVerifier } from './portone-webhook-verifier';
import { PaymentService } from './payment.service';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { CancelPaymentDto } from './dto/cancel-payment.dto';
import { WebhookPaymentDto } from './dto/webhook-payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/entity/role.entity';
import { Serialize } from '../common/interceptors/serialize.interceptor';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction } from '../audit/entity/audit-log.entity';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BUYER)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('verify')
  @Serialize(PaymentResponseDto)
  @Auditable(AuditAction.PAYMENT_VERIFIED)
  verifyPayment(@Body() dto: VerifyPaymentDto, @Req() req: any) {
    return this.paymentService.verifyPayment(req.user.sub, dto);
  }

  @Post(':orderNumber/cancel')
  @Serialize(PaymentResponseDto)
  @Auditable(AuditAction.PAYMENT_CANCELLED, { captureBody: ['reason'] })
  cancelPayment(
    @Param('orderNumber') orderNumber: string,
    @Body() dto: CancelPaymentDto,
    @Req() req: any,
  ) {
    return this.paymentService.cancelPayment(req.user.sub, orderNumber, dto);
  }
}

/**
 * PortOne 웹훅 — JWT 대신 **서명 검증**(Standard Webhooks, PortOneWebhookVerifier)으로 발신자를 확인한다.
 * 발신 IP(52.78.5.241) 제한은 nginx(nginx/default.conf 의 `location = /v1/payments/webhook`)가 한 겹 더 맡는다.
 * PortOne 서버의 재전송이 전역 Rate Limit(IP 당 100/분)에 걸리지 않도록 제외한다.
 */
@SkipThrottle()
@Controller('payments')
export class PaymentWebhookController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly verifier: PortOneWebhookVerifier,
  ) {}

  /**
   * 200 을 명시한다 — PortOne 은 2xx 만 성공으로 보고, 그 외에는 최대 5회(0→1→4→16→64→256분) 재전송한다.
   * 서명 검증은 ValidationPipe 가 만든 dto 가 아니라 **원문(rawBody)** 으로 한다 — 파싱·재직렬화하면 서명이 어긋난다.
   * 검증 실패(401)도 @Auditable 이 success:false 로 남긴다 — 위조 시도 자체가 보안 기록이다.
   */
  @Post('webhook')
  @HttpCode(200)
  @Auditable(AuditAction.PAYMENT_WEBHOOK)
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: WebhookPaymentDto,
  ) {
    this.verifier.assertValid(req.rawBody, headers);
    return this.paymentService.handleWebhook(dto);
  }
}

/** 관리자 결제 관리 */
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminPaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post(':orderNumber/cancel')
  @Serialize(PaymentResponseDto)
  @Auditable(AuditAction.PAYMENT_CANCELLED_ADMIN, { captureBody: ['reason'] })
  cancelPayment(
    @Param('orderNumber') orderNumber: string,
    @Body() dto: CancelPaymentDto,
  ) {
    return this.paymentService.cancelPaymentByAdmin(orderNumber, dto);
  }
}
