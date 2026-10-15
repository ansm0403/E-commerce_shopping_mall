import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SellerEntity, SellerStatus } from './entity/seller.entity';
import { UserModel } from '../user/entity/user.entity';
import { RoleEntity, Role } from '../user/entity/role.entity';
import { ApplySellerDto } from './dto/apply-seller.dto';
import { SellerApplicationQueryDto } from './dto/seller-application-query.dto';
import { CommonService } from '../common/common.service';

@Injectable()
export class SellerService {
  constructor(
    @InjectRepository(SellerEntity)
    private readonly sellerRepository: Repository<SellerEntity>,
    @InjectRepository(UserModel)
    userRepository: Repository<UserModel>,
    @InjectRepository(RoleEntity)
    roleRepository: Repository<RoleEntity>,
    private readonly commonService: CommonService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 신청자가 정할 수 있는 필드만 골라 복사한다.
   *
   * 예전에는 `{ userId, ...dto }` 로 본문을 통째로 펼쳤다. 전역 ValidationPipe 에 whitelist 가 없던 동안
   * 본문의 `status`·`approvedAt`·`userId`·`id` 가 그대로 엔티티에 들어갔고, 특히 `id` 는 save() 가 UPDATE 로
   * 돌려 **남의 승인된 셀러 행을 덮어쓸 수 있었다**(docs/roadmap/ex-security-api-boundary.md §2, e2e 재현
   * backend-e2e/src/security/seller-apply-field-boundary.e2e.spec.ts). 파이프의 whitelist 가 1차 방어이고,
   * 이 함수는 파이프 설정이 빠져도 경계를 지키는 2차 방어다 — 다른 쓰기 서비스(product·review)와 같은 방식.
   */
  private pickApplicantFields(dto: ApplySellerDto) {
    return {
      businessName: dto.businessName,
      businessNumber: dto.businessNumber,
      representativeName: dto.representativeName,
      businessAddress: dto.businessAddress,
      contactEmail: dto.contactEmail,
      contactPhone: dto.contactPhone,
      bankName: dto.bankName,
      bankAccountNumber: dto.bankAccountNumber,
      bankAccountHolder: dto.bankAccountHolder,
    };
  }

  async apply(userId: number, dto: ApplySellerDto) {
    const existing = await this.sellerRepository.findOne({ where: { userId } });
    const fields = this.pickApplicantFields(dto);

    if (existing) {
      if (existing.status === SellerStatus.PENDING) {
        throw new ConflictException('이미 셀러 신청이 진행 중입니다.');
      }
      if (existing.status === SellerStatus.APPROVED) {
        throw new ConflictException('이미 승인된 셀러입니다.');
      }
      // REJECTED → 재신청 허용. 소유자(userId)·상태·승인 시각은 서버가 정한다.
      await this.sellerRepository.update(existing.id, {
        ...fields,
        status: SellerStatus.PENDING,
        rejectionReason: null,
        approvedAt: null,
      });
      return { message: '셀러 재신청이 완료되었습니다. 관리자 승인을 기다려주세요.' };
    }

    // id 를 넣지 않으므로 save() 는 항상 INSERT 다 — 남의 행을 건드릴 수 없다.
    const seller = this.sellerRepository.create({ userId, ...fields });
    await this.sellerRepository.save(seller);
    return { message: '셀러 신청이 완료되었습니다. 관리자 승인을 기다려주세요.' };
  }

  async getMySellerInfo(userId: number) {
    const seller = await this.sellerRepository.findOne({ where: { userId } });
    if (!seller) {
      throw new NotFoundException('셀러 신청 내역이 없습니다.');
    }
    return seller;
  }

  // 관리자: 신청 목록 조회
  async getApplications(query: SellerApplicationQueryDto) {
    return this.commonService.paginate(query, this.sellerRepository, 'seller/applications', {
      where: query.status ? { status: query.status } : {},
      relations: ['user'],
    });
  }

  // 관리자: 승인
  async approve(sellerId: number) {
    // 트랜잭션 바깥에서 미리 검증 (존재·상태 확인)
    const seller = await this.sellerRepository.findOne({ where: { id: sellerId } });
    if (!seller) {
      throw new NotFoundException('셀러 신청을 찾을 수 없습니다.');
    }
    if (seller.status !== SellerStatus.PENDING) {
      throw new BadRequestException('대기 중인 신청만 승인할 수 있습니다.');
    }

    // seller.status 업데이트와 user 역할 부여를 원자적으로 처리
    // — 역할 부여 실패 시 seller.status가 APPROVED로 남는 불일치 방지
    await this.dataSource.transaction(async (manager) => {
      await manager.update(SellerEntity, sellerId, {
        status: SellerStatus.APPROVED,
        approvedAt: new Date(),
      });

      const user = await manager.findOne(UserModel, {
        where: { id: seller.userId },
        relations: ['roles'],
      });
      if (!user) {
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      }

      const [buyerRole, sellerRole] = await Promise.all([
        manager.findOne(RoleEntity, { where: { name: Role.BUYER } }),
        manager.findOne(RoleEntity, { where: { name: Role.SELLER } }),
      ]);

      const rolesToAdd = [buyerRole, sellerRole].filter((r): r is RoleEntity => r !== null);
      const existingNames = user.roles.map((r) => r.name);
      const newRoles = rolesToAdd.filter((r) => !existingNames.includes(r.name));

      user.roles = [...user.roles, ...newRoles];
      await manager.save(UserModel, user);
    });

    return { message: '셀러 신청이 승인되었습니다.' };
  }

  // 관리자: 거절
  async reject(sellerId: number, reason: string) {
    const seller = await this.sellerRepository.findOne({ where: { id: sellerId } });

    if (!seller) {
      throw new NotFoundException('셀러 신청을 찾을 수 없습니다.');
    }
    if (seller.status !== SellerStatus.PENDING) {
      throw new BadRequestException('대기 중인 신청만 거절할 수 있습니다.');
    }

    await this.sellerRepository.update(sellerId, {
      status: SellerStatus.REJECTED,
      rejectionReason: reason,
    });

    return { message: '셀러 신청이 거절되었습니다.' };
  }
}
