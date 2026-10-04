import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WishListService } from './wish-list.service';
import { WishListItemEntity } from './entity/wishList.entity';
import { ProductEntity } from '../product/entity/product.entity';

describe('WishListService', () => {
  let service: WishListService;
  let wishListItemRepository: { find: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WishListService,
        {
          provide: getRepositoryToken(WishListItemEntity),
          useValue: { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), remove: jest.fn(), delete: jest.fn() },
        },
        {
          provide: getRepositoryToken(ProductEntity),
          useValue: { findOne: jest.fn(), find: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<WishListService>(WishListService);
    wishListItemRepository = module.get(getRepositoryToken(WishListItemEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getMyProductIds', () => {
    it('내 찜의 productId 만 조회해 배열로 돌려준다', async () => {
      wishListItemRepository.find.mockResolvedValue([{ productId: 7 }, { productId: 3 }]);

      const result = await service.getMyProductIds(1);

      expect(result).toEqual({ productIds: [7, 3] });
      expect(wishListItemRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 1 }, select: ['productId'] }),
      );
    });

    it('찜이 없으면 빈 배열', async () => {
      wishListItemRepository.find.mockResolvedValue([]);
      expect(await service.getMyProductIds(1)).toEqual({ productIds: [] });
    });
  });
});
