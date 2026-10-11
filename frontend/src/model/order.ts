// ─── 상태 타입 ───────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled';

export type PaymentStatus =
  | 'ready'
  | 'paid'
  | 'cancelled'
  | 'partial_cancelled'
  | 'failed';

export type ShipmentStatus = 'preparing' | 'shipped' | 'delivered';

// ─── 중첩 응답 타입 ───────────────────────────────────────────────────────────

export interface OrderItemResponse {
  id: number;
  productId: number;
  sellerId: number;
  productName: string;
  productPrice: number;
  productImageUrl: string | null;
  quantity: number;
  subtotal: number;
}

export interface ShipmentResponse {
  id: number;
  orderId: number;
  sellerId: number;
  status: ShipmentStatus;
  trackingNumber: string | null;
  carrier: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSummary {
  id: number;
  transactionId: string | null; // V2: 포트원이 발급한 거래 ID
  paymentId: string;            // V2: 우리가 설정한 결제 ID (= orderNumber)
  paymentMethod: string | null;
  amount: number;
  status: PaymentStatus;
  pgProvider: string | null;
  receiptUrl: string | null;
  paidAt: string | null;
}

// ─── 주문 응답 ───────────────────────────────────────────────────────────────

export interface OrderResponse {
  isDemoCheckout?: boolean;
  testPayment?: { storeId: string; channelKey: string };
  canDemoChange?: boolean;
  canTestDeliver?: boolean;
  id: number;
  orderNumber: string;
  userId: number;
  status: OrderStatus;
  totalAmount: number;
  shippingAddress: string;
  recipientName: string;
  recipientPhone: string;
  memo: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemResponse[];
  shipments: ShipmentResponse[];
  payment: PaymentSummary | null;
}

// ─── 페이지네이션 ─────────────────────────────────────────────────────────────

export interface PaginatedOrders {
  data: OrderResponse[];
  meta: {
    total: number;
    page: number;
    lastPage: number;
    take: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// ─── 요청 타입 ───────────────────────────────────────────────────────────────

export interface CreateOrderRequest {
  cartItemIds: number[];
  shippingAddress: string;
  recipientName: string;
  recipientPhone: string;
  memo?: string;
}

export interface VerifyPaymentRequest {
  transactionId: string; // V2: 포트원이 발급한 거래 ID
  paymentId: string;     // V2: 우리가 설정한 결제 ID (= orderNumber)
}

export interface CancelPaymentRequest {
  reason: string;
}

export interface OrderQueryParams {
  page?: number;
  take?: number;
  status?: OrderStatus;
}

// ─── 포트원 V2 SDK 응답 타입 ─────────────────────────────────────────────────
// V2는 import로 사용하므로 window 전역 선언 불필요.
// 실제 타입은 @portone/browser-sdk/v2 의 PaymentResponse 사용.
// 결제 성공: { paymentId, txId, transactionType: 'PAYMENT' } (code 없음)
// 결제 실패: { code, message, paymentId }
// 결제창 닫기: undefined
