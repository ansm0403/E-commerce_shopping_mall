import { Expose, Type } from 'class-transformer';

class SettlementSellerDto {
  @Expose()
  id: number;

  @Expose()
  businessName: string;
}

export class SettlementResponseDto {
  // ⚠ BaseModel 상속으로 두면 안 된다 — @Serialize 는 excludeExtraneousValues 라
  //   @Expose 없는 상속 필드(id/createdAt/updatedAt)가 응답에서 통째로 빠진다.
  //   (CLAUDE.md §직렬화 함정 — 응답 DTO 는 기본 필드를 직접 재선언한다)
  @Expose()
  id: number;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  orderId: number;

  @Expose()
  sellerId: number;

  @Expose()
  orderNumber: string;

  @Expose()
  amount: number;

  @Expose()
  commissionRate: number;

  @Expose()
  commissionAmount: number;

  @Expose()
  settlementAmount: number;

  @Expose()
  status: string;

  @Expose()
  confirmedAt: Date | null;

  @Expose()
  paidAt: Date | null;

  @Expose()
  @Type(() => SettlementSellerDto)
  seller: SettlementSellerDto;
}

export class SettlementSummaryDto {
  @Expose()
  totalAmount: number;

  @Expose()
  totalSettlement: number;

  @Expose()
  totalCommission: number;

  @Expose()
  pendingCount: number;

  @Expose()
  pendingAmount: number;

  @Expose()
  confirmedCount: number;

  @Expose()
  paidCount: number;
}
