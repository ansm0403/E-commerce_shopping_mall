import { DemoPolicyService } from '../demo/demo-policy.service';
import { mockDemoPolicy } from '../demo/demo-policy.mock';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

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
  let reviews: ReturnType<typeof createMockRepository>;
  let orders: ReturnType<typeof createMockRepository>;
  let items: ReturnType<typeof createMockRepository>;
  let events: { emit: jest.Mock };
  const dto = { orderId: 1, productId: 2, rating: 5, comment: 'test' };

  beforeEach(async () => {
    reviews = createMockRepository(); orders = createMockRepository(); items = createMockRepository();
    const manager = { getRepository: () => reviews };
    Object.assign(reviews, { manager: { transaction: async (callback: (manager: object) => Promise<unknown>) => callback(manager) } });
    events = { emit: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DemoPolicyService, useValue: mockDemoPolicy() },
        ReviewService,
        { provide: getRepositoryToken(ReviewEntity), useValue: reviews },
        { provide: getRepositoryToken(OrderEntity), useValue: orders },
        { provide: getRepositoryToken(OrderItemEntity), useValue: items },
        { provide: EventEmitter2, useValue: events },
        { provide: CommonService, useValue: { paginate: jest.fn() } },
      ],
    }).compile();

    service = module.get<ReviewService>(ReviewService);
    orders.findOne.mockResolvedValue({ id: 1, userId: 10, status: 'completed' });
    items.findOne.mockResolvedValue({ orderId: 1, productId: 2 });
    reviews.findOne.mockResolvedValue(null);
    reviews.create.mockImplementation((value) => value);
    reviews.save.mockResolvedValue({ id: 3, productId: 2, rating: 5 });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.each(['pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled'])(
    'rejects a review before purchase confirmation: %s', async (status) => {
      orders.findOne.mockResolvedValue({ status });
      await expect(service.create(10, dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(reviews.save).not.toHaveBeenCalled();
    },
  );

  it('scopes the order to the buyer and rejects another buyer or missing order', async () => {
    orders.findOne.mockResolvedValue(null);
    await expect(service.create(99, dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(orders.findOne).toHaveBeenCalledWith({ where: { id: 1, userId: 99 } });
    expect(reviews.save).not.toHaveBeenCalled();
  });

  it('rejects a product that was not purchased in the order', async () => {
    items.findOne.mockResolvedValue(null);
    await expect(service.create(10, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(reviews.save).not.toHaveBeenCalled();
  });

  it('rejects sequential duplicates without saving or emitting an event', async () => {
    reviews.findOne.mockResolvedValue({ id: 3 });
    await expect(service.create(10, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(reviews.save).not.toHaveBeenCalled(); expect(events.emit).not.toHaveBeenCalled();
  });

  it('returns a validation error when a concurrent insert hits the unique constraint', async () => {
    reviews.save.mockRejectedValue(new QueryFailedError('INSERT reviews', [], Object.assign(new Error('duplicate'), { code: '23505' })));
    await expect(service.create(10, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('keeps other database failures visible', async () => {
    const failure = new Error('database unavailable'); reviews.save.mockRejectedValue(failure);
    await expect(service.create(10, dto)).rejects.toBe(failure);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('emits one event for a successfully saved review', async () => {
    await service.create(10, dto);
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith('review.created', expect.objectContaining({ reviewId: 3 }));
  });
});
