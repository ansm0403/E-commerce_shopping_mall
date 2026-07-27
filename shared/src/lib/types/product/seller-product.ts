import { ApprovalStatus, AdminProduct, SalesType } from './admin-product.js';
import { ProductStatus } from './product.js';

/**
 * 셀러 상품 등록/관리 (01-seller-core §1-A②).
 * GET /products/my 는 관리자 목록과 같은 ProductResponseDto 로 직렬화되지만
 * relations 가 ['images','category'] 뿐이라 seller 키가 실려 오지 않는다.
 */
export type SellerProduct = Omit<AdminProduct, 'seller'>;

/**
 * 셀러가 직접 지정할 수 있는 판매 상태 — 백엔드 UpdateProductStatusDto(@IsIn) 와 1:1.
 * DRAFT 는 등록 초기값, SOLD_OUT 은 재고가 관리하는 상태라 수동 지정 불가.
 */
export const SELLER_SETTABLE_STATUSES = ['published', 'hidden', 'discontinued'] as const;
export type SellerSettableStatus = (typeof SELLER_SETTABLE_STATUSES)[number];

/** POST /products 요청 — 백엔드 CreateProductDto 와 1:1 (specs 는 후순위라 제외) */
export interface CreateProductRequest {
  name: string;
  description: string;
  price: number;
  brand: string;
  stockQuantity?: number;
  isEvent?: boolean;
  discountRate?: number;
  categoryId?: number;
  salesType?: SalesType;
}

/** PATCH /products/:id — UpdateProductDto(PartialType). 내용 수정은 재심사(PENDING 복귀)를 발동한다. */
export type UpdateProductRequest = Partial<CreateProductRequest>;

/** PATCH /products/:id/status — 재심사를 발동하지 않는 게시/숨김/단종 토글 */
export interface UpdateProductStatusRequest {
  status: SellerSettableStatus;
}

/** GET /products/my 필터 — 백엔드 findMyProducts 가 실제로 쓰는 것만 */
export interface SellerProductQuery {
  page?: number;
  take?: number;
  approvalStatus?: ApprovalStatus;
  status?: ProductStatus;
}
