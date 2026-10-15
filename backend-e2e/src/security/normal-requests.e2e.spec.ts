import axios from 'axios';
import { DataSource } from 'typeorm';
import { cleanupE2eEverything, createApprovedSeller, createDataSource, createUser, E2E_PASSWORD, e2ePrefix } from '../support/db';
import { resetLoginRateLimits } from '../support/redis';
import { login, loginRaw } from '../support/login';
import { addToCart, auth, completeOrder, createOrder } from '../support/commerce';

/**
 * 정상 회귀(§4 D) — 각 화면이 **실제로 보내는 본문을 그대로** 보낸다. 전부 2xx 여야 한다.
 * (docs/roadmap/ex-security-api-boundary.md §4 시나리오 D)
 *
 * 본문의 키는 프론트 요청 타입(shared/src/lib/types 의 *Request, frontend/src/model/order.ts)과 운영 앱(ops-companion/src/lib/api.ts)에서
 * 그대로 옮겼고, **선택 키까지 전부 채운다** — forbidNonWhitelisted(거절) 를 켰을 때 400 이 날 키가 있으면 여기서 드러난다.
 * 정적 선행 점검은 scripts/security/compare-request-types.mjs.
 *
 * 넣지 않은 것: 회원가입·인증 메일 재발송(SMTP 발송이 끼어 외부 키 없는 서버에서는 결과가 환경에 좌우된다),
 * 결제 검증·환불(PortOne 실결제 필요), 데모 체크아웃(데모 구매자 전용), 어시스턴트 스트림(LLM 키).
 */

const SUITE = 'normal';
const p = e2ePrefix(SUITE);
const emails = {
  seller: `${p}seller@test.local`,
  admin: `${p}admin@test.local`,
  buyer: `${p}buyer@test.local`,
  applicant: `${p}applicant@test.local`, // 셀러 신청용 구매자
  pwUser: `${p}pw@test.local`, // 비밀번호 변경용(세션이 전부 끊기므로 따로)
};

describe('정상 회귀: 화면이 보내는 본문 그대로 (HTTP e2e)', () => {
  let ds: DataSource;
  let seller: string;
  let admin: string;
  let buyer: string;
  let applicant: string;
  let categoryId: number;
  let productId: number;
  let secondProductId: number;
  let orderNumber: string;
  let orderId: number;
  let reviewId: number;
  let inquiryId: number;

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();
    await cleanupE2eEverything(ds, SUITE);
    await resetLoginRateLimits();

    const sellerUser = await createUser(ds, { email: emails.seller, role: 'seller' });
    await createApprovedSeller(ds, { userId: sellerUser, businessName: `${p}상회`, businessNumber: '999-11-00001' });
    await createUser(ds, { email: emails.admin, role: 'admin' });
    await createUser(ds, { email: emails.buyer, role: 'buyer' });
    await createUser(ds, { email: emails.applicant, role: 'buyer' });
    await createUser(ds, { email: emails.pwUser, role: 'buyer' });

    seller = (await login(emails.seller)).accessToken;
    admin = (await login(emails.admin)).accessToken;
    buyer = (await login(emails.buyer)).accessToken;
    applicant = (await login(emails.applicant)).accessToken;
    categoryId = (await ds.query(`SELECT id FROM categories ORDER BY id LIMIT 1`))[0].id;
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanupE2eEverything(ds, SUITE);
      await ds.destroy();
    }
  });

  it('D-1 로그인(LoginRequest: email·password·rememberMe) → 201, 로그아웃 → 2xx', async () => {
    // LoginRequest 모양(rememberMe 포함)을 그대로 보내야 해서 loginRaw(429 재시도)를 못 쓴다 — 직전에 IP 카운터를 비운다.
    // 보안 스펙 6개가 병렬로 로그인하면 10회/5분 제한을 넘긴다(PR #77 CI 에서 429 실측).
    await resetLoginRateLimits();
    const res = await axios.post('/auth/login', { email: emails.buyer, password: E2E_PASSWORD, rememberMe: true });
    expect(res.status).toBe(201);
    const cookie = (res.headers['set-cookie'] ?? []).find((c: string) => c.startsWith('refreshToken='))?.split(';')[0];
    const refreshed = await axios.post('/auth/refresh', {}, { headers: { Cookie: cookie as string } });
    expect(refreshed.status).toBe(201);
    const out = await axios.post('/auth/logout', {}, { headers: { Cookie: cookie as string, Authorization: `Bearer ${refreshed.data.accessToken}` } });
    expect([200, 201, 204]).toContain(out.status);
  });

  it('D-2 셀러 신청(ApplySellerRequest 9키) → 201 · 관리자 반려(RejectSellerRequest) → 200', async () => {
    const res = await axios.post(
      '/seller/apply',
      {
        businessName: `${p}신청상회`, businessNumber: '999-11-00002', representativeName: '신청자', businessAddress: '서울시 테스트구 1',
        contactEmail: `${p}contact@test.local`, contactPhone: '02-000-0000', bankName: 'e2e은행', bankAccountNumber: '1-2-3', bankAccountHolder: '신청자',
      },
      auth(applicant),
    );
    expect(res.status).toBe(201);
    const list = await axios.get('/seller/applications', { ...auth(admin), params: { page: 1, take: 50, status: 'pending' } });
    const mine = list.data.data.find((a: any) => a.businessNumber === '999-11-00002');
    expect(mine).toBeDefined();
    const reject = await axios.patch(`/seller/applications/${mine.id}/reject`, { reason: '서류 미비' }, auth(admin));
    expect(reject.status).toBe(200);
  });

  it('D-3 상품 등록(CreateProductRequest 9키) → 201 · 수정(UpdateProductRequest) → 200 · 승인 → 상태 변경(hidden) → 200', async () => {
    const create = await axios.post(
      '/products',
      {
        name: `${p}상품`, description: '정상 본문', price: 15000, brand: 'e2e브랜드',
        stockQuantity: 30, isEvent: false, discountRate: 10, categoryId, salesType: 'normal',
      },
      auth(seller),
    );
    expect(create.status).toBe(201);
    productId = create.data.id;

    const update = await axios.patch(`/products/${productId}`, { name: `${p}상품(수정)`, price: 14000, stockQuantity: 25, discountRate: 5 }, auth(seller));
    expect(update.status).toBe(200);

    expect((await axios.patch(`/admin/products/${productId}/approve`, {}, auth(admin))).status).toBe(200);
    const hide = await axios.patch(`/products/${productId}/status`, { status: 'hidden' }, auth(seller));
    expect(hide.status).toBe(200);
    const publish = await axios.patch(`/products/${productId}/status`, { status: 'published' }, auth(seller));
    expect(publish.status).toBe(200);

    // 두 번째 상품은 관리자 반려(RejectProductRequest) 경로
    const second = await axios.post('/products', { name: `${p}상품2`, description: '반려용', price: 100, brand: 'e2e브랜드' }, auth(seller));
    expect(second.status).toBe(201);
    secondProductId = second.data.id;
    expect((await axios.patch(`/admin/products/${secondProductId}/reject`, { reason: '이미지 없음' }, auth(admin))).status).toBe(200);
  });

  it('D-4 장바구니 담기·수량 변경 → 201/200 · 주문(CreateOrderRequest + memo) → 201', async () => {
    const cartItemId = await addToCart(buyer, productId, 1);
    const qty = await axios.patch(`/cart/items/${cartItemId}`, { quantity: 2 }, auth(buyer));
    expect(qty.status).toBe(200);
    const order = await axios.post(
      '/orders',
      { cartItemIds: [cartItemId], shippingAddress: '서울시 테스트구 정상로 1', recipientName: 'e2e구매자', recipientPhone: '01000000000', memo: '문 앞에 두세요' },
      auth(buyer),
    );
    expect(order.status).toBe(201);
    orderNumber = order.data.orderNumber;
    orderId = (await ds.query(`SELECT id FROM orders WHERE order_number = $1`, [orderNumber]))[0].id;
  });

  it('D-5 출고(ShipOrderRequest) → 관리자 배송완료({sellerId}) → 구매확정 → 200', async () => {
    await completeOrder(ds, { orderNumber, sellerToken: seller, adminToken: admin, buyerToken: buyer });
    expect((await ds.query(`SELECT status FROM orders WHERE id = $1`, [orderId]))[0].status).toBe('completed');
  }, 60_000);

  it('D-6 리뷰 작성(CreateReviewRequest + imageUrls) → 201 · 수정(UpdateReviewRequest 3키) → 200', async () => {
    const create = await axios.post(
      '/reviews',
      { orderId, productId, rating: 5, comment: '정상 리뷰', imageUrls: ['https://example.com/e2e-1.jpg'] },
      auth(buyer),
    );
    expect(create.status).toBe(201);
    reviewId = create.data.id;
    const update = await axios.patch(`/reviews/${reviewId}`, { rating: 4, comment: '수정 리뷰', imageUrls: [] }, auth(buyer));
    expect(update.status).toBe(200);
  });

  it('D-7 문의 작성(CreateInquiryRequest + isSecret) → 201 · 셀러 답변(AnswerInquiryRequest) → 200', async () => {
    const create = await axios.post('/inquiries', { productId, title: '배송 문의', content: '언제 오나요', isSecret: true }, auth(buyer));
    expect(create.status).toBe(201);
    inquiryId = create.data.id;
    const answer = await axios.patch(`/seller/inquiries/${inquiryId}/answer`, { answer: '내일 출고됩니다' }, auth(seller));
    expect(answer.status).toBe(200);
  });

  it('D-8 찜 토글(ToggleWishlistRequest) → 201 · 프로필 수정(UpdateProfileRequest 3키) → 200', async () => {
    expect((await axios.post('/wishlist/toggle', { productId }, auth(buyer))).status).toBe(201);
    const profile = await axios.patch('/users/me', { nickName: '정상닉', phoneNumber: '01011112222', address: '서울시 테스트구 2' }, auth(buyer));
    expect(profile.status).toBe(200);
  });

  it('D-9 운영 앱: 기기 등록(expoPushToken·platform) → 201', async () => {
    const res = await axios.post('/ops/devices', { expoPushToken: 'ExponentPushToken[e2e-normal-0001]', platform: 'android' }, auth(admin));
    expect(res.status).toBe(201);
    await ds.query(`DELETE FROM ops_device_tokens WHERE token = $1`, ['ExponentPushToken[e2e-normal-0001]']).catch(() => undefined);
  });

  it('D-10 데모 로그인({role}) → 200 또는 비활성 서버 403', async () => {
    const res = await axios.post('/auth/demo-login', { role: 'admin' });
    expect([200, 403]).toContain(res.status);
  });

  /**
   * 목록 API 의 쿼리 — forbidNonWhitelisted 는 **쿼리 파라미터에도** 적용된다(모르는 키 → 400).
   * 아래 키 집합은 frontend/src/service/*.ts·app/(main)/products/page.tsx·service/admin-audit.ts 가 실제로 조립하는 그대로다.
   */
  it('D-12 목록 쿼리(화면이 조립하는 키 그대로) → 전부 200', async () => {
    const range = { startDate: '2026-10-01', endDate: '2026-10-16' };
    const calls: Array<[string, string, Record<string, unknown>, string]> = [
      // [라벨, 경로, 쿼리, 토큰]
      ['products(RSC·클라이언트 공통 8키+filter)', '/products', { page: 1, take: 24, sortBy: 'createdAt', sortOrder: 'DESC', cursor: undefined, categoryId, sellerId: 1, keyword: 'e2e', 'filter[rating][gt]': 0 }, ''],
      ['reviews/product', `/reviews/product/${productId}`, { page: 1, take: 10 }, ''],
      ['reviews/my', '/reviews/my', { page: 1, take: 10 }, buyer],
      ['inquiries/product', `/inquiries/product/${productId}`, { page: 1, take: 20 }, buyer],
      ['inquiries/my', '/inquiries/my', { page: 1, take: 20 }, buyer],
      ['orders(OrderQueryParams)', '/orders', { page: 1, take: 20, status: 'completed' }, buyer],
      ['wishlist', '/wishlist', { page: 1, take: 20 }, buyer],
      ['products/my(seller)', '/products/my', { page: 1, take: 20, approvalStatus: 'approved', status: 'published' }, seller],
      ['seller/orders', '/seller/orders', { page: 1, take: 20, status: 'completed' }, seller],
      ['seller/inquiries', '/seller/inquiries', { page: 1, take: 20, status: 'answered' }, seller],
      ['seller/settlements', '/seller/settlements', { page: 1, take: 20, status: 'pending', ...range }, seller],
      ['admin/orders', '/admin/orders', { page: 1, take: 20, status: 'completed' }, admin],
      ['admin/products', '/admin/products', { page: 1, take: 20, approvalStatus: 'pending', status: 'draft', categoryId, sellerId: 1 }, admin],
      ['seller/applications', '/seller/applications', { page: 1, take: 20, status: 'pending' }, admin],
      ['admin/settlements', '/admin/settlements', { page: 1, take: 20, status: 'pending', sellerId: 1, ...range }, admin],
      ['admin/audit-logs(8키)', '/admin/audit-logs', { page: 1, take: 50, userId: 1, action: 'LOGIN', success: 'true', ...range, ipAddress: '127.0.0.1' }, admin],
      ['admin/dashboard/order-trend', '/admin/dashboard/order-trend', { ...range, compareWithPrevious: 'true' }, admin],
      ['admin/dashboard/security', '/admin/dashboard/security', range, admin],
      ['admin/dashboard/funnel', '/admin/dashboard/funnel', range, admin],
    ];
    const results: Record<string, number> = {};
    for (const [label, url, params, token] of calls) {
      const res = await axios.get(url, { params, ...(token ? auth(token) : {}) });
      results[label] = res.status;
    }
    expect(results).toEqual(Object.fromEntries(calls.map(([label]) => [label, 200])));
  }, 60_000);

  it('D-11 비밀번호 변경(ChangePasswordRequest 2키) → 200, 새 비밀번호로 로그인', async () => {
    await resetLoginRateLimits();
    const token = (await loginRaw(emails.pwUser)).data.accessToken;
    const res = await axios.patch('/users/me/password', { currentPassword: E2E_PASSWORD, newPassword: 'E2eTest456!' }, auth(token));
    expect(res.status).toBe(200);
    await resetLoginRateLimits();
    const relogin = await axios.post('/auth/login', { email: emails.pwUser, password: 'E2eTest456!' });
    expect(relogin.status).toBe(201);
  });
});
