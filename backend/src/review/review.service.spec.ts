import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

// circular dependency 방지: OrderEntity → OrderItemEntity → OrderEntity 순환 차단
jest.mock('../order/entity/order.entity', () => ({
  OrderEntity: class OrderEntity {},
  OrderStatus: { PENDING: 'pending', PREPARING: 'preparing', SHIPPED: 'shipped', DELIVERED: 'delivered', COMPLETED: 'completed', CANCELLED: 'cancelled' },
}));

import { ReviewService } from './review.service';
import { ReviewEntity } from './entity/review.entity';
import { OrderEntity } from '../order/entity/order.entity';
import { OrderItemEntity } from '../order/entity/order-item.entity';
import { CommonService } from '../common/common.service';

const createMockRepository = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('ReviewService', () => {
  let service: ReviewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: getRepositoryToken(ReviewEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(OrderEntity), useValue: createMockRepository() },
        { provide: getRepositoryToken(OrderItemEntity), useValue: createMockRepository() },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: CommonService, useValue: { paginate: jest.fn() } },
      ],
    }).compile();

    service = module.get<ReviewService>(ReviewService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
