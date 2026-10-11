import { Expose, Type } from 'class-transformer';

class CartProductImageDto {
  @Expose() id: number;
  @Expose() url: string;
  @Expose() isPrimary: boolean;
  @Expose() sortOrder: number;
}

class CartProductSummaryDto {
  @Expose() id: number;
  @Expose() name: string;
  @Expose() price: number;
  @Expose() brand: string;
  @Expose() stockQuantity: number;
  @Expose() status: string;
  @Expose() approvalStatus: string;
  @Expose() isEvent: boolean;
  @Expose() discountRate: number | null;

  @Expose()
  @Type(() => CartProductImageDto)
  images: CartProductImageDto[];
}

class CartItemResponseDto {
  @Expose() id: number;
  @Expose() productId: number;
  @Expose() quantity: number;
  @Expose() createdAt: Date;
  @Expose() updatedAt: Date;

  @Expose()
  @Type(() => CartProductSummaryDto)
  product: CartProductSummaryDto;
}

export class CartResponseDto {
  @Expose() id: number;
  @Expose() userId: number;
  @Expose() createdAt: Date;
  @Expose() updatedAt: Date;

  @Expose()
  @Type(() => CartItemResponseDto)
  items: CartItemResponseDto[];
}
