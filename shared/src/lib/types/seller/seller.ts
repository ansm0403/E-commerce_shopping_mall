import { BaseModel } from "../base.model.js";

export enum SellerStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/** 셀러 신청 폼 (백엔드 ApplySellerDto 와 1:1) */
export interface ApplySellerRequest {
  businessName: string;
  /** 사업자 등록번호 — `000-00-00000` 형식 */
  businessNumber: string;
  representativeName: string;
  businessAddress: string;
  contactEmail?: string;
  contactPhone?: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
}

/**
 * 셀러 신청 레코드.
 * 은행 3필드(bankName/bankAccountNumber/bankAccountHolder)는 SellerEntity 에서
 * `@Exclude()` 라 응답에 실리지 않는다 — 신청 폼(ApplySellerRequest)에만 존재.
 */
export interface SellerApplication extends BaseModel {
  userId: number;
  businessName: string;
  businessNumber: string;
  representativeName: string;
  businessAddress: string;
  contactEmail: string | null;
  contactPhone: string | null;
  status: SellerStatus;
  rejectionReason: string | null;
  approvedAt: string | null;
}

/** 관리자 목록 조회는 `relations: ['user']` 로 신청자를 함께 싣는다 */
export interface SellerApplicationWithUser extends SellerApplication {
  user: {
    id: number;
    email: string;
    nickName: string;
  };
}

export interface RejectSellerRequest {
  reason: string;
}

export interface SellerApplicationQuery {
  page?: number;
  take?: number;
  status?: SellerStatus;
}
