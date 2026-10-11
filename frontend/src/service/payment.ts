import { authClient } from '../lib/axios/axios-http-client';
import { isDemoPaymentId } from './demo-checkout';
import { VerifyPaymentRequest, CancelPaymentRequest } from '../model/order';

export function verifyPayment(dto: VerifyPaymentRequest) {
  if (isDemoPaymentId(dto.paymentId)) return authClient.post('/demo/checkout/verify', dto);
  return authClient.post('/payments/verify', dto);
}

export function cancelPayment(orderNumber: string, dto: CancelPaymentRequest) {
  return authClient.post(`/payments/${orderNumber}/cancel`, dto);
}
