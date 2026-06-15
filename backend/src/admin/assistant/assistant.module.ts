import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AdminModule } from '../admin.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

/**
 * 관리자 AI 어시스턴트 모듈.
 * - AuthModule: JwtAuthGuard / RolesGuard 토큰 검증에 필요.
 * - AdminModule: get_sales_summary 도구가 DashboardService를 호출(권한·검증 재사용).
 * - LLM_CLIENT: AiModule(forRoot, global)이 전역 제공하므로 별도 import 불필요.
 */
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
