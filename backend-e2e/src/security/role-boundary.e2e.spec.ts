import axios from 'axios';
import { DataSource } from 'typeorm';
import { cleanupE2eEverything, createApprovedSeller, createDataSource, createUser, e2ePrefix } from '../support/db';
import { resetLoginRateLimits } from '../support/redis';
import { login } from '../support/login';
import { auth } from '../support/commerce';

/**
 * 역할 경계(§4 B) — 구매자·셀러 토큰으로 관리자/운영 API 를, 데모 관리자로 쓰기 API 를 부른다.
 * (docs/roadmap/ex-security-api-boundary.md §4 시나리오 B)
 *
 * 공격자 모델: 화면에서 `admin/*`·`ops/*` 주소를 수집한 뒤 자기 토큰으로 직접 호출한다.
 * 라우트 목록은 scripts/security/list-api-surface.mjs 의 결과(백엔드 라우트 112개 중 admin 역할 37개)다 —
 * 화면이 부르지 않는 관리자 라우트(카테고리·결제 취소·시드)도 존재하므로 함께 넣는다.
 *
 * 기대: 토큰 없음 401 · 구매자/셀러 토큰 403 · 데모 관리자의 쓰기(DemoAccountGuard) 403.
 * 가드가 핸들러보다 먼저 끊으므로 본문은 비워도 된다(400 이 아니라 403 이어야 한다).
 * 기존 스펙이 이미 다루는 것: seller-approval(구매자→신청 목록 403, 데모 승인 403) ·
 * admin-product-approval(데모 승인 403) · seller-edge-cases(데모 정산 확정 403) · mobile-token-and-ops(구매자→ops 403).
 */

const SUITE = 'role';
const p = e2ePrefix(SUITE);
const emails = {
  buyer: `${p}buyer@test.local`,
  seller: `${p}seller@test.local`,
  demoAdmin: `${p}demo-admin@test.local`,
};

type Route = [method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, demoBlocked?: true];

/** 관리자 역할 라우트 — 존재하지 않는 id 를 써도 가드가 먼저라 403 이어야 한다 */
const ADMIN_ROUTES: Route[] = [
  ['GET', '/admin/dashboard/funnel'],
  ['GET', '/admin/dashboard/kpi'],
  ['GET', '/admin/dashboard/order-trend'],
  ['GET', '/admin/dashboard/security'],
  ['GET', '/admin/audit-logs'],
  ['GET', '/admin/orders'],
  ['GET', '/admin/orders/E2E-NONE'],
  ['PATCH', '/admin/orders/E2E-NONE/deliver', true],
  ['GET', '/admin/products'],
  ['PATCH', '/admin/products/999999/approve', true],
  ['PATCH', '/admin/products/999999/reject', true],
  ['GET', '/seller/applications'],
  ['PATCH', '/seller/applications/999999/approve', true],
  ['PATCH', '/seller/applications/999999/reject', true],
  ['GET', '/admin/settlements'],
  ['PATCH', '/admin/settlements/999999/confirm', true],
  ['PATCH', '/admin/settlements/999999/pay', true],
  ['POST', '/admin/categories', true],
  ['PATCH', '/admin/categories/999999', true],
  ['DELETE', '/admin/categories/999999', true],
  ['PATCH', '/admin/categories/999999/visibility', true],
  ['POST', '/admin/payments/E2E-NONE/cancel', true],
  ['POST', '/admin/assistant/chat'],
  ['POST', '/admin/assistant/stream'],
  ['POST', '/admin/assistant/stream/cancel'],
  ['GET', '/admin/assistant/conversations/999999/messages'],
  ['GET', '/ops/incidents'],
  ['GET', '/ops/incidents/999999'],
  ['POST', '/ops/incidents/999999/analysis'],
  ['PUT', '/ops/incidents/999999/note', true],
  ['GET', '/ops/release-health'],
  ['POST', '/ops/devices'],
  ['GET', '/ops/analyses/pending'],
  ['GET', '/ops/analyses/stats'],
  ['POST', '/ops/analyses/999999/review'],
  ['POST', '/products/seed'],
];

/** 셀러 전용 — 구매자 토큰으로 403 */
const SELLER_ROUTES: Route[] = [
  ['GET', '/products/my'],
  ['POST', '/products'],
  ['PATCH', '/products/999999'],
  ['PATCH', '/products/999999/status'],
  ['DELETE', '/products/999999'],
  ['GET', '/seller/orders'],
  ['PATCH', '/seller/orders/E2E-NONE/ship'],
  ['GET', '/seller/settlements'],
  ['GET', '/seller/settlements/summary'],
  ['GET', '/seller/inquiries'],
  ['PATCH', '/seller/inquiries/999999/answer'],
];

/** 구매자 전용 — (buyer 역할이 없는) 셀러 토큰으로 403 */
const BUYER_ROUTES: Route[] = [
  ['GET', '/cart'],
  ['POST', '/cart/items'],
  ['GET', '/orders'],
  ['POST', '/orders'],
  ['PATCH', '/orders/E2E-NONE/cancel'],
  ['GET', '/wishlist'],
  ['POST', '/wishlist/toggle'],
  ['POST', '/seller/apply'],
  ['GET', '/reviews/my'],
  ['POST', '/reviews'],
  ['GET', '/inquiries/my'],
  ['POST', '/inquiries'],
];

const call = (r: Route, token?: string) =>
  axios.request({
    method: r[0],
    url: r[1],
    data: r[0] === 'GET' ? undefined : {},
    ...(token ? auth(token) : {}),
  });

/** 라우트별 결과를 모아 한 번에 단언 — 어떤 라우트가 새었는지 diff 로 보이게 한다 */
async function statusesOf(routes: Route[], token?: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of routes) out[`${r[0]} ${r[1]}`] = (await call(r, token)).status;
  return out;
}
const expectAll = (actual: Record<string, number>, code: number) =>
  expect(actual).toEqual(Object.fromEntries(Object.keys(actual).map((k) => [k, code])));

describe('역할 경계: 관리자·운영·셀러·구매자 전용 API (HTTP e2e)', () => {
  let ds: DataSource;
  let buyer: string;
  let seller: string;
  let demoAdmin: string;
  let categoriesBefore: number;

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();
    await cleanupE2eEverything(ds, SUITE);
    await resetLoginRateLimits();

    await createUser(ds, { email: emails.buyer, role: 'buyer' });
    const sellerUser = await createUser(ds, { email: emails.seller, role: 'seller' });
    await createApprovedSeller(ds, { userId: sellerUser, businessName: `${p}상회`, businessNumber: '999-55-00001' });
    await createUser(ds, { email: emails.demoAdmin, role: 'admin', isDemo: true });

    buyer = (await login(emails.buyer)).accessToken;
    seller = (await login(emails.seller)).accessToken;
    demoAdmin = (await login(emails.demoAdmin)).accessToken;
    categoriesBefore = (await ds.query(`SELECT count(*)::int AS n FROM categories`))[0].n;
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanupE2eEverything(ds, SUITE);
      await ds.destroy();
    }
  });

  it(`B-1 토큰 없이 관리자·운영 라우트 ${ADMIN_ROUTES.length}개 → 전부 401`, async () => {
    expectAll(await statusesOf(ADMIN_ROUTES), 401);
  }, 60_000);

  it(`B-2 구매자 토큰으로 관리자·운영 라우트 ${ADMIN_ROUTES.length}개 → 전부 403`, async () => {
    expectAll(await statusesOf(ADMIN_ROUTES, buyer), 403);
  }, 60_000);

  it(`B-3 셀러 토큰으로 관리자·운영 라우트 ${ADMIN_ROUTES.length}개 → 전부 403`, async () => {
    expectAll(await statusesOf(ADMIN_ROUTES, seller), 403);
  }, 60_000);

  it(`B-4 구매자 토큰으로 셀러 전용 라우트 ${SELLER_ROUTES.length}개 → 전부 403`, async () => {
    expectAll(await statusesOf(SELLER_ROUTES, buyer), 403);
  }, 60_000);

  it(`B-5 (buyer 역할 없는) 셀러 토큰으로 구매자 전용 라우트 ${BUYER_ROUTES.length}개 → 전부 403`, async () => {
    expectAll(await statusesOf(BUYER_ROUTES, seller), 403);
  }, 60_000);

  it('B-6 데모 관리자는 조회는 되지만 쓰기(DemoAccountGuard)는 전부 403 — 카테고리 수도 그대로', async () => {
    const writes = ADMIN_ROUTES.filter((r) => r[2]);
    expectAll(await statusesOf(writes, demoAdmin), 403);

    // 조회는 막히지 않아야 한다(대시보드·목록). 외부 키 없는 서버의 ops 는 503 이 정상.
    const reads = await statusesOf(
      [['GET', '/admin/dashboard/kpi'], ['GET', '/admin/orders'], ['GET', '/admin/products'], ['GET', '/seller/applications'], ['GET', '/admin/settlements']],
      demoAdmin,
    );
    for (const [route, status] of Object.entries(reads)) expect({ route, status }).toEqual({ route, status: 200 });

    const categoriesAfter = (await ds.query(`SELECT count(*)::int AS n FROM categories`))[0].n;
    expect(categoriesAfter).toBe(categoriesBefore);
  }, 60_000);
});
