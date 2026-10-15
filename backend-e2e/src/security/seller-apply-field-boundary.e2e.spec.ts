import axios from 'axios';
import { DataSource } from 'typeorm';
import {
  cleanupE2eData,
  createApprovedSeller,
  createDataSource,
  createUser,
  e2ePrefix,
} from '../support/db';
import { resetLoginRateLimits } from '../support/redis';
import { login } from '../support/login';

/**
 * 필드 경계(§4 C) — 셀러 신청 본문에 "서버가 정해야 하는 필드"를 섞어 보낸다.
 * (docs/roadmap/ex-security-api-boundary.md §3 단계 1 재현 기록)
 *
 * 공격자 모델: 정상 가입한 구매자. 화면이 보내지 않는 필드를 API 로 직접 보낼 수 있다.
 * 코드 검토에서 본 결함: 전역 ValidationPipe 에 whitelist 가 없고(main.ts),
 * SellerService.apply 가 본문을 엔티티에 통째로 펼친다(create({ userId, ...dto }) / update(id, { ...dto })).
 *
 * 각 시나리오는 "응답 코드"와 "DB 상태"를 함께 본다. 수정 뒤 허용되는 결과는 둘이다.
 *   (a) 모르는 필드를 거절 → 400, DB 불변 (forbidNonWhitelisted — §3 단계 4)
 *   (b) 모르는 필드를 버림 → 201, 서버가 정한 값만 저장 (whitelist 만 — §3 단계 3)
 * 어느 쪽이든 "본문의 값이 DB 에 그대로 들어간" 경우는 실패다. 수정 전에는 이 스펙이 실패해야 한다.
 *
 * 계정은 전부 e2e-seller-field- 접두로 만들고 앞뒤에서 지운다. 시드·데모 데이터는 건드리지 않는다.
 */

const SUITE = 'seller-field';
const p = e2ePrefix(SUITE);

// 닉네임은 이메일 @ 앞 20자 — 접두(17자) 뒤 3자가 서로 달라야 구분된다(a1·a2·…).
const emails = {
  a1Status: `${p}a1-status@test.local`, // C-1 status·approvedAt
  a2UserId: `${p}a2-userid@test.local`, // C-2 userId 가로채기
  a3RowId: `${p}a3-rowid@test.local`, // C-3 id 로 남의 셀러 행 덮어쓰기
  a4Reapply: `${p}a4-reapply@test.local`, // C-4 재신청 경로 userId
  v1Buyer: `${p}v1-buyer@test.local`, // 셀러 행 없는 피해자(C-2)
  v2Buyer: `${p}v2-buyer@test.local`, // 셀러 행 없는 피해자(C-4)
  v3Seller: `${p}v3-seller@test.local`, // 승인된 셀러 행을 가진 피해자(C-3)
};

/** 화면(my/seller-apply)이 실제로 보내는 정상 본문 — 여기에 변조 필드를 얹는다 */
const APPLY_BODY = {
  businessName: 'e2e 경계 상회',
  businessNumber: '999-77-00000', // 시나리오마다 다른 번호로 덮어쓴다(unique)
  representativeName: '경계검증',
  businessAddress: '서울시 테스트구 경계로 1',
  contactEmail: 'boundary-e2e@test.local',
  contactPhone: '02-0000-0001',
  bankName: 'e2e은행',
  bankAccountNumber: '111-22-333333',
  bankAccountHolder: '경계검증',
};

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

type SellerRow = {
  id: number;
  userId: number;
  businessName: string;
  businessNumber: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  status: string;
  approvedAt: Date | null;
  rejectionReason: string | null;
};

const SELLER_COLUMNS = `id, user_id AS "userId", "businessName", "businessNumber", "bankName",
  "bankAccountNumber", "bankAccountHolder", status, "approvedAt", "rejectionReason"`;

async function sellerRowByUserId(ds: DataSource, userId: number): Promise<SellerRow | null> {
  const rows = await ds.query(`SELECT ${SELLER_COLUMNS} FROM sellers WHERE user_id = $1`, [userId]);
  return rows[0] ?? null;
}

async function sellerRowById(ds: DataSource, id: number): Promise<SellerRow | null> {
  const rows = await ds.query(`SELECT ${SELLER_COLUMNS} FROM sellers WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

describe('필드 경계: 셀러 신청 본문의 서버 전용 필드 (HTTP e2e)', () => {
  let ds: DataSource;

  let a1Id: number;
  let a2Id: number;
  let a3Id: number;
  let a4Id: number;
  let v1Id: number;
  let v2Id: number;
  let v3Id: number;
  let v3SellerId: number; // 피해자의 승인된 셀러 행
  let a4SellerId: number; // 공격자 4 의 반려된 신청 행

  let a1: { accessToken: string };
  let a2: { accessToken: string };
  let a3: { accessToken: string };
  let a4: { accessToken: string };

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();

    await cleanupE2eData(ds, SUITE);
    await resetLoginRateLimits();

    a1Id = await createUser(ds, { email: emails.a1Status, role: 'buyer' });
    a2Id = await createUser(ds, { email: emails.a2UserId, role: 'buyer' });
    a3Id = await createUser(ds, { email: emails.a3RowId, role: 'buyer' });
    a4Id = await createUser(ds, { email: emails.a4Reapply, role: 'buyer' });
    v1Id = await createUser(ds, { email: emails.v1Buyer, role: 'buyer' });
    v2Id = await createUser(ds, { email: emails.v2Buyer, role: 'buyer' });
    v3Id = await createUser(ds, { email: emails.v3Seller, role: 'seller' });

    v3SellerId = await createApprovedSeller(ds, {
      userId: v3Id,
      businessName: 'e2e 피해자 상회',
      businessNumber: '999-77-00009',
    });

    // 공격자 4: 반려된 신청이 있는 구매자(재신청 경로 = sellerRepository.update)
    a4SellerId = await createApprovedSeller(ds, {
      userId: a4Id,
      businessName: 'e2e 반려 상회',
      businessNumber: '999-77-00008',
    });
    await ds.query(
      `UPDATE sellers SET status = 'rejected', "approvedAt" = NULL, "rejectionReason" = 'e2e 반려' WHERE id = $1`,
      [a4SellerId],
    );

    // 로그인은 계정당 1회(IP 당 10회/5분 제한)
    a1 = await login(emails.a1Status);
    a2 = await login(emails.a2UserId);
    a3 = await login(emails.a3RowId);
    a4 = await login(emails.a4Reapply);
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanupE2eData(ds, SUITE);
      await ds.destroy();
    }
  });

  it('C-1 첫 신청: 본문의 status·approvedAt 은 서버 기본값(pending·null)을 바꾸지 못한다', async () => {
    const forged = {
      ...APPLY_BODY,
      businessNumber: '999-77-00001',
      status: 'approved',
      approvedAt: '2020-01-01T00:00:00.000Z',
    };

    const res = await axios.post('/seller/apply', forged, auth(a1.accessToken));
    const row = await sellerRowByUserId(ds, a1Id);
    const me = await axios.get('/seller/me', auth(a1.accessToken));
    console.log('[C-1] HTTP', res.status, '| /seller/me', me.status, me.data?.status, '| DB', row);

    if (res.status === 400) {
      expect(row).toBeNull(); // (a) 거절 — 행이 생기면 안 된다
      return;
    }
    expect(res.status).toBe(201); // (b) 버림 — 서버가 정한 값만 남아야 한다
    expect(row).toMatchObject({ userId: a1Id, status: 'pending', approvedAt: null });
  }, 30_000);

  it('C-2 첫 신청: 본문의 userId 로 남의 계정에 신청 행을 만들 수 없다', async () => {
    const forged = { ...APPLY_BODY, businessNumber: '999-77-00002', userId: v1Id };

    const res = await axios.post('/seller/apply', forged, auth(a2.accessToken));
    const victimRow = await sellerRowByUserId(ds, v1Id);
    const attackerRow = await sellerRowByUserId(ds, a2Id);
    console.log('[C-2] HTTP', res.status, '| 피해자 행', victimRow, '| 공격자 행', attackerRow);

    expect(victimRow).toBeNull(); // 남의 user_id 로 행이 생기면 안 된다
    if (res.status === 400) {
      expect(attackerRow).toBeNull();
      return;
    }
    expect(res.status).toBe(201);
    expect(attackerRow).toMatchObject({ userId: a2Id, status: 'pending' });
  }, 30_000);

  it('C-3 첫 신청: 본문의 id 로 남의(승인된) 셀러 행을 덮어쓸 수 없다', async () => {
    const before = await sellerRowById(ds, v3SellerId);
    expect(before).toMatchObject({ userId: v3Id, status: 'approved' });

    const forged = { ...APPLY_BODY, businessNumber: '999-77-00003', id: v3SellerId };

    const res = await axios.post('/seller/apply', forged, auth(a3.accessToken));
    const after = await sellerRowById(ds, v3SellerId);
    const me = await axios.get('/seller/me', auth(a3.accessToken));
    console.log('[C-3] HTTP', res.status, '| /seller/me', me.status, me.data?.status, '| 피해자 행 전', before, '| 후', after);

    expect(after).toEqual(before); // 남의 셀러 행은 한 글자도 바뀌면 안 된다
    expect(me.data?.status).not.toBe('approved'); // 승인 절차 없이 승인 상태를 얻으면 안 된다
    if (res.status === 201) {
      const attackerRow = await sellerRowByUserId(ds, a3Id);
      expect(attackerRow).toMatchObject({ userId: a3Id, status: 'pending' });
      expect(attackerRow?.id).not.toBe(v3SellerId);
    }
  }, 30_000);

  it('C-4 재신청(반려 뒤): 본문의 userId 로 신청 행을 남의 계정으로 옮길 수 없다', async () => {
    const forged = {
      ...APPLY_BODY,
      businessNumber: '999-77-00004',
      userId: v2Id,
      status: 'approved',
      approvedAt: '2020-01-01T00:00:00.000Z',
    };

    const res = await axios.post('/seller/apply', forged, auth(a4.accessToken));
    const ownRow = await sellerRowById(ds, a4SellerId);
    const victimRow = await sellerRowByUserId(ds, v2Id);
    console.log('[C-4] HTTP', res.status, '| 공격자 신청 행', ownRow, '| 피해자 행', victimRow);

    expect(victimRow).toBeNull(); // 피해자 계정에 셀러 행이 붙으면 안 된다
    if (res.status === 400) {
      expect(ownRow).toMatchObject({ userId: a4Id, status: 'rejected' }); // 거절이면 그대로
      return;
    }
    expect(res.status).toBe(201);
    // 재신청은 status·rejectionReason·approvedAt 을 서버가 다시 쓴다 — userId 도 그래야 한다
    expect(ownRow).toMatchObject({ userId: a4Id, status: 'pending', approvedAt: null, rejectionReason: null });
  }, 30_000);
});
