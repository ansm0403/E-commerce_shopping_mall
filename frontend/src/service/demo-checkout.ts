import { authClient } from '../lib/axios/axios-http-client';
import type { OrderResponse } from '../model/order';

export interface DemoCheckoutOptions {
  enabled: boolean;
  storeId?: string;
  channelKey?: string;
  shipping: {
    recipientName: string;
    recipientPhone: string;
    shippingAddress: string;
  };
  maxQuantity: number;
  maxItems: number;
}
export const isDemoPaymentId = (id: string) => id.startsWith('DEMO-PG-');
export const getDemoCheckoutOptions = (signal?: AbortSignal) =>
  authClient.get<DemoCheckoutOptions>('/demo/checkout/options', { signal });
export const createDemoCheckout = (requestId: string) =>
  authClient.post<OrderResponse>('/demo/checkout/orders', { requestId });
export const getDemoCheckoutOrders = (signal?: AbortSignal) =>
  authClient.get<OrderResponse[]>('/demo/checkout/orders', { signal });

export function reconcileDemoCheckout(orderNumber: string) {
  return authClient.post<OrderResponse>(
    `/demo/checkout/orders/${orderNumber}/reconcile`,
    {}
  );
}
