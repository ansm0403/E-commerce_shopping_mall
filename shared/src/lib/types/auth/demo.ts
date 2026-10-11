export type DemoRole = 'buyer' | 'seller' | 'admin';
export interface DemoOptions {
  enabled: boolean;
  roles: Record<DemoRole, boolean>;
}
export interface DemoStatus {
  preparingOrders: number;
  shippedOrders: number;
  deliveredOrders: number;
  reviewableItems: number;
  waitingInquiries: number;
  testDeliveryEnabled: boolean;
}
