import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { AuditModule } from '../../audit/audit.module';
import { ProductModule } from '../../product/product.module';
import { CategoryModule } from '../../category/category.module';
import { ReviewModule } from '../../review/review.module';
import { InquiryModule } from '../../inquiry/inquiry.module';
import { AdminModule } from '../admin.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantConversationEntity } from './entity/conversation.entity';
import { AssistantMessageEntity } from './entity/message.entity';

/**
 * 관리자 AI 어시스턴트 모듈.
 * - AuthModule: JwtAuthGuard / RolesGuard 토큰 검증에 필요.
 * - AdminModule: get_sales_summary / get_order_stats 도구가 DashboardService 를 호출.
 * - AuditModule: query_audit_logs 도구가 AuditService 를 호출.
 * - ProductModule: get_product_info / summarize_* 의 카테고리→상품 변환(ProductService) 호출.
 * - CategoryModule/ReviewModule/InquiryModule: Phase 5a RAG 도구(summarize_reviews/inquiries) —
 *   카테고리명→카테고리ID 변환(CategoryService) + 리뷰/문의 읽기(Review/InquiryService).
 * - forFeature: 대화 영속화(Phase 2.5) 엔티티. autoLoadEntities 로 스키마 동기화.
 * - LLM_CLIENT: AiModule(forRoot, global)이 전역 제공하므로 별도 import 불필요.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AssistantConversationEntity,
      AssistantMessageEntity,
    ]),
    AuthModule,
    AdminModule,
    AuditModule,
    ProductModule,
    CategoryModule,
    ReviewModule,
    InquiryModule,
  ],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
