import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WishListService } from './wish-list.service';
import { WishListItemEntity } from './entity/wishList.entity';
import { ProductEntity } from '../product/entity/product.entity';

describe('WishListService', () => {
  let service: WishListService;

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
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
