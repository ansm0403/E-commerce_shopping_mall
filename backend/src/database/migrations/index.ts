import { MigrationInterface } from 'typeorm';
import { Init1786978325132 } from './1786978325132-Init';

/**
 * 마이그레이션 명시적 등록 배열.
 *
 * ⚠ 글롭(`migrations: ['dist/migrations/*.js']`)을 쓰면 안 된다:
 * 이 백엔드는 nx 가 단일 dist/main.js 로 번들하므로 글롭이 읽을 파일이 없어
 * "0건 실행 후 정상 종료"로 조용히 실패한다. (docs/roadmap/ex-db-migration.md §4-1①)
 *
 * 절차: `nx run @shopping-mall/backend:migration:generate --name=<이름>` 으로
 * 파일을 생성한 뒤, 여기 import + 배열에 추가해야 실행 대상이 된다.
 * (등록을 잊으면 migration:run 이 "No migrations are pending" 을 출력하므로 즉시 눈에 띈다)
 */
export const migrations: Array<new () => MigrationInterface> = [
  Init1786978325132,
];
