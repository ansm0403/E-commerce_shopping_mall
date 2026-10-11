import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { BaseModel } from '../../common/entity/base.entity';
import type { UserModel } from '../../user/entity/user.entity';

export interface DemoCartItem {
  productId: number;
  quantity: number;
}
export interface DemoOrderItem extends DemoCartItem {
  id: number;
  sellerId: number;
  productName: string;
  productPrice: number;
  productImageUrl: string | null;
  subtotal: number;
}

@Entity('demo_checkout_visits')
export class DemoCheckoutVisitEntity {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: number;
  @ManyToOne('UserModel', { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'demo_checkout_visits_user_id_fkey',
  })
  user: UserModel;
  @Column('jsonb', { default: () => "'[]'::jsonb" }) items: DemoCartItem[];
  @Column({ default: 0 }) version: number;
  @Index('demo_checkout_visits_expiry_idx')
  @Column('timestamptz', { name: 'expires_at' })
  expiresAt: Date;
}

@Entity('demo_checkout_orders')
@Unique('demo_checkout_orders_visit_id_request_id_key', [
  'visitId',
  'requestId',
])
@Check(
  'demo_checkout_orders_status_check',
  "status IN ('pending_payment','paid','cancelled')"
)
@Check('demo_checkout_orders_total_amount_check', 'total_amount > 0')
export class DemoCheckoutOrderEntity extends BaseModel {
  @Column({ name: 'order_number', unique: true }) orderNumber: string;
  @Column('uuid', { name: 'visit_id' })
  @Index('demo_checkout_orders_visit_idx')
  visitId: string;
  @ManyToOne(() => DemoCheckoutVisitEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'visit_id',
    foreignKeyConstraintName: 'demo_checkout_orders_visit_id_fkey',
  })
  visit: DemoCheckoutVisitEntity;
  @Column({ name: 'user_id' }) userId: number;
  @ManyToOne('UserModel', { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'demo_checkout_orders_user_id_fkey',
  })
  user: UserModel;
  @Column('uuid', { name: 'request_id' }) requestId: string;
  @Column({ default: 'pending_payment' }) status:
    | 'pending_payment'
    | 'paid'
    | 'cancelled';
  @Column('jsonb') items: DemoOrderItem[];
  @Column({ name: 'total_amount' }) totalAmount: number;
  @Column({ name: 'cart_version' }) cartVersion: number;
  @Column({ name: 'store_id' }) storeId: string;
  @Column({ name: 'channel_key' }) channelKey: string;
  @Column('varchar', { name: 'transaction_id', nullable: true }) transactionId:
    | string
    | null;
  @Column('varchar', { name: 'payment_method', nullable: true }) paymentMethod:
    | string
    | null;
  @Column('varchar', { name: 'pg_provider', nullable: true }) pgProvider:
    | string
    | null;
  @Column('timestamptz', { name: 'paid_at', nullable: true })
  paidAt: Date | null;
  @Column('timestamptz', { name: 'cancelled_at', nullable: true })
  cancelledAt: Date | null;
  @Column('timestamptz', { name: 'expires_at' }) expiresAt: Date;
}
