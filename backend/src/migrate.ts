import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { connectionOptions } from './database/connection-options';
import { migrations } from './database/migrations';

/**
 * 컨테이너/배포용 마이그레이션 엔트리포인트 (webpack 별도 번들 → dist/migrate.js).
 *
 * 운영 이미지에는 번들만 들어가 typeorm CLI 가 쓸 ts 소스가 없다 → 이 파일이 그 대체다.
 * Nest 전체(Redis/Sentry/cron)를 부팅하지 않고 DataSource 만 초기화한다 — 실패 표면 최소화.
 * (docs/roadmap/ex-db-migration.md §4-0-1)
 *
 * 사용법 (이미지 안 경로 기준):
 *   node backend/dist/migrate.js          # 대기 중 마이그레이션 전부 적용
 *   node backend/dist/migrate.js check    # 적용/대기 상태만 출력 (변경 없음)
 *   node backend/dist/migrate.js revert   # 마지막 1건 되돌림 (down 실행)
 */
async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'run';
  const ds = new DataSource({
    ...connectionOptions,
    migrations,
    synchronize: false,
    logging: ['schema', 'error', 'warn', 'migration'],
  });
  await ds.initialize();
  try {
    if (mode === 'run') {
      const applied = await ds.runMigrations();
      console.log(
        applied.length === 0
          ? '✓ 적용할 마이그레이션 없음 (up to date)'
          : `✓ ${applied.length}건 적용: ${applied.map((m) => m.name).join(', ')}`,
      );
    } else if (mode === 'check') {
      const hasPending = await ds.showMigrations();
      console.log(hasPending ? '⚠ 대기 중 마이그레이션 있음' : '✓ 모든 마이그레이션 적용됨');
    } else if (mode === 'revert') {
      await ds.undoLastMigration();
      console.log('✓ 마지막 마이그레이션 1건 되돌림');
    } else {
      throw new Error(`알 수 없는 모드: ${mode} (run | check | revert)`);
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('❌ migrate 실패:', err);
  process.exit(1);
});
