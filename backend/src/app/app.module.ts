import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, HttpAdapterHost } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ProductModule } from '../product/product.module';
import { WishListModule } from '../wish-list/wish-list.module';
import { UserModule } from '../user/user.module';
import { ReviewModule } from '../review/review.module';
import { AuthModule } from '../auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { RoleEntity } from '../user/entity/role.entity';
import { RolesSeedService } from '../common/seeds/roles.seed';
import { CategoryEntity } from '../category/entity/category.entity';
import { CategorySeedService } from '../common/seeds/category.seed';
import { SellerModule } from '../seller/seller.module';
import { CategoryModule } from '../category/category.module';
import { CartModule } from '../cart/cart.module';
import { OrderModule } from '../order/order.module';
import { PaymentModule } from '../payment/payment.module';
import { SettlementModule } from '../settlement/settlement.module';
import { InquiryModule } from '../inquiry/inquiry.module';
import { AuditModule } from '../audit/audit.module';
import { AdminModule } from '../admin/admin.module';
import { SeedModule } from '../seed/seed.module';
import { AiModule } from '../intrastructure/ai/ai.module';
import { AssistantModule } from '../admin/assistant/assistant.module';

@Module({
  imports: [
    // Sentry: 다른 모듈보다 먼저 등록 (요청 컨텍스트/에러 캡처 활성화)
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      envFilePath: '.env',
      isGlobal: true,
      validate(config) {
        if (!config['FRONTEND_URL']) {
          throw new Error(
            'FRONTEND_URL environment variable is required. ' +
              'Set it to the frontend URL (e.g. https://your-app.vercel.app)',
          );
        }
        return config;
      },
    }),
    ThrottlerModule.forRoot([
      {
        // 글로벌 기본: IP당 1분에 100회
        // 봇은 이를 초과, 일반 사용자는 이 이내
        ttl: 60000,
        limit: 100,
      },
    ]),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '4321', 10),
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      autoLoadEntities: true,
      // 스키마는 마이그레이션으로만 변경한다 (2026-08-17 도입 — docs/roadmap/ex-db-migration.md).
      // 절차: 엔티티 수정 → nx run @shopping-mall/backend:migration:generate --name=<이름>
      //       → src/database/migrations/index.ts 에 등록 → migration:run
      // 실행은 앱 부팅이 아니라 배포 절차의 명시적 단계(§4-0-1 결정)이므로 migrationsRun 도 두지 않는다.
      synchronize: false,
    }),
    TypeOrmModule.forFeature([RoleEntity, CategoryEntity]),
    AuthModule,
    SellerModule,
    CategoryModule,
    ProductModule,
    ReviewModule,
    UserModule,
    WishListModule,
    CartModule,
    OrderModule,
    PaymentModule,
    SettlementModule,
    InquiryModule,
    AuditModule,
    AdminModule,
    AiModule.forRoot(),
    AssistantModule,
    ...(process.env['NODE_SEED'] === 'true' ? [SeedModule] : []),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    RolesSeedService,
    CategorySeedService,
    // 처리되지 않은 예외를 Sentry로 캡처하는 전역 필터.
    // useClass 대신 useFactory로 HttpAdapterHost의 httpAdapter를 명시적으로 주입한다.
    // (SentryGlobalFilter가 상속한 BaseExceptionFilter는 응답 처리에 httpAdapter가
    //  필요한데, useClass로는 주입이 누락돼 'isHeadersSent' 크래시가 발생함)
    {
      provide: APP_FILTER,
      useFactory: (httpAdapterHost: HttpAdapterHost) =>
        new SentryGlobalFilter(httpAdapterHost.httpAdapter),
      inject: [HttpAdapterHost],
    },
    // 모든 HTTP 엔드포인트에 ThrottlerGuard를 전역 적용
    // 개별 엔드포인트에서 @Throttle()로 override, @SkipThrottle()로 제외 가능
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
