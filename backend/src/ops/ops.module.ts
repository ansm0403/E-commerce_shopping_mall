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
import { OpsIncidentNoteEntity } from './entity/ops-incident-note.entity';
import { OpsReviewService } from './ops-review.service';
import { OpsNoteService } from './ops-note.service';
import { SourceReaderService } from './source-reader.service';
import { IdentifierCheckService } from './identifier-check.service';

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
 * - Phase 5: SourceReaderService(GitHub raw 읽기 + Redis 캐시). OpsAnalysisService 가 read_source 도구의 실행부로 쓴다.
 *   DB 는 ops_analyses.tool_calls 컬럼 하나. 새 외부 연결(GitHub)이지만 비밀값은 없다(public 저장소).
 * - Phase 7: ops_incident_notes + OpsNoteService(사실 메모 upsert). ⚠ OpsAnalysisService 는 이것을 주입받지 않는다 —
 *   메모(정답)가 LLM 입력에 들어가면 다음 분석이 오염된다. 대기 목록(OpsReviewService.listPending)만 SQL 로 JOIN 해 카드에 싣는다.
 * - Phase 8: IdentifierCheckService(조치 코드 이름 대조 — SourceReaderService.readFile 로 파일 전체를 읽어 순수 함수에 넘긴다).
 *   OpsReviewService 가 대기 카드에 칩을 붙일 때만 쓴다. DB 변경 없음.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      OpsDeviceTokenEntity,
      OpsPollStateEntity,
      OpsPushLogEntity,
      OpsAnalysisEntity,
      OpsReviewEntity,
      OpsIncidentNoteEntity,
    ]),
    AuthModule,
  ],
  controllers: [OpsController],
  providers: [
    OpsService,
    OpsAnalysisService,
    OpsReviewService,
    OpsNoteService,
    SourceReaderService,
    IdentifierCheckService,
    OpsPollerService,
    SentryApiClient,
  ],
  exports: [OpsService],
})
export class OpsModule {}
