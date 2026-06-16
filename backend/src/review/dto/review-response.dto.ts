import { Expose, Type } from 'class-transformer';
import { BaseModel } from '../../common/entity/base.entity';

class ReviewAuthorDto {
  @Expose()
  id: number;

  @Expose()
  nickName: string;
}

export class ReviewResponseDto extends BaseModel {
  // BaseModel 상속 필드는 @Expose() 가 없어 excludeExtraneousValues 직렬화에서 누락된다.
  // 프론트 리뷰 수정/삭제(PATCH·DELETE /reviews/:id)·30일 수정 가드(createdAt 기준)가
  // 이 값들을 사용하므로 명시적으로 노출한다. (ex-review-frontend §1·§7)
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
  orderId: number;

  @Expose()
  rating: number;

  @Expose()
  comment: string;

  @Expose()
  imageUrls: string[];

  @Expose()
  @Type(() => ReviewAuthorDto)
  user: ReviewAuthorDto;
}
