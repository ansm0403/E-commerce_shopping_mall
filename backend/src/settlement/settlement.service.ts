import { DemoPolicyService } from '../demo/demo-policy.service';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere, In } from 'typeorm';
import { SettlementEntity, SettlementStatus } from './entity/settlement.entity';
import { SellerEntity } from '../seller/entity/seller.entity';
import { SettlementQueryDto } from './dto/settlement-query.dto';

@Injectable()
export class SettlementService {
  constructor(
    @InjectRepository(SettlementEntity)
    private readonly settlementRepository: Repository<SettlementEntity>,
    @InjectRepository(SellerEntity)
    private readonly sellerRepository: Repository<SellerEntity>,
    private readonly demoPolicy: DemoPolicyService,
  ) {}

  // ── 셀러 전용 ──

  async getSellerSettlements(userId: number, query: SettlementQueryDto) {
    const seller = await this.findSellerByUserId(userId);
    const page = query.page ?? 1;
    const take = query.take ?? 20;

    const where: FindOptionsWhere<SettlementEntity> = { sellerId: seller.id };
    if ((await this.demoPolicy.user(userId))?.isDemo) where.orderId = In(await this.demoPolicy.fixtureOrderIds());
    if (query.status) where.status = query.status;
    if (query.startDate && query.endDate) {
      where.createdAt = Between(new Date(query.startDate), new Date(query.endDate));
    }

    const [data, total] = await this.settlementRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * take,
      take,
    });

    return {
      data,
      meta: { total, page, take, totalPages: Math.ceil(total / take) },
    };
  }

  async getSellerSummary(userId: number) {
    const seller = await this.findSellerByUserId(userId);

    const all = await this.settlementRepository.find({
      where: { sellerId: seller.id, ...((await this.demoPolicy.user(userId))?.isDemo ? { orderId: In(await this.demoPolicy.fixtureOrderIds()) } : {}) },
    });

    const pending = all.filter((s) => s.status === SettlementStatus.PENDING);
    const confirmed = all.filter((s) => s.status === SettlementStatus.CONFIRMED);
    const paid = all.filter((s) => s.status === SettlementStatus.PAID);

    return {
      totalAmount: this.sum(all, 'amount'),
      totalSettlement: this.sum(all, 'settlementAmount'),
      totalCommission: this.sum(all, 'commissionAmount'),
      pendingCount: pending.length,
      pendingAmount: this.sum(pending, 'settlementAmount'),
      confirmedCount: confirmed.length,
      paidCount: paid.length,
    };
  }

  // ── Admin 전용 ──

  async getAllSettlements(query: SettlementQueryDto) {
    const page = query.page ?? 1;
    const take = query.take ?? 20;

    const where: FindOptionsWhere<SettlementEntity> = {};
    if (query.status) where.status = query.status;
    if (query.sellerId) where.sellerId = query.sellerId;
    if (query.startDate && query.endDate) {
      where.createdAt = Between(new Date(query.startDate), new Date(query.endDate));
    }

    const [data, total] = await this.settlementRepository.findAndCount({
      where,
      relations: ['seller'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * take,
      take,
    });

    return {
      data,
      meta: { total, page, take, totalPages: Math.ceil(total / take) },
    };
  }

  async confirmSettlement(settlementId: number) {
    const settlement = await this.settlementRepository.findOne({
      where: { id: settlementId },
    });

    if (!settlement) {
      throw new NotFoundException('정산 내역을 찾을 수 없습니다.');
    }

    await this.demoPolicy.forbidFixtureOrder(settlement.orderId);
    if (settlement.status !== SettlementStatus.PENDING) {
      throw new BadRequestException(
        `PENDING 상태의 정산만 확정할 수 있습니다. (현재: ${settlement.status})`,
      );
    }

    settlement.status = SettlementStatus.CONFIRMED;
    settlement.confirmedAt = new Date();
    await this.settlementRepository.save(settlement);

    return settlement;
  }

  async markAsPaid(settlementId: number) {
    const settlement = await this.settlementRepository.findOne({
      where: { id: settlementId },
    });

    if (!settlement) {
      throw new NotFoundException('정산 내역을 찾을 수 없습니다.');
    }

    await this.demoPolicy.forbidFixtureOrder(settlement.orderId);
    if (settlement.status !== SettlementStatus.CONFIRMED) {
      throw new BadRequestException(
        `CONFIRMED 상태의 정산만 송금 완료 처리할 수 있습니다. (현재: ${settlement.status})`,
      );
    }

    settlement.status = SettlementStatus.PAID;
    settlement.paidAt = new Date();
    await this.settlementRepository.save(settlement);

    return settlement;
  }

  // ── 내부 유틸 ──

  private async findSellerByUserId(userId: number): Promise<SellerEntity> {
    const seller = await this.sellerRepository.findOne({ where: { userId } });
    if (!seller) {
      throw new NotFoundException('셀러 정보를 찾을 수 없습니다.');
    }
    return seller;
  }

  private sum(
    items: SettlementEntity[],
    field: 'amount' | 'settlementAmount' | 'commissionAmount',
  ): number {
    return items.reduce((acc, item) => acc + Number(item[field]), 0);
  }
}
