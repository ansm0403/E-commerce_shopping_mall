import { authClient } from '../lib/axios/axios-http-client';
import { isDemoPaymentId } from './demo-checkout';
import {
  CreateOrderRequest,
  OrderQueryParams,
} from '../model/order';

export function createOrder(dto: CreateOrderRequest) {
  return authClient.post('/orders', dto);
}

export function getMyOrders(params?: OrderQueryParams, signal?: AbortSignal) {
  return authClient.get('/orders', { params, signal });
}

export function getOrderDetail(orderNumber: string, signal?: AbortSignal) {
  if (isDemoPaymentId(orderNumber)) return authClient.get(`/demo/checkout/orders/${orderNumber}`, { signal });
  return authClient.get(`/orders/${orderNumber}`, {signal});
}

export function cancelOrder(orderNumber: string) {
  if (isDemoPaymentId(orderNumber)) return authClient.patch(`/demo/checkout/orders/${orderNumber}/cancel`);
  return authClient.patch(`/orders/${orderNumber}/cancel`);
}

export function confirmOrder(orderNumber: string) {
  return authClient.patch(`/orders/${orderNumber}/confirm`);
}

export function testDeliverOrder(orderNumber: string) {
  return authClient.patch(`/orders/${orderNumber}/test-deliver`);
}
