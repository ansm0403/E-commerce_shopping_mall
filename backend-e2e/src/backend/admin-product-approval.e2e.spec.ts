import axios from 'axios';
import { DataSource } from 'typeorm';
import {
  cleanupE2eData,
  cleanupE2eProducts,
  createDataSource,
  createPendingProduct,
  createUser,
  e2ePrefix,
  makeEmails,
  E2E_PASSWORD,
} from '../support/db';
import { resetLoginRateLimits } from '../support/redis';

/** 이 스펙 전용 계정·상품 이름공간 — 셀러 스펙과 겹치지 않게 한다 */
const SUITE = 'product-approval';
const emails = makeEmails(SUITE);
const productName = (label: string) => `${e2ePrefix(SUITE)}${label}`;

/**
 * 관리자 상품 승인/반려 HTTP e2e (02-admin-core §2-A②).
 *
 * 셀러 승인 스펙과 같은 이유로 여기서만 확인 가능한 것들:
 *   · RolesGuard       : ADMIN 아닌 토큰은 목록조차 못 본다
 *   · DemoAccountGuard : 데모 관리자는 조회 200 / 승인 403
 *   · 상태 전이 규칙   : PENDING 인 상품만 승인·반려 가능(그 외 400)
 *   · 반려 사유 필수   : reason 없으면 ValidationPipe 가 400
 *
 * 전제: postgres·redis + `yarn nx serve backend` (support/global-setup.ts)
 */

async function login(email: string) {
  const res = await axios.post('/auth/login', { email, password: E2E_PASSWORD });
  expect(res.status).toBe(201);
  return { accessToken: res.data.accessToken as string };
}

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe('관리자 상품 승인/반려 (HTTP e2e)', () => {
  let ds: DataSource;
  let admin: { accessToken: string };
  let demoAdmin: { accessToken: string };
  let buyer: { accessToken: string };

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();

    await cleanupE2eProducts(ds, SUITE);
    await cleanupE2eData(ds, SUITE);
    await resetLoginRateLimits();

    await createUser(ds, { email: emails.buyerApprove, role: 'buyer' });
    await createUser(ds, { email: emails.admin, role: 'admin' });
    await createUser(ds, { email: emails.demoAdmin, role: 'admin', isDemo: true });

    buyer = await login(emails.buyerApprove);
    admin = await login(emails.admin);
    demoAdmin = await login(emails.demoAdmin);
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanupE2eProducts(ds, SUITE);
      await cleanupE2eData(ds, SUITE);
      await ds.destroy();
    }
  });

  it('승인: 데모 관리자는 막히고, 비데모 ADMIN 이 승인하면 approved 로 전이된다', async () => {
    const productId = await createPendingProduct(ds, { name: productName('승인대상') });

    // buyer 토큰은 목록조차 볼 수 없다 (RolesGuard)
    const buyerList = await axios.get('/admin/products', auth(buyer.accessToken));
    expect(buyerList.status).toBe(403);

    // 데모 관리자는 조회는 되고 승인만 막힌다 (DemoAccountGuard)
    const demoList = await axios.get('/admin/products', {
      ...auth(demoAdmin.accessToken),
      params: { page: 1, take: 20, approvalStatus: 'pending' },
    });
    expect(demoList.status).toBe(200);
    expect(demoList.data.data.some((p: any) => p.id === productId)).toBe(true);

    const demoApprove = await axios.patch(
      `/admin/products/${productId}/approve`,
      {},
      auth(demoAdmin.accessToken),
    );
    expect(demoApprove.status).toBe(403);

    // 비데모 ADMIN 승인
    const approve = await axios.patch(
      `/admin/products/${productId}/approve`,
      {},
      auth(admin.accessToken),
    );
    expect(approve.status).toBe(200);
    expect(approve.data.approvalStatus).toBe('approved');
    expect(approve.data.approvedAt).not.toBeNull();

    // 이미 승인된 상품은 다시 승인할 수 없다
    const twice = await axios.patch(
      `/admin/products/${productId}/approve`,
      {},
      auth(admin.accessToken),
    );
    expect(twice.status).toBe(400);
  }, 60_000);

  it('반려: 사유가 필수이고, 저장된 사유가 응답에 실린다', async () => {
    const productId = await createPendingProduct(ds, { name: productName('반려대상') });

    // reason 누락 → ValidationPipe 400
    const noReason = await axios.patch(
      `/admin/products/${productId}/reject`,
      {},
      auth(admin.accessToken),
    );
    expect(noReason.status).toBe(400);

    const reason = '상품 이미지가 실제 상품과 일치하지 않습니다.';
    const reject = await axios.patch(
      `/admin/products/${productId}/reject`,
      { reason },
      auth(admin.accessToken),
    );
    expect(reject.status).toBe(200);
    expect(reject.data.approvalStatus).toBe('rejected');
    expect(reject.data.rejectionReason).toBe(reason);

    // ⚠ 반려된 상품은 되살릴 수 없다 — approve 도 PENDING 만 받는다.
    //   셀러가 수정해도 PENDING 으로 돌아가는 건 APPROVED 인 경우뿐이라(product.service.ts),
    //   현재 설계상 반려는 사실상 최종 결정이다. 이 테스트는 그 사실을 고정해 둔다.
    const revive = await axios.patch(
      `/admin/products/${productId}/approve`,
      {},
      auth(admin.accessToken),
    );
    expect(revive.status).toBe(400);
  }, 60_000);

  it('목록: approvalStatus 필터가 실제로 적용된다', async () => {
    const pendingId = await createPendingProduct(ds, { name: productName('필터확인') });

    const pendingList = await axios.get('/admin/products', {
      ...auth(admin.accessToken),
      params: { page: 1, take: 100, approvalStatus: 'pending' },
    });
    expect(pendingList.status).toBe(200);
    expect(pendingList.data.data.every((p: any) => p.approvalStatus === 'pending')).toBe(true);
    expect(pendingList.data.data.some((p: any) => p.id === pendingId)).toBe(true);

    const approvedList = await axios.get('/admin/products', {
      ...auth(admin.accessToken),
      params: { page: 1, take: 5, approvalStatus: 'approved' },
    });
    expect(approvedList.data.data.every((p: any) => p.approvalStatus === 'approved')).toBe(true);
    expect(approvedList.data.data.some((p: any) => p.id === pendingId)).toBe(false);
  }, 60_000);
});
