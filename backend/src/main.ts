/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

// ⚠️ Sentry 계측을 위해 반드시 다른 import보다 "최상단"에 위치해야 한다.
import './instrument';

import { ClassSerializerInterceptor, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app/app.module';
import qs from 'qs';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  // ⏱ 프로세스 타임존을 UTC 고정.
  // audit_logs.createdAt 등은 `timestamp without time zone`(naive=UTC wall-clock) 컬럼인데,
  // node-postgres 는 이 값을 읽을 때 "프로세스 로컬 타임존"으로 해석한다(KST 머신이면 -9h 어긋남).
  // 대시보드는 SQL 의 `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'` 로 DB 안에서 변환해 무관하지만,
  // raw Date 를 그대로 직렬화하는 audit 조회 API 가 어긋났다. TZ=UTC 면 읽기/쓰기가 모두 UTC 로 일치.
  process.env.TZ = 'UTC';

  const app = await NestFactory.create(AppModule);

  // Cookie Parser 미들웨어 (쿠키 읽기 위해 필요)
  app.use(cookieParser());

  // 보안 헤더 설정 (CSP 포함)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://cdn.iamport.kr'],
          styleSrc: ["'self'", "'unsafe-inline'"], // emotion, styled-components 등을 위해
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'http://localhost:4000', 'https://api.iamport.kr'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ['https://*.iamport.kr'],
        },
      },
      crossOriginEmbedderPolicy: false, // 개발 환경에서 CORS 문제 방지
    })
  );

  // CORS 설정
  // CORS_ORIGINS: 콤마로 구분된 허용 origin 목록 (이메일 링크용 FRONTEND_URL과 분리)
  // 로컬: http://localhost:3000 / 운영: https://shopping-mall-frontend-dusky.vercel.app
  // 운영은 Vercel 프록시 덕에 브라우저가 EC2를 직접 호출하지 않아 사실상 무의미하지만 명시해둠
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, cb) => {
      // origin 없는 요청(서버사이드 fetch, curl 등)은 통과
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-device-id', 'x-idempotency-key'],
  });

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('query parser', (str: string) => {
    return qs.parse(str, {
      allowDots: false,       // a.b.c 형식 비활성화
      allowPrototypes: false, // 보안: 프로토타입 오염 방지
      depth: 5,               // 최대 중첩 깊이
      parameterLimit: 100,    // 최대 파라미터 개수
      parseArrays: true,      // 배열 파싱 활성화
      comma: false,           // 쉼표로 배열 분리 (a=1,2,3)
      delimiter: '&',         // 파라미터 구분자
    });
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    })
  );

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const globalPrefix = 'v1';
  app.setGlobalPrefix(globalPrefix);
  const port = process.env.PORT || 4000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();
