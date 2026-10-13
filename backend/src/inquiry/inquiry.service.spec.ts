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
import { SearchIndexRecorder } from '../search/search-index-recorder';
import type { EntityManager } from 'typeorm';

describe('InquiryService', () => {
  let service: InquiryService;
  let sellerRepository: { findOne: jest.Mock };
  let commonService: { paginate: jest.Mock };
  let inquiries: { findOne: jest.Mock; update: jest.Mock; save: jest.Mock; delete: jest.Mock; create: jest.Mock; manager: { transaction: jest.Mock } };
  let products: { findOne: jest.Mock };
  let manager: EntityManager;
  let searchJobs: { recordInquiry: jest.Mock; advanceInquiry: jest.Mock };
  let demoPolicy: ReturnType<typeof mockDemoPolicy>;

  const query = (status?: InquiryStatus) =>
    Object.assign(new SellerInquiryQueryDto(), { page: 1, status });

  beforeEach(async () => {
    sellerRepository = { findOne: jest.fn() };
    inquiries = { findOne: jest.fn(), update: jest.fn(), save: jest.fn(), delete: jest.fn(), create: jest.fn(value => value), manager: { transaction: jest.fn() } };
    manager = { getRepository: jest.fn(() => inquiries), queryRunner: { isTransactionActive: true } } as unknown as EntityManager;
    inquiries.manager.transaction.mockImplementation(callback => callback(manager));
    searchJobs = { recordInquiry: jest.fn(), advanceInquiry: jest.fn() };
    demoPolicy = mockDemoPolicy();
    products = { findOne: jest.fn() };
    commonService = { paginate: jest.fn().mockResolvedValue({ data: [], meta: {} }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DemoPolicyService, useValue: demoPolicy },
        { provide: SearchIndexRecorder, useValue: searchJobs },
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
    expect(inquiries.findOne).toHaveBeenCalledWith({ where: { id: 1 }, lock: { mode: 'pessimistic_write' } });
    expect(searchJobs.advanceInquiry).toHaveBeenCalledWith(manager, 1);
    expect(inquiries.update.mock.invocationCallOrder[0]).toBeLessThan(searchJobs.advanceInquiry.mock.invocationCallOrder[0]);
  });

  it('does not delete an inquiry answered after the initial read', async () => {
    inquiries.findOne.mockResolvedValue({ id: 1, userId: 10, status: 'waiting' });
    inquiries.delete.mockResolvedValue({ affected: 0 });
    await expect(service.delete(10, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(inquiries.delete).toHaveBeenCalledWith({ id: 1, userId: 10, status: InquiryStatus.WAITING });
  });

  it('creates the public source and job with the same transaction manager', async () => {
    products.findOne.mockResolvedValue({ id: 2, sellerId: 7 });
    inquiries.save.mockResolvedValue({ id: 12 });
    inquiries.findOne.mockResolvedValue({ id: 12 });
    await expect(service.create(10, { productId: 2, title: '배송 문의', content: '언제 도착하나요?' })).resolves.toEqual({ id: 12 });
    expect(searchJobs.recordInquiry).toHaveBeenCalledWith(manager, 12);
    expect(inquiries.save.mock.invocationCallOrder[0]).toBeLessThan(searchJobs.recordInquiry.mock.invocationCallOrder[0]);
  });

  it('does not accept a source save when job recording fails', async () => {
    products.findOne.mockResolvedValue({ id: 2, sellerId: 7 });
    inquiries.save.mockResolvedValue({ id: 12 });
    searchJobs.recordInquiry.mockRejectedValue(new Error('PROFILE_MISMATCH'));
    await expect(service.create(10, { productId: 2, title: '배송 문의', content: '언제 도착하나요?' })).rejects.toThrow('PROFILE_MISMATCH');
    expect(inquiries.findOne).not.toHaveBeenCalled();
  });

  it('keeps demo creation on the already recorded demo transaction path', async () => {
    jest.spyOn(demoPolicy, 'createDemoInquiry').mockResolvedValue({ id: 15 } as never);
    inquiries.findOne.mockResolvedValue({ id: 15 });
    await service.create(10, { productId: 2, title: 'title', content: 'content' });
    expect(inquiries.manager.transaction).not.toHaveBeenCalled();
    expect(searchJobs.recordInquiry).not.toHaveBeenCalled();
  });

  it('rechecks answered state under the source lock and prevents any duplicate answer/job', async () => {
    sellerRepository.findOne.mockResolvedValue({ id: 7 });
    inquiries.findOne.mockResolvedValue({ id: 1, sellerId: 7, status: InquiryStatus.ANSWERED });
    await expect(service.answer(20, 1, { answer: 'second' })).rejects.toBeInstanceOf(BadRequestException);
    expect(inquiries.update).not.toHaveBeenCalled();
    expect(searchJobs.advanceInquiry).not.toHaveBeenCalled();
  });

  it('uses the locked source transaction for demo actor checks', async () => {
    sellerRepository.findOne.mockResolvedValue({ id: 7 });
    inquiries.findOne.mockResolvedValue({ id: 1, sellerId: 7, status: InquiryStatus.WAITING });
    inquiries.update.mockResolvedValue({ affected: 1 });
    const actorCheck = jest.spyOn(demoPolicy, 'assertInquiryActor');
    await service.answer(20, 1, { answer: 'first' });
    expect(actorCheck).toHaveBeenCalledWith(20, expect.objectContaining({ id: 1 }), manager);
  });

  it('rejects missing source or invalid owner/status before deleting', async () => {
    inquiries.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 1, userId: 99, status: InquiryStatus.WAITING })
      .mockResolvedValueOnce({ id: 1, userId: 10, status: InquiryStatus.ANSWERED });
    await expect(service.delete(10, 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete(10, 1)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.delete(10, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(inquiries.delete).not.toHaveBeenCalled();
  });

  it('deletes the locked waiting source without creating another indexing job', async () => {
    inquiries.findOne.mockResolvedValue({ id: 1, userId: 10, status: InquiryStatus.WAITING });
    inquiries.delete.mockResolvedValue({ affected: 1 });
    await expect(service.delete(10, 1)).resolves.toEqual({ message: '문의가 삭제되었습니다.' });
    expect(inquiries.findOne).toHaveBeenCalledWith({ where: { id: 1 }, lock: { mode: 'pessimistic_write' } });
    expect(searchJobs.recordInquiry).not.toHaveBeenCalled();
    expect(searchJobs.advanceInquiry).not.toHaveBeenCalled();
  });

  it.each([
    { title: '새 제목' }, { content: '새 본문' }, { answer: '수정한 답변' },
    { isSecret: true }, { isSecret: false }, { status: InquiryStatus.WAITING }, { answeredAt: null },
  ])('advances every supported internal source change: %p', async patch => {
    inquiries.update.mockResolvedValue({ affected: 1 });
    await service.saveSearchChange(manager, { id: 1 } as InquiryEntity, patch);
    expect(inquiries.update).toHaveBeenCalledWith({ id: 1 }, patch);
    expect(searchJobs.advanceInquiry).toHaveBeenCalledWith(manager, 1);
  });

  it('does not persist ownership/search metadata injected into an internal patch', async () => {
    inquiries.update.mockResolvedValue({ affected: 1 });
    await service.saveSearchChange(manager, { id: 1 } as InquiryEntity,
      { title: '허용 제목', userId: 999, sellerId: 999, searchVersion: '999' } as never);
    expect(inquiries.update).toHaveBeenCalledWith({ id: 1 }, { title: '허용 제목' });
  });

  it('does not advance empty changes or changes to a concurrently removed source', async () => {
    await service.saveSearchChange(manager, { id: 1 } as InquiryEntity, {});
    expect(inquiries.update).not.toHaveBeenCalled();
    inquiries.update.mockResolvedValue({ affected: 0 });
    await expect(service.saveSearchChange(manager, { id: 1 } as InquiryEntity, { title: 'new' })).rejects.toBeInstanceOf(BadRequestException);
    expect(searchJobs.advanceInquiry).not.toHaveBeenCalled();
  });

  it('requires an explicit transaction for internal source changes', async () => {
    await expect(service.saveSearchChange({ queryRunner: { isTransactionActive: false } } as EntityManager,
      { id: 1 } as InquiryEntity, { isSecret: true })).rejects.toThrow('SEARCH_JOB_REQUIRES_TRANSACTION');
    expect(inquiries.update).not.toHaveBeenCalled();
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
