import { forwardRef, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntity } from './entity/audit-log.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { UserModel } from '../user/entity/user.entity';

@Module({
  imports: [
    // UserModel: getAuditLogs 의 행위자(닉네임/이메일) 보강용 일괄 조회
    TypeOrmModule.forFeature([AuditLogEntity, UserModel]),
    forwardRef(() => AuthModule),
    CommonModule,
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
