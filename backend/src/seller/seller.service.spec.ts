import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SellerService } from './seller.service';
import { SellerEntity, SellerStatus } from './entity/seller.entity';
import { UserModel } from '../user/entity/user.entity';
import { RoleEntity, Role } from '../user/entity/role.entity';
import { ApplySellerDto } from './dto/apply-seller.dto';
import { CommonService } from '../common/common.service';

const createMockRepository = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
});

/** approve()가 트랜잭션 안에서 쓰는 EntityManager mock */
const createMockManager = () => ({
  findOne: jest.fn(),
  update: jest.fn(),
  save: jest.fn(),
});

// ─── 공통 픽스처 ───────────────────────────────────────────
const mockApplyDto: ApplySellerDto = {
  businessName: '테스트 상점',
  businessNumber: '123-45-67890',
  representativeName: '홍길동',
  businessAddress: '서울시 강남구',
  bankName: '국민은행',
  bankAccountNumber: '123456789',
  bankAccountHolder: '홍길동',
};

const mockBuyerRole: Partial<RoleEntity> = { id: 1, name: Role.BUYER };
const mockSellerRole: Partial<RoleEntity> = { id: 2, name: Role.SELLER };

const mockPendingSeller: Partial<SellerEntity> = {
  id: 1,
  userId: 10,
  status: SellerStatus.PENDING,
  ...mockApplyDto,
};

const mockUserWithBuyer = {
  id: 10,
  roles: [{ ...mockBuyerRole }],
};

// ─── 테스트 스위트 ─────────────────────────────────────────
describe('SellerService', () => {
  let service: SellerService;
  let sellerRepository: ReturnType<typeof createMockRepository>;
  let userRepository: ReturnType<typeof createMockRepository>;
  let roleRepository: ReturnType<typeof createMockRepository>;
  let manager: ReturnType<typeof createMockManager>;
  let commonService: { paginate: jest.Mock };

  beforeEach(async () => {
    sellerRepository = createMockRepository();
    userRepository = createMockRepository();
    roleRepository = createMockRepository();
    manager = createMockManager();
    commonService = { paginate: jest.fn() };

    const dataSource = {
      transaction: jest.fn((cb: (m: typeof manager) => Promise<unknown>) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SellerService,
        { provide: getRepositoryToken(SellerEntity), useValue: sellerRepository },
        { provide: getRepositoryToken(UserModel), useValue: userRepository },
        { provide: getRepositoryToken(RoleEntity), useValue: roleRepository },
        { provide: CommonService, useValue: commonService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<SellerService>(SellerService);
  });

  /**
   * approve()의 트랜잭션 내부는 manager.findOne(엔티티, 옵션)으로 유저·역할을 조회한다.
   * 호출 순서에 의존하지 않도록 엔티티 클래스로 분기해서 응답을 라우팅한다.
   */
  const setupApproveManager = (user: { id: number; roles: Partial<RoleEntity>[] }) => {
    manager.findOne.mockImplementation((entity: unknown, options: { where: { name?: Role } }) => {
      if (entity === UserModel) return Promise.resolve(user);
      if (entity === RoleEntity) {
        return Promise.resolve(options.where.name === Role.BUYER ? mockBuyerRole : mockSellerRole);
      }
      return Promise.resolve(null);
    });
    manager.save.mockResolvedValue({});
  };

  // ─── apply ───────────────────────────────────────────────
  describe('apply', () => {
    it('성공: 신규 셀러 신청 → save 호출', async () => {
      sellerRepository.findOne.mockResolvedValue(null);
      sellerRepository.create.mockReturnValue({ userId: 10, ...mockApplyDto });
      sellerRepository.save.mockResolvedValue({ id: 1, userId: 10, status: SellerStatus.PENDING });

      const result = await service.apply(10, mockApplyDto);

      expect(sellerRepository.save).toHaveBeenCalled();
      expect(result.message).toContain('셀러 신청이 완료');
    });

    it('실패: PENDING 중복 신청 → ConflictException', async () => {
      sellerRepository.findOne.mockResolvedValue({ ...mockPendingSeller, status: SellerStatus.PENDING });

      await expect(service.apply(10, mockApplyDto)).rejects.toThrow(ConflictException);
      expect(sellerRepository.save).not.toHaveBeenCalled();
    });

    it('실패: APPROVED 중복 신청 → ConflictException', async () => {
      sellerRepository.findOne.mockResolvedValue({ ...mockPendingSeller, status: SellerStatus.APPROVED });

      await expect(service.apply(10, mockApplyDto)).rejects.toThrow(ConflictException);
    });

    it('성공: REJECTED 재신청 → update 호출 (save 아님)', async () => {
      sellerRepository.findOne.mockResolvedValue({ ...mockPendingSeller, status: SellerStatus.REJECTED });
      sellerRepository.update.mockResolvedValue({});

      const result = await service.apply(10, mockApplyDto);

      expect(sellerRepository.update).toHaveBeenCalledWith(
        mockPendingSeller.id,
        expect.objectContaining({
          status: SellerStatus.PENDING,
          rejectionReason: null,
          approvedAt: null,
        }),
      );
      expect(sellerRepository.save).not.toHaveBeenCalled();
      expect(result.message).toContain('재신청');
    });
  });

  // ─── approve ─────────────────────────────────────────────
  describe('approve', () => {
    it('성공: status APPROVED + user에 SELLER 역할 추가', async () => {
      sellerRepository.findOne.mockResolvedValue(mockPendingSeller);
      setupApproveManager({ ...mockUserWithBuyer });

      const result = await service.approve(1);

      // 상태 변경과 역할 부여는 한 트랜잭션 안에서 manager로 처리된다
      expect(manager.update).toHaveBeenCalledWith(
        SellerEntity,
        1,
        expect.objectContaining({ status: SellerStatus.APPROVED, approvedAt: expect.any(Date) }),
      );
      // user.roles에 SELLER가 추가됐는지 확인 — manager.save(엔티티, 값) 형태라 두 번째 인자
      const savedUser = manager.save.mock.calls[0][1];
      const savedRoleNames = savedUser.roles.map((r: RoleEntity) => r.name);
      expect(savedRoleNames).toContain(Role.SELLER);
      expect(savedRoleNames).toContain(Role.BUYER);
      expect(result.message).toContain('승인');
    });

    it('성공: 이미 BUYER 역할 있을 때 중복 추가 안 함', async () => {
      sellerRepository.findOne.mockResolvedValue(mockPendingSeller);
      setupApproveManager({ ...mockUserWithBuyer }); // BUYER는 이미 있음

      await service.approve(1);

      const savedUser = manager.save.mock.calls[0][1];
      const buyerRoles = savedUser.roles.filter((r: RoleEntity) => r.name === Role.BUYER);
      expect(buyerRoles).toHaveLength(1); // 중복 없음
    });

    it('실패: 존재하지 않는 sellerId → NotFoundException', async () => {
      sellerRepository.findOne.mockResolvedValue(null);

      await expect(service.approve(999)).rejects.toThrow(NotFoundException);
    });

    it('실패: PENDING 아닌 상태 승인 시도 → BadRequestException', async () => {
      sellerRepository.findOne.mockResolvedValue({ ...mockPendingSeller, status: SellerStatus.APPROVED });

      await expect(service.approve(1)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── reject ──────────────────────────────────────────────
  describe('reject', () => {
    it('성공: status REJECTED + rejectionReason 저장', async () => {
      sellerRepository.findOne.mockResolvedValue(mockPendingSeller);
      sellerRepository.update.mockResolvedValue({});

      const result = await service.reject(1, '서류 미비');

      expect(sellerRepository.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          status: SellerStatus.REJECTED,
          rejectionReason: '서류 미비',
        }),
      );
      expect(result.message).toContain('거절');
    });

    it('실패: 존재하지 않는 sellerId → NotFoundException', async () => {
      sellerRepository.findOne.mockResolvedValue(null);

      await expect(service.reject(999, '사유')).rejects.toThrow(NotFoundException);
    });

    it('실패: PENDING 아닌 상태 거절 시도 → BadRequestException', async () => {
      sellerRepository.findOne.mockResolvedValue({ ...mockPendingSeller, status: SellerStatus.APPROVED });

      await expect(service.reject(1, '사유')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getMySellerInfo ─────────────────────────────────────
  describe('getMySellerInfo', () => {
    it('성공: 셀러 정보 반환', async () => {
      sellerRepository.findOne.mockResolvedValue(mockPendingSeller);

      const result = await service.getMySellerInfo(10);

      expect(result).toEqual(mockPendingSeller);
    });

    it('실패: 신청 내역 없음 → NotFoundException', async () => {
      sellerRepository.findOne.mockResolvedValue(null);

      await expect(service.getMySellerInfo(10)).rejects.toThrow(NotFoundException);
    });
  });
});
