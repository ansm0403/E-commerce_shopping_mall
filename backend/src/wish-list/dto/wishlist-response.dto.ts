import { Expose, Type } from 'class-transformer';

class WishlistProductDto {
  @Expose()
  id: number;

  @Expose()
  name: string;

  @Expose()
  price: number;

  @Expose()
  status: string;

  @Expose()
  brand: string;

  @Expose()
  rating: number;
}

export class WishlistItemResponseDto {
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
  productId: number;

  @Expose()
  @Type(() => WishlistProductDto)
  product: WishlistProductDto;
}
