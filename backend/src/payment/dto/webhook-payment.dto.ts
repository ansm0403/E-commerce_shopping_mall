import { IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * ⚠ 이 DTO 는 **외부(PortOne)가 보내는 본문**이다. 전역 ValidationPipe 의 forbidNonWhitelisted 를 그대로 적용하면
 * PortOne 이 함께 보내는 `timestamp`·`data.storeId`(·취소 시 `cancellationId` 등)가 "모르는 필드" 로 400 이 되어
 * 웹훅이 서명 검증에도 못 가고 거절된다(2026-10-16 운영 회귀 실측). 그래서 컨트롤러가 이 라우트만 whitelist(버리기)로 받는다.
 * 여기엔 서비스가 실제로 읽는 필드만 선언한다.
 */
class WebhookDataDto {
  @IsNotEmpty()
  @IsString()
  paymentId: string;

  // PortOne 이 생략할 수 있는 값 — 없으면 서비스가 PortOne 재조회 결과를 쓴다(payment.service processWebhook)
  @IsOptional()
  @IsString()
  transactionId?: string;
}

/**
 * 포트원 V2 웹훅 페이로드
 * 참고: https://developers.portone.io/docs/ko/v2-payment/webhook
 *
 * type 예시:
 *   Transaction.Paid         — 결제 완료
 *   Transaction.Cancelled    — 결제 취소
 *   Transaction.Failed       — 결제 실패
 *   Transaction.PayPending   — 결제 대기 (가상계좌 등)
 */
export class WebhookPaymentDto {
  @IsNotEmpty()
  @IsString()
  type: string;

  @IsNotEmpty()
  @IsObject()
  @ValidateNested()
  @Type(() => WebhookDataDto)
  data: WebhookDataDto;
}
