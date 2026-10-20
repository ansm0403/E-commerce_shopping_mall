/* eslint-disable */
import {
  cleanupE2eEverything,
  createApprovedSeller,
  createDataSource,
  createUser,
  e2ePrefix,
  makeEmails,
} from '../../backend-e2e/src/support/db';
import { resetLoginRateLimits } from '../../backend-e2e/src/support/redis';
import { createApprovedProduct } from '../../backend-e2e/src/support/commerce';
import { loginRaw, SUITE, writeFixtures } from './api';

/**
 * 테스트가 쓰는 데이터를 만든다 — 구매자 1 · 승인 셀러 1 · 관리자 1 · 승인(=게시)된 상품 1.
 * 계정은 DB 로(비데모 관리자를 만드는 API 가 없다), 상품 등록·승인은 실제 HTTP 로.
 * 가격은 5만 원 미만으로 두어 배송비 3,000원이 붙는 경우를 화면에서 확인한다.
 */
export default async function globalSetup(): Promise<void> {
  const ds = createDataSource();
  await ds.initialize();
  try {
    await cleanupE2eEverything(ds, SUITE);
    await resetLoginRateLimits();

    const emails = makeEmails(SUITE);
    await createUser(ds, { email: emails.buyer, role: 'buyer' });
    const sellerUserId = await createUser(ds, { email: emails.seller, role: 'seller' });
    await createApprovedSeller(ds, {
      userId: sellerUserId,
      businessName: `${e2ePrefix(SUITE)}상점`,
      businessNumber: '777-77-70001',
    });
    await createUser(ds, { email: emails.admin, role: 'admin' });

    const seller = await loginRaw(emails.seller);
    const admin = await loginRaw(emails.admin);

    const productName = `${e2ePrefix(SUITE)}상품`;
    const price = 19900;
    const productId = await createApprovedProduct(
      seller.data.accessToken,
      admin.data.accessToken,
      { name: productName, price, stockQuantity: 50 },
    );

    writeFixtures({
      buyer: emails.buyer,
      seller: emails.seller,
      admin: emails.admin,
      productId,
      productName,
      price,
    });
    console.log(`[frontend-e2e] 준비 완료 — 구매자 ${emails.buyer}, 상품 #${productId} ${price}원`);
  } finally {
    await ds.destroy();
  }
}
