import axios from 'axios';
import { DataSource } from 'typeorm';
import {
  cleanupE2eData,
  createDataSource,
  createUser,
  E2E_PASSWORD,
  makeEmails,
} from '../support/db';
import { resetLoginRateLimits } from '../support/redis';
import { loginRaw } from '../support/login';

/** 이 스펙 전용 이름공간 */
const SUITE = 'password-change';
const emails = makeEmails(SUITE);

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const MOBILE = { 'X-Client': 'mobile' };
const NEW_PASSWORD = 'E2eChanged456!';

/**
 * 비밀번호 변경 (HTTP e2e).
 *
 * 고정하는 것:
 *   · 새 비밀번호 규칙이 가입과 같다(8자 + 대·소문자·숫자·특수문자) — 약한 비밀번호는 400
 *   · 현재 비밀번호가 틀리거나, 새 비밀번호가 현재와 같으면 400
 *   · 성공하면 **모든 세션이 끊긴다**: 요청에 쓴 access 토큰 401, 다른 기기의 refresh 토큰으로 갱신 401
 *   · 옛 비밀번호로는 로그인되지 않고 새 비밀번호로 된다
 *
 * 세션 둘을 만든다 — A(이 기기, 변경을 요청) · B(다른 기기, refresh 토큰을 body 로 받는 모바일 경로).
 */
describe('비밀번호 변경: 규칙과 세션 폐기 (HTTP e2e)', () => {
  let ds: DataSource;
  let sessionA: { accessToken: string };
  let sessionB: { accessToken: string; refreshToken: string };

  const changePassword = (token: string, currentPassword: string, newPassword: string) =>
    axios.patch('/users/me/password', { currentPassword, newPassword }, auth(token));

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();

    await cleanupE2eData(ds, SUITE);
    await resetLoginRateLimits();

    await createUser(ds, { email: emails.buyer, role: 'buyer' });
    const a = await loginRaw(emails.buyer);
    sessionA = { accessToken: a.data.accessToken };
    const b = await loginRaw(emails.buyer, MOBILE);
    sessionB = { accessToken: b.data.accessToken, refreshToken: b.data.refreshToken };
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await cleanupE2eData(ds, SUITE);
      await ds.destroy();
    }
  });

  it('거절: 약한 비밀번호 · 틀린 현재 비밀번호 · 현재와 같은 비밀번호', async () => {
    // 8자 이상이지만 가입 규칙(대·소문자·숫자·특수문자)을 못 채운다
    for (const weak of ['aaaaaaaa', 'abcd1234', 'Abcd1234', 'short1!']) {
      const res = await changePassword(sessionA.accessToken, E2E_PASSWORD, weak);
      expect([weak, res.status]).toEqual([weak, 400]);
    }

    const wrongCurrent = await changePassword(sessionA.accessToken, 'Wrong-pass-1!', NEW_PASSWORD);
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.data.message).toBe('현재 비밀번호가 일치하지 않습니다.');

    const same = await changePassword(sessionA.accessToken, E2E_PASSWORD, E2E_PASSWORD);
    expect(same.status).toBe(400);
    expect(same.data.message).toBe('새 비밀번호는 현재 비밀번호와 달라야 합니다.');

    // 거절된 시도는 세션을 건드리지 않는다
    const me = await axios.get('/users/me', auth(sessionA.accessToken));
    expect(me.status).toBe(200);
  }, 60_000);

  it('성공하면 모든 세션이 끊기고, 새 비밀번호로만 로그인된다', async () => {
    // 변경 전에는 B 도 정상이다
    const meBBefore = await axios.get('/users/me', auth(sessionB.accessToken));
    expect(meBBefore.status).toBe(200);

    // "이전 발급분 거절"은 초 단위 비교다 — 로그인과 변경이 같은 초에 일어나지 않게 1초 넘게 띄운다
    await new Promise((r) => setTimeout(r, 1100));

    const changed = await changePassword(sessionA.accessToken, E2E_PASSWORD, NEW_PASSWORD);
    expect(changed.status).toBe(200);

    // 요청에 쓴 access 토큰은 즉시 폐기
    const meA = await axios.get('/users/me', auth(sessionA.accessToken));
    expect(meA.status).toBe(401);

    // 다른 기기(B)의 access 토큰도 **즉시** 거절된다(만료 15분을 기다리지 않는다)
    const meB = await axios.get('/users/me', auth(sessionB.accessToken));
    expect(meB.status).toBe(401);

    // B 는 refresh 로 되살릴 수도 없다
    const refreshB = await axios.post(
      '/auth/refresh',
      { refreshToken: sessionB.refreshToken },
      { headers: MOBILE },
    );
    expect(refreshB.status).toBe(401);

    // 옛 비밀번호로는 로그인되지 않는다
    const oldLogin = await axios.post('/auth/login', { email: emails.buyer, password: E2E_PASSWORD });
    expect(oldLogin.status).toBe(401);

    // 새 비밀번호로 로그인된다
    const newLogin = await axios.post('/auth/login', { email: emails.buyer, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(201);
    const meNew = await axios.get('/users/me', auth(newLogin.data.accessToken));
    expect(meNew.status).toBe(200);
  }, 60_000);
});
