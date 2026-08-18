import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { connectionOptions } from './connection-options';
import { migrations } from './migrations';

/**
 * typeorm CLI(migration:generate/run/revert/show) 전용 DataSource.
 * 앱 런타임은 app.module.ts 의 TypeOrmModule.forRoot(autoLoadEntities)를 그대로 쓴다.
 *
 * - 접속 정보는 connection-options.ts 공용(마이그레이션 실행 경로와 동일 — 드리프트 방지).
 *   dotenv 는 이미 설정된 프로세스 env 를 덮어쓰지 않으므로,
 *   `POSTGRES_DB=other yarn nx run ...` 처럼 호출 시점 오버라이드가 가능하다.
 * - entities 는 CLI 전용 글롭: ts 소스가 디스크에 있는 CLI 컨텍스트에서만 동작한다.
 *   (@Entity 데코레이터가 없는 클래스(예: BeautyEntity 등 서브타입 6종)는 무시되므로 안전)
 * - migrations 는 번들 제약 때문에 명시적 배열(./migrations/index.ts 참조).
 * - cwd 는 backend/ 여야 한다(.env 로딩, entities 글롭 모두 cwd 상대) — nx 타깃이 보장.
 */
export default new DataSource({
  ...connectionOptions,
  entities: ['src/**/*.entity.ts'],
  migrations,
  synchronize: false,
});
