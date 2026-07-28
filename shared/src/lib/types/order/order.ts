import { BaseModel } from '../base.model.js';
import type { Shipment } from './shipment.js';

export const OrderStatus = {
  PENDING_PAYMENT: 'pending_payment',
  PAID: 'paid',
  PREPARING: 'preparing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentStatus = {
  READY: 'ready',
  PAID: 'paid',
  CANCELLED: 'cancelled',
  PARTIAL_CANCELLED: 'partial_cancelled',
  FAILED: 'failed',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export interface Order extends BaseModel {
  orderNumber: string;
  userId: number;
  status: OrderStatus;
  totalAmount: number;
  shippingAddress: string;
  recipientName: string;
  recipientPhone: string;
  memo?: string | null;
  paidAt?: Date | null;
  cancelledAt?: Date | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  completedAt?: Date | null;
  items: OrderItem[];
  shipments?: Shipment[];
  /** 셀러/관리자 주문 API(OrderResponseDto)에 실려 오는 결제 요약 */
  payment?: OrderPaymentSummary | null;
}

export interface OrderItem extends BaseModel {
  orderId: number;
  productId: number;
  /** null = 셀러 없는 상품(시드) 스냅샷 — 00-role-audit §7-5, 0 이 아니라 null 이다 */
  sellerId: number | null;
  productName: string;
  productPrice: number;
  productImageUrl?: string | null;
  quantity: number;
  subtotal: number;
}

/** OrderResponseDto.payment (PaymentSummaryDto) 와 1:1 */
export interface OrderPaymentSummary {
  id: number;
  transactionId?: string | null;
  paymentId: string;
  paymentMethod: string | null;
  amount: number;
  status: PaymentStatus | string;
  pgProvider: string | null;
  receiptUrl: string | null;
  paidAt: string | Date | null;
}

/** GET /seller/orders · /admin/orders 필터 — 백엔드 OrderQueryDto 와 1:1 */
export interface OrderQuery {
  page?: number;
  take?: number;
  status?: OrderStatus;
}

/** PATCH /seller/orders/:orderNumber/ship — 백엔드 ShipOrderDto 와 1:1 */
export interface ShipOrderRequest {
  trackingNumber: string;
  carrier: string;
}
