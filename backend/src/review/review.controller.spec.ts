import { Test, TestingModule } from '@nestjs/testing';

// circular dependency 방지: OrderEntity → OrderItemEntity → OrderEntity 순환 차단
jest.mock('../order/entity/order.entity', () => ({
  OrderEntity: class OrderEntity {},
  OrderStatus: { PENDING: 'pending', PREPARING: 'preparing', SHIPPED: 'shipped', DELIVERED: 'delivered', COMPLETED: 'completed', CANCELLED: 'cancelled' },
}));

import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('ReviewController', () => {
  let controller: ReviewController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReviewController],
      providers: [
        {
          provide: ReviewService,
          useValue: {
            create: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            getProductReviewSummary: jest.fn(),
            getProductReviews: jest.fn(),
            getMyReviews: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ReviewController>(ReviewController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
