import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseModel } from '../../common/entity/base.entity';
import { OrderEntity } from './order.entity';

@Entity('order_items')
export class OrderItemEntity extends BaseModel {
  @Column({ name: 'order_id' })
  orderId: number;

  @ManyToOne(() => OrderEntity, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: OrderEntity;

  @Column({ name: 'product_id' })
  productId: number;

  /**
   * null = 셀러 없는 상품(시드 등, products.seller_id nullable)의 주문 스냅샷.
   * 예전엔 `?? 0`으로 가짜 id 0을 박았는데(00-role-audit §7-5), 0은 존재하지 않는
   * 셀러라 shipments.seller_id FK를 깨뜨리고 정산 집계에도 고아로 남는다.
   */
  @Column({ name: 'seller_id', type: 'int', nullable: true })
  sellerId: number | null;

  // ── 스냅샷 필드 (주문 시점 가격/이름 보존) ──

  @Column({ type: 'varchar', name: 'product_name' }) 
  productName: string;

  @Column('decimal', { precision: 10, scale: 2, name: 'product_price' })
  productPrice: number;

  @Column({ type: 'text', nullable: true, name: 'product_image_url' })
  productImageUrl: string | null;

  @Column({ type: 'int' })
  quantity: number;

  @Column('decimal', { precision: 12, scale: 2 })
  subtotal: number;
}
