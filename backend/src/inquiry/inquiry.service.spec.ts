import { DemoPolicyService } from '../demo/demo-policy.service';
import { mockDemoPolicy } from '../demo/demo-policy.mock';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InquiryService } from './inquiry.service';
import { InquiryEntity, InquiryStatus } from './entity/inquiry.entity';
import { ProductEntity } from '../product/entity/product.entity';
import { SellerEntity } from '../seller/entity/seller.entity';
import { CommonService } from '../common/common.service';
import { SellerInquiryQueryDto } from './dto/seller-inquiry-query.dto';

describe('InquiryService', () => {
  let service: InquiryService;
  let sellerRepository: { findOne: jest.Mock };
  let commonService: { paginate: jest.Mock };
  let inquiries: { findOne: jest.Mock; update: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let products: { findOne: jest.Mock };

  const query = (status?: InquiryStatus) =>
    Object.assign(new SellerInquiryQueryDto(), { page: 1, status });

  beforeEach(async () => {
    sellerRepository = { findOne: jest.fn() };
    inquiries = { findOne: jest.fn(), update: jest.fn(), save: jest.fn(), delete: jest.fn() };
    products = { findOne: jest.fn() };
    commonService = { paginate: jest.fn().mockResolvedValue({ data: [], meta: {} }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DemoPolicyService, useValue: mockDemoPolicy() },
        InquiryService,
        { provide: getRepositoryToken(InquiryEntity), useValue: inquiries },
        { provide: getRepositoryToken(ProductEntity), useValue: products },
        { provide: getRepositoryToken(SellerEntity), useValue: sellerRepository },
        { provide: CommonService, useValue: commonService },
      ],
    }).compile();

    service = module.get<InquiryService>(InquiryService);
  });

  it('rejects inquiries for products without a seller', async () => {
    products.findOne.mockResolvedValue({ id: 1, sellerId: null });
    await expect(service.create(10, { productId: 1, title: 'test', content: 'test' })).rejects.toBeInstanceOf(BadRequestException);
    expect(inquiries.save).not.toHaveBeenCalled();
  });

  it.each([null, 99])('masks a secret inquiry for viewer %s, including a deleted author', async (viewer) => {
    commonService.paginate.mockResolvedValue({ data: [{ id: 1, isSecret: true, userId: 10, user: null, title: 'private', content: 'private', answer: 'private' }] });
    const result = await service.getByProduct(2, viewer, {} as any);
    expect(result.data[0]).toEqual(expect.objectContaining({ title: '비밀 문의입니다.', content: '', answer: null, user: null }));
  });

  it('preserves secret content for the author', async () => {
    commonService.paginate.mockResolvedValue({ data: [{ isSecret: true, userId: 10, content: 'private', answer: 'reply' }] });
    const result = await service.getByProduct(2, 10, {} as any);
    expect(result.data[0]).toEqual(expect.objectContaining({ content: 'private', answer: 'reply' }));
  });

  it('rejects answering another seller inquiry', async () => {
    sellerRepository.findOne.mockResolvedValue({ id: 7 });
    inquiries.findOne.mockResolvedValue({ id: 1, sellerId: 8, status: 'waiting' });
    await expect(service.answer(20, 1, { answer: 'test' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(inquiries.update).not.toHaveBeenCalled(); expect(inquiries.save).not.toHaveBeenCalled();
  });

  it('rejects a second answer even if it was read before the first answer was saved', async () => {
    sellerRepository.findOne.mockResolvedValue({ id: 7 });
    inquiries.findOne.mockResolvedValue({ id: 1, sellerId: 7, status: 'waiting' });
    inquiries.update.mockResolvedValue({ affected: 0 });
    await expect(service.answer(20, 1, { answer: 'second' })).rejects.toBeInstanceOf(BadRequestException);
    expect(inquiries.save).not.toHaveBeenCalled();
  });

  it('saves an answer only while the inquiry is still waiting', async () => {
    sellerRepository.findOne.mockResolvedValue({ id: 7 });
    inquiries.findOne.mockResolvedValue({ id: 1, sellerId: 7, status: 'waiting' });
    inquiries.update.mockResolvedValue({ affected: 1 });
    await service.answer(20, 1, { answer: 'first' });
    expect(inquiries.update).toHaveBeenCalledWith({ id: 1, sellerId: 7, status: InquiryStatus.WAITING },
      expect.objectContaining({ answer: 'first', status: InquiryStatus.ANSWERED }));
  });

  it('does not delete an inquiry answered after the initial read', async () => {
    inquiries.findOne.mockResolvedValue({ id: 1, userId: 10, status: 'waiting' });
    inquiries.delete.mockResolvedValue({ affected: 0 });
    await expect(service.delete(10, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(inquiries.delete).toHaveBeenCalledWith({ id: 1, userId: 10, status: InquiryStatus.WAITING });
  });

  describe('getSellerInquiries', () => {
    it('status 가 있으면 where 에 넣고, 상품 관계를 함께 조회한다', async () => {
      sellerRepository.findOne.mockResolvedValue({ id: 5 });

      await service.getSellerInquiries(1, query(InquiryStatus.WAITING));

      expect(commonService.paginate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'seller/inquiries',
        { where: { sellerId: 5, status: InquiryStatus.WAITING }, relations: ['user', 'product'] },
      );
    });

    it('status 가 없으면 셀러 조건만 건다(전체)', async () => {
      sellerRepository.findOne.mockResolvedValue({ id: 5 });

      await service.getSellerInquiries(1, query());

      expect(commonService.paginate.mock.calls[0][3].where).toEqual({ sellerId: 5 });
    });

    it('셀러 정보가 없으면 404', async () => {
      sellerRepository.findOne.mockResolvedValue(null);

      await expect(service.getSellerInquiries(1, query())).rejects.toThrow(NotFoundException);
      expect(commonService.paginate).not.toHaveBeenCalled();
    });
  });
});
