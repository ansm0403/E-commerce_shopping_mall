import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface DemoPortOnePayment {
  id: string;
  storeId: string;
  transactionId: string;
  status: string;
  currency: string;
  amount: { total: number };
  channel: { type: 'TEST' | 'LIVE'; key?: string; pgProvider: string };
  paidAt?: string;
  method?: { type: string };
}

@Injectable()
export class DemoPortOneService {
  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService
  ) {}

  settings() {
    const storeId = this.config.get<string>('DEMO_PORTONE_STORE_ID')?.trim();
    const channelKey = this.config
      .get<string>('DEMO_PORTONE_CHANNEL_KEY')
      ?.trim();
    const secret = this.config.get<string>('PORTONE_API_SECRET')?.trim();
    // Explicit acknowledgement is required; never silently reuse the normal payment channel.
    if (
      this.config.get('DEMO_CHECKOUT_ENABLED') !== 'true' ||
      this.config.get('DEMO_PORTONE_CHANNEL_IS_TEST') !== 'true' ||
      !storeId ||
      !channelKey ||
      !secret
    )
      throw new ServiceUnavailableException(
        '테스트 결제 채널을 준비 중입니다. 준비된 주문 체험은 이용할 수 있습니다.'
      );
    return { storeId, channelKey };
  }
  options() {
    try {
      return { enabled: true, ...this.settings() };
    } catch {
      return { enabled: false };
    }
  }
  async payment(
    paymentId: string,
    storeId: string
  ): Promise<DemoPortOnePayment> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<DemoPortOnePayment>(
          `https://api.portone.io/payments/${encodeURIComponent(paymentId)}`,
          {
            params: { storeId },
            headers: {
              Authorization: `PortOne ${this.config.get('PORTONE_API_SECRET')}`,
            },
            timeout: 60000,
          }
        )
      );
      return data;
    } catch {
      throw new ServiceUnavailableException(
        'PortOne 테스트 결제 조회에 실패했습니다. 주문 상세에서 다시 확인해주세요.'
      );
    }
  }
  assertTest(
    payment: DemoPortOnePayment,
    expected: {
      orderNumber: string;
      storeId: string;
      channelKey: string;
      totalAmount: number;
    }
  ) {
    if (
      payment.id !== expected.orderNumber ||
      payment.storeId !== expected.storeId ||
      payment.channel?.type !== 'TEST' ||
      payment.channel.key !== expected.channelKey
    )
      throw new ForbiddenException(
        '이 체험 주문에 지정된 PortOne 테스트 채널의 결제만 확인할 수 있습니다.'
      );
    if (
      payment.currency !== 'KRW' ||
      payment.amount?.total !== expected.totalAmount
    )
      throw new BadRequestException(
        '테스트 결제 금액 또는 통화가 주문과 일치하지 않습니다.'
      );
  }
  async cancel(paymentId: string, storeId: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.post<{ cancellation: { status: string } }>(
          `https://api.portone.io/payments/${encodeURIComponent(
            paymentId
          )}/cancel`,
          { storeId, reason: '만료되거나 취소된 테스트 주문' },
          {
            headers: {
              Authorization: `PortOne ${this.config.get('PORTONE_API_SECRET')}`,
              'Idempotency-Key': `"demo-cancel-${paymentId}"`,
            },
            timeout: 60000,
          }
        )
      );
      if (data.cancellation?.status !== 'SUCCEEDED')
        throw new ServiceUnavailableException(
          '테스트 결제 취소를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.'
        );
    } catch {
      throw new ServiceUnavailableException(
        '테스트 결제 취소 확인이 지연되고 있습니다. 잠시 후 다시 확인해주세요.'
      );
    }
  }
}
