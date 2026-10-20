/* eslint-disable */
import { cleanupE2eEverything, createDataSource } from '../../backend-e2e/src/support/db';
import { SUITE } from './api';

/** 이 스위트가 만든 계정·상품·주문·장바구니를 전부 지운다(실패한 테스트가 남긴 것 포함). */
export default async function globalTeardown(): Promise<void> {
  const ds = createDataSource();
  await ds.initialize();
  try {
    await cleanupE2eEverything(ds, SUITE);
  } finally {
    await ds.destroy();
  }
}
