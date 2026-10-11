import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseModel } from '../../common/entity/base.entity';
import type { OrderEntity } from './order.entity';
import type { SellerEntity } from '../../seller/entity/seller.entity';

export enum ShipmentStatus {
  PREPARING = 'preparing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
}

@Entity('shipments')
@Unique(['orderId', 'sellerId'])
export class ShipmentEntity extends BaseModel {
  @Column({ name: 'order_id' })
  orderId: number;

  @ManyToOne('OrderEntity', (order: OrderEntity) => order.shipments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order: OrderEntity;

  @Column({ name: 'seller_id' })
  sellerId: number;

  @ManyToOne('SellerEntity')
  @JoinColumn({ name: 'seller_id' })
  seller: SellerEntity;

  @Column({
    type: 'enum',
    enum: ShipmentStatus,
    default: ShipmentStatus.PREPARING,
  })
  status: ShipmentStatus;

  @Column({
    type: 'varchar', // 1. DB에 "문자열"로 만들라고 명시
    length: 50, // 2. 최대 길이를 지정 (선택 사항)
    nullable: true, // 3. 비어있어도 됨 (NULL 허용)
    name: 'tracking_number',
  })
  trackingNumber: string | null;

  @Column({
    type: 'varchar',
    nullable: true,
    name: 'carrier',
  })
  carrier: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'shipped_at' })
  shippedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'delivered_at' })
  deliveredAt: Date | null;
}
