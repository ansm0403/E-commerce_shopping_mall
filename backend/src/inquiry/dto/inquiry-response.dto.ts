import { Expose, Type } from 'class-transformer';

class InquiryAuthorDto {
  @Expose()
  id: number;

  @Expose()
  nickName: string;
}

class InquiryProductDto {
  @Expose()
  id: number;

  @Expose()
  name: string;
}

export class InquiryResponseDto {
  // ⚠ BaseModel 상속으로 두면 안 된다 — @Serialize 는 excludeExtraneousValues 라
  //   @Expose 없는 상속 필드(id/createdAt/updatedAt)가 응답에서 통째로 빠진다.
  //   (backend/CLAUDE.md §직렬화 함정 — 응답 DTO 는 기본 필드를 직접 재선언한다)
  @Expose()
  id: number;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  userId: number;

  @Expose()
  productId: number;

  @Expose()
  sellerId: number;

  @Expose()
  title: string;

  @Expose()
  content: string;

  @Expose()
  answer: string | null;

  @Expose()
  answeredAt: Date | null;

  @Expose()
  isSecret: boolean;

  @Expose()
  status: string;

  @Expose()
  @Type(() => InquiryAuthorDto)
  user: InquiryAuthorDto;

  // 내 문의·셀러 문의 목록에서만 실린다(relations 에 product 를 넣은 조회). 공개 목록에는 없다.
  @Expose()
  @Type(() => InquiryProductDto)
  product?: InquiryProductDto;
}
