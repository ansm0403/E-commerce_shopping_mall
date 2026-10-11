import { Expose, Type } from 'class-transformer';

class OrderItemResponseDto {
  @Expose() id: number;
  @Expose() productId: number;
  @Expose() sellerId: number;
  @Expose() productName: string;
  @Expose() productPrice: number;
  @Expose() productImageUrl: string | null;
  @Expose() quantity: number;
  @Expose() subtotal: number;
}

class ShipmentResponseDto {
  @Expose() id: number;
  @Expose() orderId: number;
  @Expose() sellerId: number;
  @Expose() status: string;
  @Expose() trackingNumber: string | null;
  @Expose() carrier: string | null;
  @Expose() shippedAt: Date | null;
  @Expose() deliveredAt: Date | null;
  @Expose() createdAt: Date;
  @Expose() updatedAt: Date;
}

class PaymentSummaryDto {
  @Expose() id: number;
  @Expose() transactionId: string | null;
  @Expose() paymentId: string;
  @Expose() paymentMethod: string | null;
  @Expose() amount: number;
  @Expose() status: string;
  @Expose() pgProvider: string | null;
  @Expose() receiptUrl: string | null;
  @Expose() paidAt: Date | null;
}

export class OrderResponseDto {
  @Expose() canDemoChange?: boolean;
  @Expose() canTestDeliver: boolean;
  @Expose() id: number;
  @Expose() orderNumber: string;
  @Expose() userId: number;
  @Expose() status: string;
  @Expose() totalAmount: number;
  @Expose() shippingAddress: string;
  @Expose() recipientName: string;
  @Expose() recipientPhone: string;
  @Expose() memo: string | null;
  @Expose() paidAt: Date | null;
  @Expose() cancelledAt: Date | null;
  @Expose() cancellationReason: string | null;
  @Expose() shippedAt: Date | null;
  @Expose() deliveredAt: Date | null;
  @Expose() completedAt: Date | null;
  @Expose() createdAt: Date;
  @Expose() updatedAt: Date;

  @Expose()
  @Type(() => OrderItemResponseDto)
  items: OrderItemResponseDto[];

  @Expose()
  @Type(() => ShipmentResponseDto)
  shipments: ShipmentResponseDto[];

  @Expose()
  @Type(() => PaymentSummaryDto)
  payment: PaymentSummaryDto | null;
}
