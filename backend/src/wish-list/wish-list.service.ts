import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WishListItemEntity } from './entity/wishList.entity';
import { ProductEntity, ApprovalStatus, ProductStatus } from '../product/entity/product.entity';
import { BasePaginateDto } from '../common/dto/paginate.dto';

@Injectable()
export class WishListService {
  constructor(
    @InjectRepository(WishListItemEntity)
    private readonly wishListItemRepository: Repository<WishListItemEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
  ) {}

  async toggle(userId: number, productId: number) {
    const product = await this.productRepository.findOne({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('상품을 찾을 수 없습니다.');
    }

    if (
      product.approvalStatus !== ApprovalStatus.APPROVED ||
      product.status !== ProductStatus.PUBLISHED
    ) {
      throw new BadRequestException('판매 중인 상품만 찜할 수 있습니다.');
    }

    const existing = await this.wishListItemRepository.findOne({
      where: { userId, productId },
    });

    if (existing) {
      await this.wishListItemRepository.remove(existing);
      await this.productRepository.decrement({ id: productId }, 'wishCount', 1);
      return { action: 'removed', productId };
    }

    const item = this.wishListItemRepository.create({ userId, productId });
    await this.wishListItemRepository.save(item);
    await this.productRepository.increment({ id: productId }, 'wishCount', 1);
    return { action: 'added', productId };
  }

  async getMyList(userId: number, query: BasePaginateDto) {
    const page = query.page ?? 1;
    const take = query.take ?? 20;

    const [items, total] = await this.wishListItemRepository.findAndCount({
      where: { userId },
      // 카드에 대표 사진을 보여 주려면 이미지가 필요하다 — 외부 링크(시드)든 셀러가 올린 /uploads 든 같은 테이블에 있다
      relations: ['product', 'product.images'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * take,
      take,
    });

    return {
      data: items,
      meta: {
        total,
        page,
        take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async getMyProductIds(userId: number) {
    const items = await this.wishListItemRepository.find({
      where: { userId },
      select: ['productId'],
      order: { createdAt: 'DESC' },
    });

    return { productIds: items.map((item) => item.productId) };
  }

  async clearAll(userId: number) {
    const items = await this.wishListItemRepository.find({
      where: { userId },
    });

    if (items.length > 0) {
      const productIds = items.map((item) => item.productId);
      await this.wishListItemRepository.remove(items);

      for (const productId of productIds) {
        await this.productRepository.decrement({ id: productId }, 'wishCount', 1);
      }
    }

    return { message: '찜 목록이 전체 삭제되었습니다.' };
  }
}
