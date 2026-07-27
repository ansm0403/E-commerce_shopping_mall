import { BaseModel } from "../base.model.js";

export enum SettlementStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PAID = 'paid',
}

export interface Settlement extends BaseModel {
  orderId: number;
  sellerId: number;
  orderNumber: string;
  /** ⚠ decimal 컬럼이라 실제 응답은 문자열로 올 수 있다(TypeORM + @Serialize 무변환) */
  amount: number | string;
  commissionRate: number | string;
  commissionAmount: number | string;
  settlementAmount: number | string;
  status: SettlementStatus;
  confirmedAt: string | null;
  paidAt: string | null;
  /** 관리자 목록(getAllSettlements, relations:['seller'])에만 실려 온다 */
  seller?: { id: number; businessName: string } | null;
}

/** GET /seller/settlements · /admin/settlements 필터 — 백엔드 SettlementQueryDto 와 1:1 */
export interface SettlementQuery {
  page?: number;
  take?: number;
  status?: SettlementStatus;
  sellerId?: number;
  startDate?: string;
  endDate?: string;
}

/** 정산 목록 meta — 다른 화면(lastPage/hasNextPage)과 달리 totalPages 를 준다 */
export interface SettlementPageMeta {
  total: number;
  page: number;
  take: number;
  totalPages: number;
}

export interface SettlementSummary {
  totalAmount: number;
  totalSettlement: number;
  totalCommission: number;
  pendingCount: number;
  pendingAmount: number;
  confirmedCount: number;
  paidCount: number;
}
