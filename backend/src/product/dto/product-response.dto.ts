import { Expose, Type } from 'class-transformer';
import { ApprovalStatus, ProductStatus, SalesType } from '../entity/product.entity';

class SellerSummaryDto {
  @Expose() id: number;
  @Expose() businessName: string;
  @Expose() representativeName: string;
  @Expose() status: string;
}

class CategorySummaryDto {
  @Expose() id: number;
  @Expose() name: string;
  @Expose() slug: string;
}

class ImageResponseDto {
  @Expose() id: number;
  @Expose() url: string;
  @Expose() isPrimary: boolean;
  @Expose() sortOrder: number;
}

class TagResponseDto {
  @Expose() id: number;
  @Expose() name: string;
}

export class ProductResponseDto {
  @Expose() id: number;
  @Expose() name: string;
  @Expose() description: string;
  @Expose() price: number;
  @Expose() brand: string;
  @Expose() stockQuantity: number;
  @Expose() status: ProductStatus;
  @Expose() approvalStatus: ApprovalStatus;
  @Expose() salesType: SalesType;
  @Expose() rejectionReason: string | null;
  @Expose() approvedAt: Date | null;
  @Expose() salesCount: number;
  @Expose() viewCount: number;
  @Expose() isEvent: boolean;
  @Expose() discountRate: number | null;
  @Expose() rating: number | null;
  @Expose() reviewCount: number;
  @Expose() wishCount: number;
  @Expose() specs: Record<string, unknown> | null;
  @Expose() categoryId: number | null;
  @Expose() sellerId: number | null;
  @Expose() createdAt: Date;
  @Expose() updatedAt: Date;

  @Expose()
  @Type(() => SellerSummaryDto)
  seller: SellerSummaryDto | null;

  @Expose()
  @Type(() => CategorySummaryDto)
  category: CategorySummaryDto | null;

  @Expose()
  @Type(() => ImageResponseDto)
  images: ImageResponseDto[];

  @Expose()
  @Type(() => TagResponseDto)
  tags: TagResponseDto[];
}
