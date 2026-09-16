import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';
import { SentryApiClient } from './sentry-api.client';

/**
 * Ops Companion(RN 운영 앱) 백엔드 모듈 — Phase 0.
 * - AuthModule: JwtAuthGuard / RolesGuard 가 AuthService 로 토큰을 검증하므로 필요.
 * - RedisService: AuthModule 이 RedisModule.forRoot()(global) 을 올려 두어 별도 import 없이 주입된다.
 * - Phase 1 폴링 스케줄러는 OrderModule 의 ScheduleModule.forRoot() 를 재사용하면 된다.
 */
@Module({
  imports: [AuthModule],
  controllers: [OpsController],
  providers: [OpsService, SentryApiClient],
  exports: [OpsService],
})
export class OpsModule {}
