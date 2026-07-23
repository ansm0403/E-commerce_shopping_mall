import { Test, TestingModule } from '@nestjs/testing';
import { WishListController } from './wish-list.controller';
import { WishListService } from './wish-list.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('WishListController', () => {
  let controller: WishListController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WishListController],
      providers: [
        {
          provide: WishListService,
          useValue: {
            toggle: jest.fn(),
            getMyList: jest.fn(),
            clearAll: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<WishListController>(WishListController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
