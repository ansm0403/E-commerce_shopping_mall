import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';
import { OpsAnalysisService } from './ops-analysis.service';
import { OpsPollerService } from './ops-poller.service';
import { SentryApiClient } from './sentry-api.client';
import { OpsDeviceTokenEntity } from './entity/ops-device-token.entity';
import { OpsPollStateEntity } from './entity/ops-poll-state.entity';
import { OpsPushLogEntity } from './entity/ops-push-log.entity';
import { OpsAnalysisEntity } from './entity/ops-analysis.entity';
import { OpsReviewEntity } from './entity/ops-review.entity';
import { OpsReviewService } from './ops-review.service';

/**
 * Ops Companion(RN 운영 앱) 백엔드 모듈 — Phase 0~3.
 * - AuthModule: JwtAuthGuard / RolesGuard 가 AuthService 로 토큰을 검증하므로 필요.
 * - RedisService: AuthModule 이 RedisModule.forRoot()(global) 을 올려 두어 별도 import 없이 주입된다.
 * - Phase 1 에서 표 3개가 붙었다(device token · 폴링 커서 · 푸시 발송 기록).
 *   폴링 스케줄러(OpsPollerService)의 @Cron 은 OrderModule 이 이미 올린 ScheduleModule.forRoot()
 *   가 스캔한다 — forRoot 는 앱 전체에 한 번만 있으면 되고, 두 번 부르면 잡이 중복 등록된다.
 * - Phase 3: ops_analyses + OpsAnalysisService. LLM_CLIENT 는 AiModule.forRoot()(global) 이 제공하므로
 *   여기서 import 하지 않는다(admin/assistant 와 같은 방식).
 * - Phase 4: ops_reviews + OpsReviewService(평가 저장·집계·few-shot 선정). OpsAnalysisService 가 이걸 주입받아
 *   프롬프트에 승인된 예시를 넣는다 — 순환 고리(설계 §1.4)의 ④→② 화살표가 이 의존성이다.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      OpsDeviceTokenEntity,
      OpsPollStateEntity,
      OpsPushLogEntity,
      OpsAnalysisEntity,
      OpsReviewEntity,
    ]),
    AuthModule,
  ],
  controllers: [OpsController],
  providers: [OpsService, OpsAnalysisService, OpsReviewService, OpsPollerService, SentryApiClient],
  exports: [OpsService],
})
export class OpsModule {}
