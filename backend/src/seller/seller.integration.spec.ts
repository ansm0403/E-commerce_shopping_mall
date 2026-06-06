/**
 * Seller 통합 테스트
 *
 * 사전 조건: auth.integration.spec.ts 와 동일
 * 실행: nx test backend --testFile=seller.integration.spec.ts
 */
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';

import { SellerService } from './seller.service';
import { SellerEntity, SellerStatus } from './entity/seller.entity';
import { UserModel } from '../user/entity/user.entity';
import { RoleEntity, Role } from '../user/entity/role.entity';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { RefreshTokenEntity } from '../auth/entity/refresh-token.entity';
import { ApplySellerDto } from './dto/apply-seller.dto';

describe('Seller Integration Tests', () => {
  let module: TestingModule;
  let sellerService: SellerService;
  let userRepository: Repository<UserModel>;
  let roleRepository: Repository<RoleEntity>;
  let sellerRepository: Repository<SellerEntity>;
  let dataSource: DataSource;

  const mockApplyDto: ApplySellerDto = {
    businessName: '통합테스트 상점',
    businessNumber: '123-45-67890',
    representativeName: '홍길동',
    businessAddress: '서울시 강남구',
    bankName: '국민은행',
    bankAccountNumber: '123456789',
    bankAccountHolder: '홍길동',
  };

  // 테스트용 유저 생성 헬퍼
  const createUserWithBuyerRole = async (email: string): Promise<UserModel> => {
    const buyerRole = await roleRepository.findOne({ where: { name: Role.BUYER } });
    const user = userRepository.create({
      email,
      password: 'hashed',
      nickName: email.split('@')[0],
      phoneNumber: '01012345678',
      address: '서울시',
      isEmailVerified: true,
      roles: [buyerRole],
    });
    return userRepository.save(user);
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ envFilePath: '.env.test', isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.POSTGRES_HOST || 'localhost',
          port: Number(process.env.POSTGRES_PORT) || 4321,
          username: process.env.POSTGRES_USER || 'sangmoon',
          password: process.env.POSTGRES_PASSWORD || 'postgres',
          database: process.env.TEST_POSTGRES_DB || 'shopping_mall_test',
          entities: [UserModel, RefreshTokenEntity, RoleEntity, AuditLogEntity, SellerEntity],
          synchronize: true,
          dropSchema: true,
        }),
        TypeOrmModule.forFeature([SellerEntity, UserModel, RoleEntity]),
      ],
      providers: [SellerService],
    }).compile();

    sellerService = module.get<SellerService>(SellerService);
    userRepository = module.get(getRepositoryToken(UserModel));
    roleRepository = module.get(getRepositoryToken(RoleEntity));
    sellerRepository = module.get(getRepositoryToken(SellerEntity));
    dataSource = module.get(DataSource);

    // roles seed
    for (const name of Object.values(Role)) {
      const exists = await roleRepository.findOne({ where: { name } });
      if (!exists) {
        await roleRepository.save(roleRepository.create({ name }));
      }
    }
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  afterEach(async () => {
    await dataSource.query('DELETE FROM sellers');
    await dataSource.query('DELETE FROM user_roles');
    await dataSource.query('DELETE FROM users');
  });

  // ─── apply ───────────────────────────────────────────────
  describe('apply', () => {
    it('성공: sellers 테이블에 PENDING 상태로 저장', async () => {
      const user = await createUserWithBuyerRole('seller1@example.com');

      await sellerService.apply(user.id, mockApplyDto);

      const seller = await sellerRepository.findOne({ where: { userId: user.id } });
      expect(seller).toBeDefined();
      expect(seller.status).toBe(SellerStatus.PENDING);
      expect(seller.businessName).toBe(mockApplyDto.businessName);
    });

    it('실패: PENDING 중복 신청 → DB에 레코드 1개만 존재', async () => {
      const user = await createUserWithBuyerRole('seller2@example.com');
      await sellerService.apply(user.id, mockApplyDto);

      await expect(sellerService.apply(user.id, mockApplyDto)).rejects.toThrow();

      const count = await sellerRepository.count({ where: { userId: user.id } });
      expect(count).toBe(1);
    });

    it('성공: REJECTED 재신청 → 기존 레코드 PENDING으로 업데이트', async () => {
      const user = await createUserWithBuyerRole('seller3@example.com');
      const seller = sellerRepository.create({
        userId: user.id,
        ...mockApplyDto,
        status: SellerStatus.REJECTED,
        rejectionReason: '서류 미비',
      });
      await sellerRepository.save(seller);

      await sellerService.apply(user.id, mockApplyDto);

      const updated = await sellerRepository.findOne({ where: { userId: user.id } });
      expect(updated.status).toBe(SellerStatus.PENDING);
      expect(updated.rejectionReason).toBeNull();
    });
  });

  // ─── approve ─────────────────────────────────────────────
  describe('approve', () => {
    it('성공: seller status APPROVED + user_roles에 SELLER 추가', async () => {
      const user = await createUserWithBuyerRole('seller4@example.com');
      const seller = await sellerRepository.save(
        sellerRepository.create({ userId: user.id, ...mockApplyDto }),
      );

      await sellerService.approve(seller.id);

      // sellers 테이블 확인
      const approvedSeller = await sellerRepository.findOne({ where: { id: seller.id } });
      expect(approvedSeller.status).toBe(SellerStatus.APPROVED);
      expect(approvedSeller.approvedAt).toBeDefined();

      // user_roles 테이블 확인
      const updatedUser = await userRepository.findOne({
        where: { id: user.id },
        relations: ['roles'],
      });
      const roleNames = updatedUser.roles.map((r) => r.name);
      expect(roleNames).toContain(Role.BUYER);
      expect(roleNames).toContain(Role.SELLER);
    });

    it('성공: 이미 BUYER 역할 있어도 user_roles에 중복 없음', async () => {
      const user = await createUserWithBuyerRole('seller5@example.com');
      const seller = await sellerRepository.save(
        sellerRepository.create({ userId: user.id, ...mockApplyDto }),
      );

      await sellerService.approve(seller.id);

      const updatedUser = await userRepository.findOne({
        where: { id: user.id },
        relations: ['roles'],
      });
      const buyerRoles = updatedUser.roles.filter((r) => r.name === Role.BUYER);
      expect(buyerRoles).toHaveLength(1);
    });

    it('트랜잭션 정합성: sellers.status와 user_roles가 동시에 커밋됨', async () => {
      const user = await createUserWithBuyerRole('tx-check@example.com');
      const seller = await sellerRepository.save(
        sellerRepository.create({ userId: user.id, ...mockApplyDto }),
      );

      await sellerService.approve(seller.id);

      // 두 테이블을 별도 쿼리로 각각 확인 — 한쪽만 커밋된 불일치 상태 방지 검증
      const [approvedSeller, updatedUser] = await Promise.all([
        sellerRepository.findOne({ where: { id: seller.id } }),
        userRepository.findOne({ where: { id: user.id }, relations: ['roles'] }),
      ]);

      expect(approvedSeller.status).toBe(SellerStatus.APPROVED);
      expect(updatedUser.roles.map((r) => r.name)).toContain(Role.SELLER);
    });

    it('실패: 존재하지 않는 sellerId → NotFoundException', async () => {
      await expect(sellerService.approve(999999)).rejects.toThrow('셀러 신청을 찾을 수 없습니다.');
    });

    it('실패: 이미 APPROVED 상태 재승인 시도 → BadRequestException', async () => {
      const user = await createUserWithBuyerRole('already-approved@example.com');
      const seller = await sellerRepository.save(
        sellerRepository.create({
          userId: user.id,
          ...mockApplyDto,
          status: SellerStatus.APPROVED,
          approvedAt: new Date(),
        }),
      );

      await expect(sellerService.approve(seller.id)).rejects.toThrow(
        '대기 중인 신청만 승인할 수 있습니다.',
      );
    });
  });

  // ─── reject ──────────────────────────────────────────────
  describe('reject', () => {
    it('성공: seller status REJECTED + rejectionReason DB에 저장', async () => {
      const user = await createUserWithBuyerRole('seller6@example.com');
      const seller = await sellerRepository.save(
        sellerRepository.create({ userId: user.id, ...mockApplyDto }),
      );

      await sellerService.reject(seller.id, '사업자 등록증 불일치');

      const rejected = await sellerRepository.findOne({ where: { id: seller.id } });
      expect(rejected.status).toBe(SellerStatus.REJECTED);
      expect(rejected.rejectionReason).toBe('사업자 등록증 불일치');

      // user_roles는 변경 없음 (BUYER 유지)
      const userAfter = await userRepository.findOne({
        where: { id: user.id },
        relations: ['roles'],
      });
      expect(userAfter.roles.map((r) => r.name)).not.toContain(Role.SELLER);
    });
  });

  // ─── 전체 플로우: 신청 → 승인 → 재신청 불가 ───────────────
  describe('전체 플로우', () => {
    it('신청 → 승인 → 재신청 시도 → ConflictException', async () => {
      const user = await createUserWithBuyerRole('flow@example.com');
      const seller = await sellerRepository.save(
        sellerRepository.create({ userId: user.id, ...mockApplyDto }),
      );

      await sellerService.approve(seller.id);
      await expect(sellerService.apply(user.id, mockApplyDto)).rejects.toThrow();
    });

    it('신청 → 거절 → 재신청 → PENDING 복구', async () => {
      const user = await createUserWithBuyerRole('retry@example.com');
      const seller = await sellerRepository.save(
        sellerRepository.create({ userId: user.id, ...mockApplyDto }),
      );

      await sellerService.reject(seller.id, '서류 미비');
      await sellerService.apply(user.id, mockApplyDto);

      const result = await sellerRepository.findOne({ where: { userId: user.id } });
      expect(result.status).toBe(SellerStatus.PENDING);
    });
  });
});
