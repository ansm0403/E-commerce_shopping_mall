import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookHeaders, WebhookSignatureError, verifyStandardWebhook } from './webhook-signature';

/**
 * PortOne 웹훅 요청이 정말 PortOne 에서 왔는지 확인한다(서명 검증).
 *
 * 동작 모드는 환경변수 PORTONE_WEBHOOK_SECRET 하나로 정해진다.
 *  · 값 있음                      → 모든 웹훅의 서명을 검증. 실패 = 401.
 *  · 값 없음 + NODE_ENV=production → 검증할 수 없으므로 웹훅을 받지 않는다(503, fail-closed).
 *                                   배포 순서: EC2 .env 에 시크릿을 먼저 넣고 → 이미지를 올린다.
 *  · 값 없음 + 그 외(로컬·CI)       → 검증을 건너뛰고 경고만 남긴다(로컬 결제 테스트가 막히지 않게).
 *
 * 서명이 틀려도 결제가 위조되는 일은 원래 없었다(PaymentService 가 PortOne 에 재조회해 대조한다).
 * 이 검증이 새로 막는 것은 아무나 이 엔드포인트를 두드려 PortOne API 호출·DB 조회·감사 로그를
 * 낭비시키는 것과, 만료 주문의 paymentId 로 자동 환불 분기를 억지로 태우는 것이다.
 */
@Injectable()
export class PortOneWebhookVerifier {
  private readonly logger = new Logger(PortOneWebhookVerifier.name);
  private readonly secret: string | undefined;
  private readonly production: boolean;

  constructor(configService: ConfigService) {
    this.secret = configService.get<string>('PORTONE_WEBHOOK_SECRET')?.trim() || undefined;
    this.production = (configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV) === 'production';

    if (this.secret) {
      this.logger.log('PortOne 웹훅 서명 검증 켜짐 (PORTONE_WEBHOOK_SECRET)');
    } else if (this.production) {
      this.logger.error(
        'PORTONE_WEBHOOK_SECRET 이 없다 — 운영에서는 서명을 검증할 수 없는 웹훅을 받지 않는다(503). ' +
          'EC2 .env 에 시크릿을 넣고 컨테이너를 다시 올려라.',
      );
    } else {
      this.logger.warn('PORTONE_WEBHOOK_SECRET 이 없어 웹훅 서명 검증을 건너뛴다 (로컬/개발 전용 동작)');
    }
  }

  /** 검증 모드가 켜져 있는지 — 테스트·상태 확인용 */
  get enabled(): boolean {
    return !!this.secret;
  }

  /**
   * @param rawBody Nest 의 rawBody(원문 바이트). 없으면 body 파서가 rawBody 를 켜지 않은 것이라 검증 불가.
   */
  assertValid(rawBody: Buffer | undefined, headers: WebhookHeaders): void {
    if (!this.secret) {
      if (this.production) {
        throw new ServiceUnavailableException('webhook signature verification is not configured');
      }
      return;
    }

    if (!rawBody) {
      // main.ts 의 NestFactory.create(AppModule, { rawBody: true }) 가 빠지면 여기로 온다 — 설정 오류라 서버 쪽 잘못.
      this.logger.error('rawBody 가 없다 — NestFactory.create 의 rawBody: true 를 확인하라');
      throw new ServiceUnavailableException('raw body is not available for signature verification');
    }

    try {
      verifyStandardWebhook(this.secret, rawBody, headers);
    } catch (e) {
      if (e instanceof WebhookSignatureError) {
        this.logger.warn(`PortOne 웹훅 서명 검증 실패 — ${e.reason}: ${e.message}`);
        throw new UnauthorizedException(`invalid webhook signature (${e.reason})`);
      }
      throw e;
    }
  }
}
