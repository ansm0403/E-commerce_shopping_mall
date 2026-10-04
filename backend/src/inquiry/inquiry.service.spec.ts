import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
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

  const query = (status?: InquiryStatus) =>
    Object.assign(new SellerInquiryQueryDto(), { page: 1, status });

  beforeEach(async () => {
    sellerRepository = { findOne: jest.fn() };
    commonService = { paginate: jest.fn().mockResolvedValue({ data: [], meta: {} }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InquiryService,
        { provide: getRepositoryToken(InquiryEntity), useValue: {} },
        { provide: getRepositoryToken(ProductEntity), useValue: {} },
        { provide: getRepositoryToken(SellerEntity), useValue: sellerRepository },
        { provide: CommonService, useValue: commonService },
      ],
    }).compile();

    service = module.get<InquiryService>(InquiryService);
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
