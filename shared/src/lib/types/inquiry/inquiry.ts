import { BaseModel } from "../base.model.js";

export enum InquiryStatus {
  WAITING = 'waiting',
  ANSWERED = 'answered',
}

export interface Inquiry extends BaseModel {
  userId: number;
  productId: number;
  sellerId: number;
  title: string;
  content: string;
  answer: string | null;
  answeredAt: string | null;
  isSecret: boolean;
  status: InquiryStatus;
}

export interface CreateInquiryRequest {
  productId: number;
  title: string;
  content: string;
  isSecret?: boolean;
}

export interface AnswerInquiryRequest {
  answer: string;
}

export interface InquiryResponse extends Inquiry {
  user: {
    id: number;
    nickName: string;
  };
  /** 내 문의(`/inquiries/my`)·셀러 문의(`/seller/inquiries`) 목록에만 실린다. 공개 상품별 목록에는 없다. */
  product?: {
    id: number;
    name: string;
  };
}
