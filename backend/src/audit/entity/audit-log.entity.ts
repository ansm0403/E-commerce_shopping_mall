import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

export enum AuditAction {
  // ── 인증 ──
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  REGISTER = 'REGISTER',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  TOKEN_REFRESH = 'TOKEN_REFRESH',
  FAILED_LOGIN = 'FAILED_LOGIN',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  TWO_FACTOR_ENABLED = 'TWO_FACTOR_ENABLED',
  TWO_FACTOR_VERIFIED = 'TWO_FACTOR_VERIFIED',

  // ── 주문 ──
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',

  // ── 결제 ──
  PAYMENT_VERIFIED = 'PAYMENT_VERIFIED',
  PAYMENT_CANCELLED = 'PAYMENT_CANCELLED',
  PAYMENT_CANCELLED_ADMIN = 'PAYMENT_CANCELLED_ADMIN',
  PAYMENT_WEBHOOK = 'PAYMENT_WEBHOOK',

  // ── 배송 ──
  SHIPMENT_SHIPPED = 'SHIPMENT_SHIPPED',
  SHIPMENT_DELIVERED = 'SHIPMENT_DELIVERED',
  SHIPMENT_TEST_DELIVERED = 'SHIPMENT_TEST_DELIVERED',
  DEMO_DATA_REPAIRED = 'DEMO_DATA_REPAIRED',

  // ── 상품 ──
  PRODUCT_CREATED = 'PRODUCT_CREATED',
  PRODUCT_UPDATED = 'PRODUCT_UPDATED',
  PRODUCT_DELETED = 'PRODUCT_DELETED',
  PRODUCT_APPROVED = 'PRODUCT_APPROVED',
  PRODUCT_REJECTED = 'PRODUCT_REJECTED',

  // ── 셀러 ──
  SELLER_APPROVED = 'SELLER_APPROVED',
  SELLER_REJECTED = 'SELLER_REJECTED',

  // ── 리뷰 ──
  REVIEW_CREATED = 'REVIEW_CREATED',
  REVIEW_UPDATED = 'REVIEW_UPDATED',
  REVIEW_DELETED = 'REVIEW_DELETED',

  // ── 정산 ──
  SETTLEMENT_CONFIRMED = 'SETTLEMENT_CONFIRMED',
  SETTLEMENT_PAID = 'SETTLEMENT_PAID',

  // ── 문의 ──
  INQUIRY_ANSWERED = 'INQUIRY_ANSWERED',

  // ── 사용자 ──
  PROFILE_UPDATED = 'PROFILE_UPDATED',

  // ── Cron (시스템) ──
  CRON_ORDER_EXPIRED = 'CRON_ORDER_EXPIRED',
  CRON_SHIPMENT_AUTO_DELIVERED = 'CRON_SHIPMENT_AUTO_DELIVERED',
  CRON_ORDER_AUTO_COMPLETED = 'CRON_ORDER_AUTO_COMPLETED',
}

@Entity('audit_logs')
@Index(['userId', 'createdAt'])
@Index(['action', 'createdAt'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  userId: number;

  @Column({ type: 'varchar', length: 50 })
  action: AuditAction;

  @Column()
  ipAddress: string;

  @Column({ nullable: true })
  userAgent: string;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, any>;

  @Column({ default: true })
  success: boolean;

  @Column({ nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;
}
