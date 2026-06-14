import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { AuditLogEntity, AuditAction } from './entity/audit-log.entity';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { BasePaginateDto } from '../common/dto/paginate.dto';
import { CommonService } from '../common/common.service';
import { UserModel } from '../user/entity/user.entity';

export interface LogData {
  userId?: number;
  action: AuditAction;
  ipAddress: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  success?: boolean;
  errorMessage?: string;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
    @InjectRepository(UserModel)
    private readonly userRepository: Repository<UserModel>,
    private readonly commonService: CommonService,
  ) {}

  async log(data: LogData): Promise<void> {
    try {
      const log = this.auditLogRepository.create({
        userId: data.userId,
        action: data.action,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        metadata: data.metadata,
        success: data.success ?? true,
        errorMessage: data.errorMessage,
      });

      await this.auditLogRepository.save(log);
    } catch (error) {
      // 로그 저장 실패는 서비스에 영향 주지 않음
      console.error('Failed to save audit log:', error);
    }
  }

  async getUserLogs(userId: number, query: BasePaginateDto) {
    return this.commonService.paginate(query, this.auditLogRepository, 'audit/user-logs', {
      where: { userId },
    });
  }

  async getAuditLogs(query: AuditLogQueryDto) {
    const { page = 1, take = 50, userId, action, success, startDate, endDate, ipAddress } = query;

    const where: any = {};

    if (userId !== undefined) where.userId = userId;
    if (action) where.action = action;
    if (success !== undefined) where.success = success;
    if (ipAddress) where.ipAddress = ipAddress;

    if (startDate && endDate) {
      where.createdAt = Between(new Date(startDate), new Date(endDate));
    } else if (startDate) {
      where.createdAt = MoreThanOrEqual(new Date(startDate));
    } else if (endDate) {
      where.createdAt = LessThanOrEqual(new Date(endDate));
    }

    const [data, total] = await this.auditLogRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take,
      skip: (page - 1) * take,
    });

    // ── 행위자 보강: userId 들을 모아 한 번에 조회(N+1 회피) ──
    // userId 가 null 인 행(FAILED_LOGIN·웹훅·크론 등)은 metadata.email 을 fallback 으로.
    const userIds = [
      ...new Set(
        data
          .map((log) => log.userId)
          .filter((id): id is number => id !== null && id !== undefined),
      ),
    ];
    const users = userIds.length
      ? await this.userRepository.find({
          where: { id: In(userIds) },
          select: ['id', 'nickName', 'email'],
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const enriched = data.map((log) => {
      const user = log.userId != null ? userMap.get(log.userId) : undefined;
      const fallbackEmail = (log.metadata?.['email'] as string | undefined) ?? null;
      return Object.assign({}, log, {
        userNickName: user?.nickName ?? null,
        userEmail: user?.email ?? fallbackEmail,
      });
    });

    const lastPage = Math.ceil(total / take);
    return {
      data: enriched,
      meta: { total, page, lastPage, take, hasNextPage: page < lastPage },
    };
  }
}
