import { IsIn } from 'class-validator';
import { ProductStatus } from '../entity/product.entity';

/**
 * 셀러가 직접 지정할 수 있는 판매 상태.
 * DRAFT 는 등록 시 시스템이 부여하는 초기값이고, SOLD_OUT 은 재고에 따라
 * 시스템이 관리해야 할 상태라 수동 지정 대상에서 제외한다.
 */
export const SELLER_SETTABLE_STATUSES = [
  ProductStatus.PUBLISHED,
  ProductStatus.HIDDEN,
  ProductStatus.DISCONTINUED,
] as const;

export class UpdateProductStatusDto {
  @IsIn(SELLER_SETTABLE_STATUSES, {
    message: `status 는 ${SELLER_SETTABLE_STATUSES.join(', ')} 중 하나여야 합니다.`,
  })
  status: ProductStatus;
}
