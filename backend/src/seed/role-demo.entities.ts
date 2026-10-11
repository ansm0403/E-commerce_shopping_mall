import { UserModel } from '../user/entity/user.entity';
import { RoleEntity } from '../user/entity/role.entity';
import { SellerEntity } from '../seller/entity/seller.entity';
import { ProductEntity } from '../product/entity/product.entity';
import { ProductImageEntity } from '../product/entity/product-image.entity';
import { TagEntity } from '../product/entity/tag.entity';
import { CategoryEntity } from '../category/entity/category.entity';
import { ReviewEntity } from '../review/entity/review.entity';
import { CartEntity } from '../cart/entity/cart.entity';
import { CartItemEntity } from '../cart/entity/cart-item.entity';
import { OrderEntity } from '../order/entity/order.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import { ShipmentEntity } from '../order/entity/shipment.entity';
import { PaymentEntity } from '../payment/entity/payment.entity';
import { InquiryEntity } from '../inquiry/entity/inquiry.entity';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { DemoFixtureEntity } from '../demo/entity/demo-fixture.entity';
import { SettlementEntity } from '../settlement/entity/settlement.entity';

export const ROLE_DEMO_ENTITIES = [
  UserModel,
  RoleEntity,
  SellerEntity,
  ProductEntity,
  ProductImageEntity,
  TagEntity,
  CategoryEntity,
  ReviewEntity,
  CartEntity,
  CartItemEntity,
  OrderEntity,
  OrderItemEntity,
  ShipmentEntity,
  PaymentEntity,
  InquiryEntity,
  AuditLogEntity,
  DemoFixtureEntity,
  SettlementEntity,
];
