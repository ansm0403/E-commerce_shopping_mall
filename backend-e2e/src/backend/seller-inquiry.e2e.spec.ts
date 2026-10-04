import axios from 'axios';
import { DataSource } from 'typeorm';
import {
  cleanupE2eData,
  cleanupE2eInquiriesAndWishlist,
  cleanupE2eProducts,
  createApprovedSeller,
  createDataSource,
  createUser,
  e2ePrefix,
  makeEmails,
} from '../support/db';
import { resetLoginRateLimits } from '../support/redis';
import { login } from '../support/login';

/** 이 스펙 전용 이름공간 */
const SUITE = 'seller-inquiry';
const emails = makeEmails(SUITE);

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const PAGE = { page: 1, take: 20 };

/**
 * 문의 왕복 (HTTP e2e) — 구매자 작성 → 공개 목록(비밀글 마스킹/본인 해제) → 셀러 미답변 필터 → 답변 → 구매자 확인·삭제.
 *
 * 고정하는 것:
 *   · 응답에 id·createdAt 이 실린다 — 응답 DTO 가 BaseModel 을 상속하면 @Serialize 가 통째로 빼 버린다
 *   · 공개 목록은 토큰이 없어도, 틀려도 200 이고(선택적 인증) 작성자 본인의 토큰일 때만 비밀글이 풀린다
 *   · GET /seller/inquiries?status= 필터 + product{id,name}
 *   · 답변은 한 번만(재답변 400), 남의 상품 문의는 403, 답변된 문의는 삭제 불가(400)
 */
describe('문의 왕복: 구매자 작성 → 셀러 답변 (HTTP e2e)', () => {
  let ds: DataSource;
  let sellerId: number;
  let seller: { accessToken: string };
  let sellerB: { accessToken: string };
  let buyer: { accessToken: string };
  let admin: { accessToken: string };
  let productId: number;
  let normalId: number;
  let secretId: number;

  const productName = `${e2ePrefix(SUITE)}문의상품`;

  const cleanup = async () => {
    await cleanupE2eInquiriesAndWishlist(ds, SUITE);
    await cleanupE2eProducts(ds, SUITE);
    await cleanupE2eData(ds, SUITE);
  };

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();

    await cleanup();
    await resetLoginRateLimits();

    const userS = await createUser(ds, { email: emails.seller, role: 'seller' });
    sellerId = await createApprovedSeller(ds, {
      userId: userS,
      businessName: `${e2ePrefix(SUITE)}S상회`,
      businessNumber: '999-96-11111',
    });
    const userT = await createUser(ds, { email: emails.sellerB, role: 'seller' });
    await createApprovedSeller(ds, {
      userId: userT,
      businessName: `${e2ePrefix(SUITE)}T상회`,
      businessNumber: '999-96-22222',
    });
    await createUser(ds, { email: emails.buyer, role: 'buyer' });
    await createUser(ds, { email: emails.admin, role: 'admin' });

    seller = await login(emails.seller);
    sellerB = await login(emails.sellerB);
    buyer = await login(emails.buyer);
    admin = await login(emails.admin);

    // 셀러 S 의 상품 1건(관리자 승인 = 게시)
    const create = await axios.post(
      '/products',
      { name: productName, description: 'e2e 문의 검증', price: 12000, brand: 'e2e브랜드', stockQuantity: 5 },
      auth(seller.accessToken),
    );
    expect(create.status).toBe(201);
    productId = create.data.id as number;
    await axios.patch(`/admin/products/${productId}/approve`, {}, auth(admin.accessToken));
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanup();
      await ds.destroy();
    }
  });

  it('구매자가 일반·비밀 문의를 쓴다 — 응답에 id·createdAt 이 있고 sellerId 는 상품의 셀러다', async () => {
    const normal = await axios.post(
      '/inquiries',
      { productId, title: '배송은 며칠 걸리나요?', content: '주문하면 언제쯤 받을 수 있나요?' },
      auth(buyer.accessToken),
    );
    expect(normal.status).toBe(201);
    // 응답 DTO 회귀 방지 — id 가 없으면 삭제·답변 API 를 부를 수 없다
    expect(typeof normal.data.id).toBe('number');
    expect(typeof normal.data.createdAt).toBe('string');
    expect(normal.data.sellerId).toBe(sellerId);
    expect(normal.data.status).toBe('waiting');
    expect(normal.data.isSecret).toBe(false);
    normalId = normal.data.id;

    const secret = await axios.post(
      '/inquiries',
      { productId, title: '비밀로 묻습니다', content: '비밀 본문입니다', isSecret: true },
      auth(buyer.accessToken),
    );
    expect(secret.status).toBe(201);
    expect(secret.data.isSecret).toBe(true);
    secretId = secret.data.id;

    // 셀러는 문의를 쓸 수 없다(BUYER 전용)
    const bySeller = await axios.post(
      '/inquiries',
      { productId, title: '셀러의 문의', content: '내용' },
      auth(seller.accessToken),
    );
    expect(bySeller.status).toBe(403);
  }, 60_000);

  it('공개 목록: 비로그인·틀린 토큰에는 비밀글이 마스킹되고, 작성자 본인에게만 풀린다', async () => {
    const findSecret = (res: { data: { data: any[] } }) => res.data.data.find((i) => i.id === secretId);

    const anonymous = await axios.get(`/inquiries/product/${productId}`, { params: PAGE });
    expect(anonymous.status).toBe(200);
    expect(anonymous.data.meta.total).toBe(2);
    expect(findSecret(anonymous).title).toBe('비밀 문의입니다.');
    expect(findSecret(anonymous).content).toBe('');
    expect(findSecret(anonymous).user.nickName).toBe('***');
    // 일반 문의는 그대로 보인다
    expect(anonymous.data.data.find((i: any) => i.id === normalId).title).toBe('배송은 며칠 걸리나요?');

    // 작성자 본인 — 본문이 보인다
    const owner = await axios.get(`/inquiries/product/${productId}`, {
      ...auth(buyer.accessToken), params: PAGE,
    });
    expect(owner.status).toBe(200);
    expect(findSecret(owner).title).toBe('비밀로 묻습니다');
    expect(findSecret(owner).content).toBe('비밀 본문입니다');

    // 다른 로그인 사용자(셀러 T) — 마스킹
    const other = await axios.get(`/inquiries/product/${productId}`, {
      ...auth(sellerB.accessToken), params: PAGE,
    });
    expect(findSecret(other).title).toBe('비밀 문의입니다.');

    // 틀린 토큰 — 401 이 아니라 비로그인과 같게(공개 목록 때문에 로그아웃되면 안 된다)
    const broken = await axios.get(`/inquiries/product/${productId}`, {
      ...auth('not-a-valid-token'), params: PAGE,
    });
    expect(broken.status).toBe(200);
    expect(findSecret(broken).title).toBe('비밀 문의입니다.');
  }, 60_000);

  it('셀러 목록: status 필터와 상품명', async () => {
    const waiting = await axios.get('/seller/inquiries', {
      ...auth(seller.accessToken), params: { ...PAGE, status: 'waiting' },
    });
    expect(waiting.status).toBe(200);
    expect(waiting.data.meta.total).toBe(2);
    expect(waiting.data.data[0].product).toEqual({ id: productId, name: productName });
    expect(typeof waiting.data.data[0].id).toBe('number');
    // 셀러에게는 비밀글도 본문이 보인다(답변해야 하므로)
    expect(waiting.data.data.find((i: any) => i.id === secretId).content).toBe('비밀 본문입니다');

    const answered = await axios.get('/seller/inquiries', {
      ...auth(seller.accessToken), params: { ...PAGE, status: 'answered' },
    });
    expect(answered.data.meta.total).toBe(0);

    // 필터 없음 = 전체
    const all = await axios.get('/seller/inquiries', { ...auth(seller.accessToken), params: PAGE });
    expect(all.data.meta.total).toBe(2);

    // 없는 상태값은 400
    const invalid = await axios.get('/seller/inquiries', {
      ...auth(seller.accessToken), params: { ...PAGE, status: 'done' },
    });
    expect(invalid.status).toBe(400);

    // 다른 셀러 T 의 목록에는 없다
    const others = await axios.get('/seller/inquiries', { ...auth(sellerB.accessToken), params: PAGE });
    expect(others.data.meta.total).toBe(0);
  }, 60_000);

  it('답변: 한 번만 가능하고, 남의 상품 문의에는 답할 수 없다', async () => {
    const byOther = await axios.patch(
      `/seller/inquiries/${normalId}/answer`, { answer: '남의 답변' }, auth(sellerB.accessToken),
    );
    expect(byOther.status).toBe(403);

    const answer = await axios.patch(
      `/seller/inquiries/${normalId}/answer`, { answer: '보통 2~3일 걸립니다.' }, auth(seller.accessToken),
    );
    expect(answer.status).toBe(200);
    expect(answer.data.id).toBe(normalId);
    expect(answer.data.status).toBe('answered');
    expect(answer.data.answer).toBe('보통 2~3일 걸립니다.');
    expect(typeof answer.data.answeredAt).toBe('string');

    const again = await axios.patch(
      `/seller/inquiries/${normalId}/answer`, { answer: '다시 답변' }, auth(seller.accessToken),
    );
    expect(again.status).toBe(400);

    // 탭 이동: 미답변 1 · 답변완료 1
    const waiting = await axios.get('/seller/inquiries', {
      ...auth(seller.accessToken), params: { ...PAGE, status: 'waiting' },
    });
    expect(waiting.data.meta.total).toBe(1);
    const answered = await axios.get('/seller/inquiries', {
      ...auth(seller.accessToken), params: { ...PAGE, status: 'answered' },
    });
    expect(answered.data.meta.total).toBe(1);
    expect(answered.data.data[0].id).toBe(normalId);
  }, 60_000);

  it('내 문의: 답변 본문·상품명이 보이고, 답변된 문의는 삭제할 수 없다', async () => {
    const my = await axios.get('/inquiries/my', { ...auth(buyer.accessToken), params: PAGE });
    expect(my.status).toBe(200);
    expect(my.data.meta.total).toBe(2);
    const answeredItem = my.data.data.find((i: any) => i.id === normalId);
    expect(answeredItem.answer).toBe('보통 2~3일 걸립니다.');
    expect(answeredItem.product).toEqual({ id: productId, name: productName });
    expect(typeof answeredItem.createdAt).toBe('string');

    const deleteAnswered = await axios.delete(`/inquiries/${normalId}`, auth(buyer.accessToken));
    expect(deleteAnswered.status).toBe(400);

    const deleteWaiting = await axios.delete(`/inquiries/${secretId}`, auth(buyer.accessToken));
    expect(deleteWaiting.status).toBe(200);

    const after = await axios.get('/inquiries/my', { ...auth(buyer.accessToken), params: PAGE });
    expect(after.data.meta.total).toBe(1);
  }, 60_000);
});
