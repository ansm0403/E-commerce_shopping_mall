import axios from 'axios';
import { DataSource } from 'typeorm';
import { cleanupE2eData, createDataSource, createUser, makeEmails, E2E_PASSWORD } from '../support/db';
import { resetLoginRateLimits } from '../support/redis';

/** 이 스펙 전용 계정 이름공간 — 다른 스펙과 겹치지 않게 한다 */
const SUITE = 'seller-flow';
const emails = makeEmails(SUITE);

/**
 * 셀러 승인 플로우 HTTP e2e (00-role-audit §7-3 해소).
 *
 * service 레벨 검증은 backend/src/seller/seller.integration.spec.ts 에 이미 있다.
 * 여기서만 확인할 수 있는 것 — 실제 요청이 가드를 통과하는가:
 *   · RolesGuard        : buyer 토큰으로 관리자 엔드포인트 호출 시 403
 *   · DemoAccountGuard  : 데모 관리자는 승인/반려 불가 (그래서 실검증엔 비데모 ADMIN 이 필요)
 *   · 토큰 staleness    : 승인돼도 "이미 들고 있던" 토큰으로는 여전히 403, refresh 후에야 200
 *   · 직렬화            : 관리자 신청 목록 응답에 password 해시가 없는지 (회귀 방지)
 *
 * 전제: postgres·redis + `yarn nx serve backend` 가 떠 있어야 한다(support/global-setup.ts).
 */

const APPLY_BODY = {
  businessName: 'e2e 상회',
  businessNumber: '999-88-00001',
  representativeName: '이이투이',
  businessAddress: '서울시 테스트구 검증로 1',
  contactEmail: 'contact-e2e@test.local',
  contactPhone: '02-0000-0000',
  bankName: '국민은행',
  bankAccountNumber: '123456-78-901234',
  bankAccountHolder: '이이투이',
};

/** 로그인 → 액세스 토큰 + refreshToken 쿠키 */
async function login(email: string) {
  const res = await axios.post('/auth/login', { email, password: E2E_PASSWORD });
  expect(res.status).toBe(201);

  const setCookie: string[] = res.headers['set-cookie'] ?? [];
  const refreshCookie = setCookie.find((c) => c.startsWith('refreshToken='))?.split(';')[0];
  expect(refreshCookie).toBeDefined();

  return { accessToken: res.data.accessToken as string, refreshCookie: refreshCookie as string };
}

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

type Session = { accessToken: string; refreshCookie: string };

describe('셀러 승인 플로우 (HTTP e2e)', () => {
  let ds: DataSource;
  let buyerApproveId: number;
  let buyerRejectId: number;

  // 로그인은 계정당 1회만 한다 — IP당 10회/5분 제한이 있어서, 테스트마다 로그인하면
  // 연속 실행 시 429 로 죽는다. 토큰을 재사용해도 시나리오는 그대로 성립한다
  // (오히려 buyer 토큰은 "승인 전에 발급받은 것"이어야 staleness 검증이 의미가 있다).
  let buyer: Session;
  let buyerForReject: Session;
  let admin: Session;
  let demoAdmin: Session;

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();

    // 이전 실행이 중간에 죽었을 수 있으니 먼저 청소하고 시작한다.
    await cleanupE2eData(ds, SUITE);
    await resetLoginRateLimits();

    buyerApproveId = await createUser(ds, { email: emails.buyerApprove, role: 'buyer' });
    buyerRejectId = await createUser(ds, { email: emails.buyerReject, role: 'buyer' });
    await createUser(ds, { email: emails.admin, role: 'admin' });
    await createUser(ds, { email: emails.demoAdmin, role: 'admin', isDemo: true });

    buyer = await login(emails.buyerApprove);
    buyerForReject = await login(emails.buyerReject);
    admin = await login(emails.admin);
    demoAdmin = await login(emails.demoAdmin);
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanupE2eData(ds, SUITE);
      await ds.destroy();
    }
  });

  it('전체 시나리오: 신청 → 가드 검증 → 승인 → 토큰 갱신 후에야 셀러 API 통과', async () => {
    // ── ① buyer 가 셀러 신청 → PENDING 으로 저장 ──────────────────────────
    const applyRes = await axios.post('/seller/apply', APPLY_BODY, auth(buyer.accessToken));
    expect(applyRes.status).toBe(201);

    const myInfo = await axios.get('/seller/me', auth(buyer.accessToken));
    expect(myInfo.status).toBe(200);
    expect(myInfo.data.status).toBe('pending');
    // 은행 정보는 @Exclude 라 응답에 실리지 않아야 한다.
    expect(myInfo.data.bankAccountNumber).toBeUndefined();

    // ── ② buyer 토큰으로는 관리자 목록을 볼 수 없다 (RolesGuard) ──────────
    const forbidden = await axios.get('/seller/applications', auth(buyer.accessToken));
    expect(forbidden.status).toBe(403);

    // ── ③ 데모 관리자는 승인할 수 없다 (DemoAccountGuard) ─────────────────
    const demoList = await axios.get('/seller/applications', {
      ...auth(demoAdmin.accessToken),
      params: { page: 1, take: 20, status: 'pending' },
    });
    expect(demoList.status).toBe(200); // 조회는 되고

    const application = demoList.data.data.find((a: any) => a.userId === buyerApproveId);
    expect(application).toBeDefined();

    const demoApprove = await axios.patch(
      `/seller/applications/${application.id}/approve`,
      {},
      auth(demoAdmin.accessToken),
    );
    expect(demoApprove.status).toBe(403); // 변경은 막힌다

    // ── ④ 비데모 ADMIN 조회 — 응답에 password 해시가 없어야 한다 ──────────
    const adminList = await axios.get('/seller/applications', {
      ...auth(admin.accessToken),
      params: { page: 1, take: 20, status: 'pending' },
    });
    expect(adminList.status).toBe(200);
    expect(JSON.stringify(adminList.data)).not.toContain('password');
    expect(JSON.stringify(adminList.data)).not.toContain('$2b$');

    const target = adminList.data.data.find((a: any) => a.userId === buyerApproveId);
    expect(target.user.email).toBe(emails.buyerApprove);

    // ── ⑤ 비데모 ADMIN 승인 → DB 상 SELLER 역할까지 부여된다 ──────────────
    const approve = await axios.patch(
      `/seller/applications/${target.id}/approve`,
      {},
      auth(admin.accessToken),
    );
    expect(approve.status).toBe(200);

    const roles = await ds.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
      [buyerApproveId],
    );
    expect(roles.map((r: any) => r.name).sort()).toEqual(['buyer', 'seller']);

    // ── ⑥ 그런데 buyer 가 "이미 들고 있던" 토큰으로는 여전히 403 ──────────
    //     인가는 토큰에 박힌 역할 기준이라 DB 가 바뀌어도 구토큰은 그대로다(§7-2).
    const staleCall = await axios.get('/products/my', auth(buyer.accessToken));
    expect(staleCall.status).toBe(403);

    // ── ⑦ refresh 하면 DB 에서 역할을 다시 읽어 새 토큰을 준다 → 통과 ─────
    const refreshed = await axios.post(
      '/auth/refresh',
      {},
      { headers: { Cookie: buyer.refreshCookie } },
    );
    expect(refreshed.status).toBe(201);

    const newToken = refreshed.data.accessToken as string;
    const payload = JSON.parse(Buffer.from(newToken.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.roles).toContain('seller');

    const sellerCall = await axios.get('/products/my', auth(newToken));
    expect(sellerCall.status).toBe(200);
  }, 60_000);

  it('반려: 사유가 저장되고 신청자에게 그대로 보인다', async () => {
    const applyRes = await axios.post(
      '/seller/apply',
      { ...APPLY_BODY, businessNumber: '999-88-00002' },
      auth(buyerForReject.accessToken),
    );
    expect(applyRes.status).toBe(201);

    const list = await axios.get('/seller/applications', {
      ...auth(admin.accessToken),
      params: { page: 1, take: 20, status: 'pending' },
    });
    const target = list.data.data.find((a: any) => a.userId === buyerRejectId);
    expect(target).toBeDefined();

    const reason = '사업자등록번호가 조회되지 않습니다.';
    const reject = await axios.patch(
      `/seller/applications/${target.id}/reject`,
      { reason },
      auth(admin.accessToken),
    );
    expect(reject.status).toBe(200);

    const myInfo = await axios.get('/seller/me', auth(buyerForReject.accessToken));
    expect(myInfo.data.status).toBe('rejected');
    expect(myInfo.data.rejectionReason).toBe(reason);

    // 반려는 역할을 주지 않는다.
    const roles = await ds.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
      [buyerRejectId],
    );
    expect(roles.map((r: any) => r.name)).toEqual(['buyer']);
  }, 60_000);

  it('반려 사유 없이 반려하면 400', async () => {
    const res = await axios.patch(`/seller/applications/999999/reject`, {}, auth(admin.accessToken));
    expect(res.status).toBe(400); // ValidationPipe 가 reason 누락을 먼저 잡는다
  }, 30_000);
});
