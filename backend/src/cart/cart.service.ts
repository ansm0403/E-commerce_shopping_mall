import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CartEntity } from './entity/cart.entity';
import { CartItemEntity } from './entity/cart-item.entity';
import { ProductEntity, ProductStatus, ApprovalStatus } from '../product/entity/product.entity';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartEntity)
    private readonly cartRepository: Repository<CartEntity>,
    @InjectRepository(CartItemEntity)
    private readonly cartItemRepository: Repository<CartItemEntity>,
    @InjectRepository(ProductEntity)
    private readonly productRepository: Repository<ProductEntity>,
  ) {}

  /** 카트 조회, 없으면 자동 생성 */
  private async getOrCreateCart(userId: number): Promise<CartEntity> {
    let cart = await this.cartRepository.findOne({ where: { userId } });
    if (!cart) {
      cart = this.cartRepository.create({ userId });
      cart = await this.cartRepository.save(cart);
    }
    return cart;
  }

  /** 구매 가능한 상품인지 검증 */
  private async getAvailableProduct(productId: number): Promise<ProductEntity> {
    const product = await this.productRepository.findOne({
      where: { id: productId },
      relations: ['images'],
    });
    if (!product) {
      throw new NotFoundException(`상품 ID ${productId}를 찾을 수 없습니다.`);
    }
    if (product.approvalStatus !== ApprovalStatus.APPROVED) {
      throw new BadRequestException('승인된 상품만 장바구니에 담을 수 있습니다.');
    }
    if (product.status !== ProductStatus.PUBLISHED) {
      throw new BadRequestException('현재 판매 중인 상품만 장바구니에 담을 수 있습니다.');
    }
    return product;
  }

  /** 내 장바구니 조회 */
  async getMyCart(userId: number): Promise<CartEntity> {
    const cart = await this.getOrCreateCart(userId);

    return this.cartRepository.findOneOrFail({
      where: { id: cart.id },
      relations: ['items', 'items.product', 'items.product.images'],
      order: { items: { createdAt: 'DESC' } },
    });
  }

  /** 장바구니에 상품 추가 (이미 있으면 수량 합산) */
  async addItem(userId: number, dto: AddCartItemDto): Promise<CartEntity> {
    const cart = await this.getOrCreateCart(userId);
    const product = await this.getAvailableProduct(dto.productId);

    // 재고 soft check
    if (product.stockQuantity < dto.quantity) {
      throw new BadRequestException(
        `재고가 부족합니다. 현재 재고: ${product.stockQuantity}개`,
      );
    }

    // 기존 아이템 확인
    const existingItem = await this.cartItemRepository.findOne({
      where: { cartId: cart.id, productId: dto.productId },
    });

    if (existingItem) {
      const newQuantity = existingItem.quantity + dto.quantity;
      if (product.stockQuantity < newQuantity) {
        throw new BadRequestException(
          `재고가 부족합니다. 현재 재고: ${product.stockQuantity}개, 장바구니 수량: ${existingItem.quantity}개`,
        );
      }
      existingItem.quantity = newQuantity;
      await this.cartItemRepository.save(existingItem);
    } else {
      const item = this.cartItemRepository.create({
        cartId: cart.id,
        productId: dto.productId,
        quantity: dto.quantity,
      });
      await this.cartItemRepository.save(item);
    }

    return this.getMyCart(userId);
  }

  /** 장바구니 아이템 수량 변경 */
  async updateItemQuantity(
    userId: number,
    itemId: number,
    dto: UpdateCartItemDto,
  ): Promise<CartEntity> {
    const cart = await this.getOrCreateCart(userId);
    const item = await this.cartItemRepository.findOne({
      where: { id: itemId, cartId: cart.id },
    });
    if (!item) {
      throw new NotFoundException('장바구니 아이템을 찾을 수 없습니다.');
    }

    // 재고 soft check
    const product = await this.getAvailableProduct(item.productId);
    if (product.stockQuantity < dto.quantity) {
      throw new BadRequestException(
        `재고가 부족합니다. 현재 재고: ${product.stockQuantity}개`,
      );
    }

    item.quantity = dto.quantity;
    await this.cartItemRepository.save(item);

    return this.getMyCart(userId);
  }

  /** 장바구니 아이템 삭제 */
  async removeItem(userId: number, itemId: number): Promise<CartEntity> {
    const cart = await this.getOrCreateCart(userId);
    const item = await this.cartItemRepository.findOne({
      where: { id: itemId, cartId: cart.id },
    });
    if (!item) {
      throw new NotFoundException('장바구니 아이템을 찾을 수 없습니다.');
    }

    await this.cartItemRepository.remove(item);
    return this.getMyCart(userId);
  }

  /** 장바구니 전체 비우기 */
  async clearCart(userId: number): Promise<void> {
    const cart = await this.cartRepository.findOne({ where: { userId } });
    if (!cart) return;

    await this.cartItemRepository.delete({ cartId: cart.id });
  }
}
