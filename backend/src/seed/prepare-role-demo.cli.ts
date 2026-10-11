import { DataSource } from 'typeorm';
import { connectionOptions } from '../database/connection-options';
import { ROLE_DEMO_ENTITIES } from './role-demo.entities';
import { prepareRoleDemo, clearDemoProductCache } from './prepare-role-demo';

const ds = new DataSource({
  ...connectionOptions,
  synchronize: false,
  entities: ROLE_DEMO_ENTITIES,
});

async function main() {
  const unknown = process.argv
    .slice(2)
    .filter((arg) => !['--apply', '--replenish'].includes(arg));
  if (unknown.length) throw new Error('지원하는 옵션: --apply --replenish');
  await ds.initialize();
  try {
    const report = await prepareRoleDemo(ds, {
      apply: process.argv.includes('--apply'),
      replenish: process.argv.includes('--replenish'),
    });
    const { cacheProductIds, ...summary } = report;
    console.log(
      JSON.stringify({ ...summary, cacheProductCount: cacheProductIds.length })
    );
    if (report.apply) {
      try {
        await clearDemoProductCache(cacheProductIds);
      } catch {
        throw new Error(
          'DB 적용은 완료됐지만 상품 캐시 갱신에 실패했습니다. 같은 --apply 명령으로 캐시 갱신을 재시도하세요.'
        );
      }
    }
  } finally {
    await ds.destroy();
  }
}
main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
