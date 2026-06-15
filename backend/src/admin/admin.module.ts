import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from '../order/entity/order.entity';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';

/**
 * 관리자 대시보드 전용 모듈.
 * audit_logs + orders 두 도메인을 read-only로 조회만 한다.
 * - audit/order 모듈에 추가하지 않는 이유: 양방향 의존을 피하기 위해.
 * - AuthModule import: JwtAuthGuard / RolesGuard에서 토큰 검증에 필요.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OrderEntity, AuditLogEntity]),
    AuthModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService], // AI 어시스턴트(get_sales_summary 도구)에서 재사용
})
export class AdminModule {}
