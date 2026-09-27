import { Test } from '@nestjs/testing';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentWebhookController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PortOneWebhookVerifier } from './portone-webhook-verifier';
import { signStandardWebhook } from './webhook-signature';

// PaymentService 실물을 import 하면 Order/Payment 엔티티의 순환 import 가 SWC 아래에서
// "Cannot access 'OrderEntity' before initialization" 으로 터진다(이 스펙과 무관한 기존 구조).
// 컨트롤러 스펙에 필요한 것은 DI 토큰뿐이라 모듈째 빈 클래스로 바꾼다.
jest.mock('./payment.service', () => ({ PaymentService: class PaymentService {} }));

/**
 * 웹훅 컨트롤러 단위 테스트 — PaymentService 는 mock.
 * 고정하는 것: "서명 검증 모드 3가지"(portone-webhook-verifier.ts 머리 주석)와
 * "검증은 dto 가 아니라 rawBody 로 한다".
 */
const SECRET = 'whsec_' + Buffer.from('controller-spec-secret').toString('base64');
const BODY = '{"type":"Transaction.Paid","data":{"paymentId":"pay_1","transactionId":"tx_1"}}';
const DTO = { type: 'Transaction.Paid', data: { paymentId: 'pay_1', transactionId: 'tx_1' } };

function signedHeaders(body: string, secret = SECRET) {
  const ts = Math.floor(Date.now() / 1000);
  const id = 'msg_spec';
  return {
    'webhook-id': id,
    'webhook-timestamp': String(ts),
    'webhook-signature': signStandardWebhook(secret, body, id, ts),
  };
}

async function build(env: Record<string, string | undefined>) {
  const paymentService = { handleWebhook: jest.fn().mockResolvedValue({ message: 'ok' }) };
  const config = { get: jest.fn((key: string) => env[key]) };
  const moduleRef = await Test.createTestingModule({
    controllers: [PaymentWebhookController],
    providers: [
      PortOneWebhookVerifier,
      { provide: PaymentService, useValue: paymentService },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  return { controller: moduleRef.get(PaymentWebhookController), paymentService };
}

const req = (raw?: string) => ({ rawBody: raw === undefined ? undefined : Buffer.from(raw, 'utf8') }) as any;

describe('PaymentWebhookController — 서명 검증', () => {
  describe('시크릿이 있을 때', () => {
    it('올바른 서명이면 서비스로 넘긴다', async () => {
      const { controller, paymentService } = await build({ PORTONE_WEBHOOK_SECRET: SECRET, NODE_ENV: 'production' });
      await expect(controller.handleWebhook(req(BODY), signedHeaders(BODY), DTO)).resolves.toEqual({ message: 'ok' });
      expect(paymentService.handleWebhook).toHaveBeenCalledWith(DTO);
    });

    it('서명이 없으면 401, 서비스는 호출되지 않는다', async () => {
      const { controller, paymentService } = await build({ PORTONE_WEBHOOK_SECRET: SECRET });
      expect(() => controller.handleWebhook(req(BODY), {}, DTO)).toThrow(UnauthorizedException);
      expect(paymentService.handleWebhook).not.toHaveBeenCalled();
    });

    it('다른 시크릿으로 서명했으면 401', async () => {
      const { controller, paymentService } = await build({ PORTONE_WEBHOOK_SECRET: SECRET });
      const forged = signedHeaders(BODY, 'whsec_' + Buffer.from('attacker').toString('base64'));
      expect(() => controller.handleWebhook(req(BODY), forged, DTO)).toThrow(UnauthorizedException);
      expect(paymentService.handleWebhook).not.toHaveBeenCalled();
    });

    it('검증 대상은 dto 가 아니라 rawBody — 원문이 바뀌면 dto 가 같아도 401', async () => {
      const { controller, paymentService } = await build({ PORTONE_WEBHOOK_SECRET: SECRET });
      const headers = signedHeaders(BODY);
      const tamperedRaw = BODY.replace('pay_1', 'pay_9');
      expect(() => controller.handleWebhook(req(tamperedRaw), headers, DTO)).toThrow(UnauthorizedException);
      expect(paymentService.handleWebhook).not.toHaveBeenCalled();
    });

    it('rawBody 가 없으면(서버 설정 오류) 503', async () => {
      const { controller } = await build({ PORTONE_WEBHOOK_SECRET: SECRET });
      expect(() => controller.handleWebhook(req(undefined), signedHeaders(BODY), DTO)).toThrow(ServiceUnavailableException);
    });
  });

  describe('시크릿이 없을 때', () => {
    it('운영(NODE_ENV=production)이면 503 — 검증 못 하는 웹훅은 받지 않는다', async () => {
      const { controller, paymentService } = await build({ NODE_ENV: 'production' });
      expect(() => controller.handleWebhook(req(BODY), signedHeaders(BODY), DTO)).toThrow(ServiceUnavailableException);
      expect(paymentService.handleWebhook).not.toHaveBeenCalled();
    });

    it('로컬/개발이면 검증을 건너뛰고 서비스로 넘긴다 (헤더가 없어도)', async () => {
      const { controller, paymentService } = await build({ NODE_ENV: 'development' });
      await expect(controller.handleWebhook(req(BODY), {}, DTO)).resolves.toEqual({ message: 'ok' });
      expect(paymentService.handleWebhook).toHaveBeenCalledWith(DTO);
    });

    it('공백만 있는 시크릿은 없는 것으로 본다', async () => {
      const { controller } = await build({ PORTONE_WEBHOOK_SECRET: '   ', NODE_ENV: 'production' });
      expect(() => controller.handleWebhook(req(BODY), signedHeaders(BODY), DTO)).toThrow(ServiceUnavailableException);
    });
  });
});
