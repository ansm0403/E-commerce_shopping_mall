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
 * 라우트 목록은 scripts/security/list-api-surface.mjs 의 결과(백엔드 라우트 107개 중 admin 역할 36개)다 —
 * 화면이 부르지 않는 관리자 라우트(카테고리·결제 취소)도 존재하므로 함께 넣는다. 미호출 라우트의 분류는 §9
 * (2026-10-20: 시드 등 5개 삭제 → REMOVED_ROUTES, 세션 관리 3개는 LOGIN_ROUTES 로 상시 확인).
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
];

/**
 * 로그인만 필요한 세션 관리 라우트 — 부르는 화면은 없지만 남겨 둔다(마이페이지 "다른 기기 로그아웃" 후보).
 * 화면이 없는 라우트는 깨져도 아무 화면이 안 깨지므로, 여기서 매 PR 경계를 확인한다(§9).
 */
const LOGIN_ROUTES: Route[] = [
  ['POST', '/auth/logout-all'],
  ['GET', '/auth/sessions'],
  ['DELETE', '/auth/sessions/00000000-0000-0000-0000-000000000000'],
];

/**
 * 2026-10-20 에 삭제한 라우트(§9 미호출 라우트 점검) — 되살아나면 여기서 빨간불.
 *   GET /            스캐폴딩 "Hello API"            → 부르는 곳 없음(운영 로그엔 스캐너만)
 *   GET /auth/check-email · check-nickname           → 부르는 화면 없음 + 계정 존재 여부 열거 가능
 *   GET /categories/:slug                            → 화면·앱 모두 트리만 씀
 *   POST /products/seed                              → 배치 경로(SEED_PRODUCTS)로 대체됐는데 데모 관리자 토큰으로 닿던 쓰기
 * 토큰을 붙여도 404 여야 한다(401/403 이면 라우트가 살아 있는 것).
 */
const REMOVED_ROUTES: Route[] = [
  ['GET', '/'],
  ['GET', '/auth/check-email?email=e2e@test.local'],
  ['GET', '/auth/check-nickname?nickName=e2e'],
  ['GET', '/categories/hats'],
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
  let buyerUserId: number;
  let sellerUserId: number;
  let categoriesBefore: number;

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();
    await cleanupE2eEverything(ds, SUITE);
    await resetLoginRateLimits();

    buyerUserId = await createUser(ds, { email: emails.buyer, role: 'buyer' });
    const sellerUser = await createUser(ds, { email: emails.seller, role: 'seller' });
    sellerUserId = sellerUser;
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

  it(`B-7 토큰 없이 세션 관리 라우트 ${LOGIN_ROUTES.length}개 → 전부 401`, async () => {
    expectAll(await statusesOf(LOGIN_ROUTES), 401);
  }, 60_000);

  it(`B-8 삭제한 라우트 ${REMOVED_ROUTES.length}개는 토큰을 붙여도 404 — 되살아나면 빨간불`, async () => {
    expectAll(await statusesOf(REMOVED_ROUTES, buyer), 404);
  }, 60_000);

  it('B-9 세션 관리(화면 없음): 남의 세션은 지울 수 없고 내 것만 보이며, logout-all 은 내 refresh 만 폐기한다', async () => {
    const [victim] = await ds.query(
      `SELECT id FROM refresh_tokens WHERE "userId" = $1 AND "isRevoked" = false ORDER BY "createdAt" DESC LIMIT 1`,
      [sellerUserId],
    );
    expect(victim).toBeDefined();

    // 남의 tokenId 로 삭제 — 존재 여부조차 알려주지 않는다(400 "세션을 찾을 수 없습니다"), 행은 그대로
    const forged = await axios.delete(`/auth/sessions/${victim.id}`, auth(buyer));
    expect(forged.status).toBe(400);
    const [after] = await ds.query(`SELECT "isRevoked" FROM refresh_tokens WHERE id = $1`, [victim.id]);
    expect(after.isRevoked).toBe(false);

    // 목록은 내 세션만
    const mine = await axios.get('/auth/sessions', auth(buyer));
    expect(mine.status).toBe(200);
    expect(mine.data.length).toBeGreaterThan(0);
    expect(mine.data.map((s: { id: string }) => s.id)).not.toContain(victim.id);

    // logout-all: 내 refresh 전부 폐기, 남의 것은 그대로 (이 스펙의 마지막 — 구매자 토큰은 이후 쓰지 않는다)
    const out = await axios.post('/auth/logout-all', {}, auth(buyer));
    expect(out.status).toBe(201);
    const [[mineLeft], [theirs]] = await Promise.all([
      ds.query(`SELECT count(*)::int AS n FROM refresh_tokens WHERE "userId" = $1 AND "isRevoked" = false`, [buyerUserId]),
      ds.query(`SELECT count(*)::int AS n FROM refresh_tokens WHERE "userId" = $1 AND "isRevoked" = false`, [sellerUserId]),
    ]);
    expect(mineLeft.n).toBe(0);
    expect(theirs.n).toBe(1);
  }, 60_000);
});
