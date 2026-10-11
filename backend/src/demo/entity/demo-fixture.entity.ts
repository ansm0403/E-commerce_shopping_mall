import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { OrderEntity } from '../../order/entity/order.entity';
import type { InquiryEntity } from '../../inquiry/entity/inquiry.entity';

export const DEMO_SCOPE = 'role-demo-v1';

@Entity('demo_fixtures')
@Unique(['scope', 'fixtureKey'])
@Check('("order_id" IS NULL) <> ("inquiry_id" IS NULL)')
export class DemoFixtureEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column() scope: string;
  @Column({ name: 'fixture_key' }) fixtureKey: string;
  @Column({ name: 'order_id', type: 'int', nullable: true, unique: true })
  orderId: number | null;
  @ManyToOne('OrderEntity', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'order_id' })
  order: OrderEntity;
  @Column({ name: 'inquiry_id', type: 'int', nullable: true, unique: true })
  inquiryId: number | null;
  @ManyToOne('InquiryEntity', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'inquiry_id' })
  inquiry: InquiryEntity;
  @CreateDateColumn() createdAt: Date;
}
