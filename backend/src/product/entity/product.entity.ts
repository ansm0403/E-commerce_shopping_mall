import type { ReviewEntity } from '../../review/entity/review.entity';
import type { SellerEntity } from '../../seller/entity/seller.entity';
import type { CategoryEntity } from '../../category/entity/category.entity';
import { BaseModel } from '../../common/entity/base.entity';
import { Entity, Column, OneToMany, ManyToOne, ManyToMany, JoinTable, JoinColumn } from 'typeorm';
import { TagEntity } from './tag.entity';
import { ProductImageEntity } from './product-image.entity';

export enum ProductCategory {
  BEAUTY = 'BEAUTY',
  CLOTHING = 'CLOTHING',
  FOOD = 'FOOD',
  BOOK = 'BOOK',
  LIVING = 'LIVING',
  SHOES = 'SHOES',
}

export enum ProductStatus {
  DRAFT = 'draft',           // 작성 중 (아직 등록 안 함)
  PUBLISHED = 'published',   // 판매 중 (고객에게 보임)
  SOLD_OUT = 'sold_out',     // 품절
  HIDDEN = 'hidden',         // 숨김 (판매자가 일시적으로 숨김)
  DISCONTINUED = 'discontinued'  // 단종
}

export enum ApprovalStatus {
  PENDING = 'pending',       // 관리자 승인 대기
  APPROVED = 'approved',     // 승인됨
  REJECTED = 'rejected',     // 거절됨
}

export enum SalesType {
  NORMAL = 'normal',         // 일반 판매
  PRE_ORDER = 'pre_order',   // 예약 판매
  GROUP_BUY = 'group_buy',   // 공동구매
}

@Entity('products')
export class ProductEntity extends BaseModel {
  /** Stable identity for catalog fixtures; seller-created products leave this null. */
  @Column({ name: 'seed_key', type: 'varchar', nullable: true, unique: true })
  seedKey: string | null;

  @Column()
  name: string;

  @Column('text')
  description: string;

  @Column('decimal', { precision: 10, scale: 2 })
  price: number;

  @Column()
  brand: string;

  @Column({ type: 'int', default: 0 })
  stockQuantity: number;

  @Column({
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.DRAFT,
  })
  status: ProductStatus;

  @Column({
    type: 'enum',
    enum: ApprovalStatus,
    default: ApprovalStatus.PENDING,
    name: 'approval_status',
  })
  approvalStatus: ApprovalStatus;

  @Column({
    type: 'enum',
    enum: SalesType,
    default: SalesType.NORMAL,
    name: 'sales_type',
  })
  salesType: SalesType;

  @Column({ nullable: true, type: 'text', name: 'rejection_reason' })
  rejectionReason: string | null;

  @Column({ type: 'timestamp', nullable: true, name: 'approved_at' })
  approvedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  salesCount: number;

  @Column({ type: 'int', default: 0 })
  viewCount: number;

  @Column()
  isEvent: boolean;

  @Column({ nullable: true })
  discountRate?: number;

  @Column('decimal', { precision: 3, scale: 1, nullable: true })
  rating?: number;

  @Column({
    type: 'jsonb',
    default: {},
  })
  specs: Record<string, any>;

  // 셀러 연결
  @Column({ name: 'seller_id', nullable: true })
  sellerId: number | null;

  @ManyToOne('SellerEntity', 'products', { nullable: true })
  @JoinColumn({ name: 'seller_id' })
  seller: SellerEntity | null;

  // 카테고리 연결 (CategoryEntity 트리)
  @Column({ name: 'category_id', nullable: true })
  categoryId: number | null;

  @ManyToOne('CategoryEntity', 'products', { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category: CategoryEntity | null;

  // 이미지
  @OneToMany(() => ProductImageEntity, (img) => img.product, { cascade: true })
  images: ProductImageEntity[];

  @Column({ type: 'int', default: 0 })
  reviewCount: number;

  @Column({ type: 'int', default: 0 })
  ratingSum: number;

  @Column({ type: 'int', default: 0 })
  wishCount: number;

  @OneToMany('ReviewEntity', 'product')
  reviews: ReviewEntity[];

  @ManyToMany(() => TagEntity, (tag) => tag.products, { cascade: true })
  @JoinTable({
    name: 'product_tags',
    joinColumn: { name: 'product_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags: TagEntity[];
}
