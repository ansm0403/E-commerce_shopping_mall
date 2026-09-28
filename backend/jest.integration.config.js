/* eslint-disable */
/**
 * 통합 테스트(*.integration.spec.ts) 전용 jest 설정 — 진짜 PostgreSQL 을 쓰는 스펙만 돌린다.
 *
 * 기본 jest.config.ts(단위, CI)와 따로 둔 이유 셋:
 *  1. 단위 설정은 `\.integration\.spec\.ts$` 를 제외한다(DB 필요).
 *  2. 로컬 Node 22 는 jest.config.ts(ESM 판정 → __dirname 없음)를 못 읽는다 → CommonJS .js 로.
 *  3. @swc/jest 는 엔티티 순환 import(order ↔ order-item ↔ shipment, cart ↔ cart-item …)에서
 *     `design:type` 메타데이터를 만들다 TDZ("Cannot access 'OrderEntity' before initialization")로 죽는다.
 *     ts-jest 의 CommonJS 출력은 같은 자리에서 undefined 를 주고 TypeORM 은 관계 타깃을 화살표 함수로 받으므로 문제없다.
 *
 * moduleNameMapper: yarn 이 backend/node_modules 에 @nestjs/* 를 한 벌 더 깔아 두면(backend/package.json 의 "*" 의존성)
 * `@nestjs/testing`(루트)과 `@nestjs/typeorm`(backend 사본)의 ModuleRef 가 달라 DI 가 깨진다
 * ("Nest can't resolve dependencies of the TypeOrmCoreModule (…, ?)"). 전부 루트 사본으로 고정한다.
 *
 * 실행(backend/ 에서):
 *   node ../node_modules/jest/bin/jest.js -c jest.integration.config.js --runInBand
 *   PAYMENT_RACE_ROUNDS=30 node ../node_modules/jest/bin/jest.js -c jest.integration.config.js payment.concurrency
 * 사전 조건: docker-compose.local.yaml postgres(localhost:15432) + DB `shopping_mall_test`
 *   (없으면: docker exec shopping_mall-postgres-1 psql -U sangmoon -d postgres -c "create database shopping_mall_test")
 */
const path = require('path');
const ROOT_NM = path.resolve(__dirname, '..', 'node_modules');

module.exports = {
  displayName: '@shopping-mall/backend:integration',
  rootDir: __dirname,
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        diagnostics: false,
        tsconfig: {
          isolatedModules: true,
          module: 'commonjs',
          target: 'es2020',
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          skipLibCheck: true,
          strict: false,
          types: ['jest', 'node'],
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@nestjs/(.*)$': path.join(ROOT_NM, '@nestjs', '$1'),
    '^typeorm$': path.join(ROOT_NM, 'typeorm'),
    '^rxjs$': path.join(ROOT_NM, 'rxjs'),
    '^reflect-metadata$': path.join(ROOT_NM, 'reflect-metadata'),
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['**/*.integration.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  testTimeout: 60000,
  forceExit: true,
};
