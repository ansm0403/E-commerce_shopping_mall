import { BaseModel } from '../base.model.js';
import { CategorySummary } from './category.js';
import { ProductStatus } from './product.js';

/**
 * 관리자 상품 관리 (02-admin-core §2-A②).
 * 백엔드 ProductResponseDto(@Serialize) 와 1:1 — 공개 목록용 `Product` 에는 없는
 * 승인 관련 필드(approvalStatus·rejectionReason·approvedAt)와 셀러 요약이 들어 있다.
 *
 * enum 대신 `as const` 객체를 쓰는 건 같은 폴더의 ProductStatus 스타일을 따른 것.
 */

export const ApprovalStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const SalesType = {
  NORMAL: 'normal',
  PRE_ORDER: 'pre_order',
  GROUP_BUY: 'group_buy',
} as const;

export type SalesType = (typeof SalesType)[keyof typeof SalesType];

/** 상품에 붙어 오는 셀러 요약 (은행정보는 @Exclude 라 실리지 않는다) */
export interface ProductSellerSummary {
  id: number;
  businessName: string;
  representativeName: string;
  status: string;
}

/**
 * 관리자 응답의 이미지 (ProductResponseDto.ImageResponseDto).
 * 공개용 `ProductImage` 와 필드가 다르다 — 실제로 오는 건 `sortOrder` 이지 `displayOrder` 가 아니다.
 */
export interface AdminProductImage {
  id: number;
  url: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface AdminProduct extends BaseModel {
  name: string;
  description: string;
  /**
   * ⚠ 실제로는 문자열로 온다 — TypeORM decimal 이 문자열을 주고,
   * @Serialize 의 plainToInstance 는 값을 변환하지 않아 그대로 실려 나간다(예: "1760000.00").
   */
  price: number | string;
  brand: string;
  stockQuantity: number;
  status: ProductStatus;
  approvalStatus: ApprovalStatus;
  salesType: SalesType;
  rejectionReason: string | null;
  approvedAt: string | null;
  salesCount: number;
  viewCount: number;
  isEvent: boolean;
  discountRate: number | null;
  rating: number | null;
  categoryId: number | null;
  sellerId: number | null;
  /** 시드 상품처럼 셀러 없이 존재하는 건이 실제로 있다(products.seller_id 는 nullable) */
  seller: ProductSellerSummary | null;
  category: CategorySummary | null;
  images: AdminProductImage[];
  /** ⚠ findAllAdmin 의 relations 에 tags 가 없어 목록 응답에는 실려 오지 않는다 */
  tags?: { id: number; name: string }[];
}

/**
 * 관리자 목록 필터.
 * ⚠ 백엔드 findAllAdmin 이 실제로 쓰는 건 categoryId·status·approvalStatus·sellerId 뿐이다
 *   — ProductQueryDto 에 keyword/tags 가 있어도 admin 경로에서는 무시된다.
 */
export interface AdminProductQuery {
  page?: number;
  take?: number;
  approvalStatus?: ApprovalStatus;
  status?: ProductStatus;
  categoryId?: number;
  sellerId?: number;
}

export interface RejectProductRequest {
  reason: string;
}
