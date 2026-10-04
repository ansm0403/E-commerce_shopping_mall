import axios from 'axios';
import { DataSource } from 'typeorm';
import {
  cleanupE2eData,
  cleanupE2eInquiriesAndWishlist,
  cleanupE2eProducts,
  createDataSource,
  createOwnerlessPublishedProduct,
  createUser,
  e2ePrefix,
  makeEmails,
} from '../support/db';
import { resetLoginRateLimits } from '../support/redis';
import { login } from '../support/login';

/** 이 스펙 전용 이름공간 */
const SUITE = 'wishlist';
const emails = makeEmails(SUITE);

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

/**
 * 찜 + 내 프로필 (HTTP e2e).
 *
 * 고정하는 것:
 *   · GET /wishlist/ids — 상품 상세 하트의 초기 상태(토글 결과와 항상 같아야 한다)
 *   · GET /wishlist·/users/me 응답에 id·createdAt 이 실린다(응답 DTO 가 BaseModel 을 상속하면 빠진다)
 *   · 데모 계정은 자기 프로필·비밀번호를 바꿀 수 없다 — 데모 로그인이 환경변수 비밀번호로 일반 로그인을
 *     대신 해 주는 방식이라, 바뀌면 "체험하기" 가 모든 방문자에게 실패한다.
 *     ⚠ 실제 데모 계정(DEMO_ADMIN_EMAIL)은 쓰지 않는다 — 가드가 빠지면 테스트가 그 사고를 그대로 낸다.
 *       is_demo=true 인 e2e 계정으로 같은 가드를 검증한다.
 */
describe('찜 목록·id 목록, 프로필 응답, 데모 계정 변경 차단 (HTTP e2e)', () => {
  let ds: DataSource;
  let buyer: { accessToken: string };
  let demoAdmin: { accessToken: string };
  let productA: number;
  let productB: number;

  const cleanup = async () => {
    await cleanupE2eInquiriesAndWishlist(ds, SUITE);
    await cleanupE2eProducts(ds, SUITE);
    await cleanupE2eData(ds, SUITE);
  };

  const getIds = async (): Promise<number[]> => {
    const res = await axios.get('/wishlist/ids', auth(buyer.accessToken));
    expect(res.status).toBe(200);
    return res.data.productIds;
  };

  const wishCount = async (productId: number): Promise<number> => {
    const [row] = await ds.query(`SELECT "wishCount" FROM products WHERE id = $1`, [productId]);
    return Number(row.wishCount);
  };

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();

    await cleanup();
    await resetLoginRateLimits();

    await createUser(ds, { email: emails.buyer, role: 'buyer' });
    await createUser(ds, { email: emails.demoAdmin, role: 'admin', isDemo: true });
    buyer = await login(emails.buyer);
    demoAdmin = await login(emails.demoAdmin);

    productA = await createOwnerlessPublishedProduct(ds, { name: `${e2ePrefix(SUITE)}찜A` });
    productB = await createOwnerlessPublishedProduct(ds, { name: `${e2ePrefix(SUITE)}찜B` });
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanup();
      await ds.destroy();
    }
  });

  it('토글 추가 → ids·목록에 반영, 목록 항목에 id·createdAt 이 있다', async () => {
    expect(await getIds()).toEqual([]);

    const addA = await axios.post('/wishlist/toggle', { productId: productA }, auth(buyer.accessToken));
    expect(addA.status).toBe(201);
    expect(addA.data).toEqual({ action: 'added', productId: productA });
    await axios.post('/wishlist/toggle', { productId: productB }, auth(buyer.accessToken));

    expect((await getIds()).sort()).toEqual([productA, productB].sort());
    expect(await wishCount(productA)).toBe(1);

    const list = await axios.get('/wishlist', { ...auth(buyer.accessToken), params: { page: 1, take: 20 } });
    expect(list.status).toBe(200);
    expect(list.data.meta.total).toBe(2);
    const itemA = list.data.data.find((i: any) => i.productId === productA);
    // 응답 DTO 회귀 방지
    expect(typeof itemA.id).toBe('number');
    expect(typeof itemA.createdAt).toBe('string');
    expect(itemA.product.id).toBe(productA);
    expect(itemA.product.name).toBe(`${e2ePrefix(SUITE)}찜A`);
  }, 60_000);

  it('토글 해제 → ids 에서 빠지고, 전체 비우기 후에는 빈 배열', async () => {
    const removeA = await axios.post('/wishlist/toggle', { productId: productA }, auth(buyer.accessToken));
    expect(removeA.data).toEqual({ action: 'removed', productId: productA });
    expect(await getIds()).toEqual([productB]);
    expect(await wishCount(productA)).toBe(0);

    const clear = await axios.delete('/wishlist', auth(buyer.accessToken));
    expect(clear.status).toBe(200);
    expect(await getIds()).toEqual([]);
    expect(await wishCount(productB)).toBe(0);
  }, 60_000);

  it('찜은 BUYER 전용이고 로그인이 필요하다', async () => {
    const anonymous = await axios.get('/wishlist/ids');
    expect(anonymous.status).toBe(401);
    const byAdmin = await axios.get('/wishlist/ids', auth(demoAdmin.accessToken));
    expect(byAdmin.status).toBe(403);
  }, 60_000);

  it('내 프로필 응답에 id·createdAt 이 있고 비밀번호는 없다', async () => {
    const me = await axios.get('/users/me', auth(buyer.accessToken));
    expect(me.status).toBe(200);
    expect(typeof me.data.id).toBe('number');
    expect(typeof me.data.createdAt).toBe('string');
    expect(me.data.email).toBe(emails.buyer);
    expect(me.data.password).toBeUndefined();

    // 일반 계정은 프로필을 고칠 수 있다(가드가 모두를 막지 않는지 확인)
    const update = await axios.patch('/users/me', { nickName: 'e2e닉네임수정' }, auth(buyer.accessToken));
    expect(update.status).toBe(200);
    expect(update.data.nickName).toBe('e2e닉네임수정');
    expect(typeof update.data.id).toBe('number');
  }, 60_000);

  it('데모 계정은 프로필·비밀번호를 바꿀 수 없다(403), 조회는 된다', async () => {
    const view = await axios.get('/users/me', auth(demoAdmin.accessToken));
    expect(view.status).toBe(200);
    const nickBefore = view.data.nickName;

    const profile = await axios.patch('/users/me', { nickName: 'e2e데모변경' }, auth(demoAdmin.accessToken));
    expect(profile.status).toBe(403);

    // 현재 비밀번호를 일부러 틀리게 보낸다 — 가드가 빠져도 비밀번호가 실제로 바뀌지는 않는다(그때는 400)
    const password = await axios.patch(
      '/users/me/password',
      { currentPassword: 'Wrong-password-1!', newPassword: 'Changed-password-1!' },
      auth(demoAdmin.accessToken),
    );
    expect(password.status).toBe(403);

    const after = await axios.get('/users/me', auth(demoAdmin.accessToken));
    expect(after.data.nickName).toBe(nickBefore);
  }, 60_000);
});
