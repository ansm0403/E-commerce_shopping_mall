import axios from 'axios';
import { DataSource } from 'typeorm';
import { cleanupE2eData, createDataSource, createUser, makeEmails } from '../support/db';
import { resetLoginRateLimits } from '../support/redis';
import { loginRaw } from '../support/login';

/** 이 스펙 전용 계정 이름공간 — 다른 스펙과 겹치지 않게 한다 */
const SUITE = 'mobile-ops';
const emails = makeEmails(SUITE);

/**
 * RN Ops Companion Phase 0 백엔드 HTTP e2e (docs/roadmap/ops-companion-design.md §5.1·§5.6).
 *
 * A. 모바일 토큰 전략 — `X-Client: mobile` 헤더 분기
 *   · 헤더 없음(웹)  : body 에 refreshToken 없음 + Set-Cookie 로만 전달 — 기존 동작 불변(회귀 방지)
 *   · 헤더 mobile    : body 에 refreshToken 포함 → 쿠키 없이 body 로 refresh → 새 토큰 쌍
 *   · 회전 규칙      : 옛 refreshToken 재사용 401, 쿠키·body 둘 다 없으면 401
 * B. GET /v1/ops/incidents — Sentry 프록시
 *   · 가드: 무토큰 401 / buyer 403 / admin 200
 *   · 축약형: 항목 키가 정확히 id·title·level·count·lastSeen (raw Sentry 필드 유출 금지)
 *   · 캐시: 연속 호출 시 X-Cache MISS → HIT
 *   · 키 미설정 서버면 503 — 이 경우에도 서버가 죽지 않는 것만 확인한다
 *
 * 전제: postgres·redis + `yarn nx serve backend` 가 떠 있어야 한다(support/global-setup.ts).
 */

const MOBILE = { 'X-Client': 'mobile' };
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const refreshCookieOf = (res: { headers: Record<string, unknown> }) =>
  ((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith('refreshToken='));

describe('모바일 토큰 전략 + ops 인시던트 조회 (HTTP e2e)', () => {
  let ds: DataSource;

  // 로그인은 IP당 10회/5분 제한 → 계정당 필요한 만큼만(총 3회) 하고 토큰을 재사용한다.
  let adminMobile: { accessToken: string; refreshToken: string };
  let buyerToken: string;

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();

    await cleanupE2eData(ds, SUITE);
    await resetLoginRateLimits();

    await createUser(ds, { email: emails.admin, role: 'admin' });
    await createUser(ds, { email: emails.buyer, role: 'buyer' });

    const res = await loginRaw(emails.admin, MOBILE);
    adminMobile = { accessToken: res.data.accessToken, refreshToken: res.data.refreshToken };
    buyerToken = (await loginRaw(emails.buyer)).data.accessToken;
  });

  afterAll(async () => {
    await cleanupE2eData(ds, SUITE);
    await ds.destroy();
  });

  describe('A. 웹 경로(헤더 없음)는 그대로다', () => {
    let webCookie: string;

    it('로그인: body 에 refreshToken 이 없고 httpOnly 쿠키로만 내려온다', async () => {
      const res = await loginRaw(emails.admin);

      expect(Object.keys(res.data).sort()).toEqual(['accessToken', 'expiresIn', 'tokenType', 'user']);
      const cookie = refreshCookieOf(res);
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      webCookie = (cookie as string).split(';')[0];
    });

    it('refresh: 쿠키만으로 갱신되고 body 에는 여전히 refreshToken 이 없다', async () => {
      const res = await axios.post('/auth/refresh', undefined, { headers: { Cookie: webCookie } });

      expect(res.status).toBe(201);
      expect(res.data).not.toHaveProperty('refreshToken');
      expect(res.data.accessToken).toEqual(expect.any(String));
      expect(refreshCookieOf(res)).toBeDefined(); // 회전된 새 쿠키
    });
  });

  describe('A. 모바일 경로(X-Client: mobile)', () => {
    it('로그인 body 에 refreshToken 이 포함된다', () => {
      expect(adminMobile.refreshToken).toEqual(expect.any(String));
      expect(adminMobile.refreshToken.length).toBeGreaterThan(20);
    });

    it('쿠키 없이 body 의 refreshToken 으로 refresh → 새 토큰 쌍(body) → 보호 엔드포인트 통과', async () => {
      const refreshed = await axios.post(
        '/auth/refresh',
        { refreshToken: adminMobile.refreshToken },
        { headers: MOBILE },
      );

      expect(refreshed.status).toBe(201);
      expect(refreshed.data.accessToken).toEqual(expect.any(String));
      expect(refreshed.data.refreshToken).toEqual(expect.any(String));
      expect(refreshed.data.refreshToken).not.toBe(adminMobile.refreshToken); // 1회용 회전

      const me = await axios.get('/auth/me', auth(refreshed.data.accessToken));
      expect(me.status).toBe(200);
      expect(me.data.email).toBe(emails.admin);

      // 회전된 옛 토큰은 거부된다
      const reuse = await axios.post('/auth/refresh', { refreshToken: adminMobile.refreshToken }, { headers: MOBILE });
      expect(reuse.status).toBe(401);

      // 이후 테스트는 최신 토큰 쌍을 쓴다
      adminMobile = { accessToken: refreshed.data.accessToken, refreshToken: refreshed.data.refreshToken };
    });

    it('쿠키도 body 도 없으면 401', async () => {
      const res = await axios.post('/auth/refresh', {}, { headers: MOBILE });
      expect(res.status).toBe(401);
    });
  });

  describe('B. GET /v1/ops/incidents', () => {
    it('토큰 없음 → 401, buyer → 403', async () => {
      expect((await axios.get('/ops/incidents')).status).toBe(401);
      expect((await axios.get('/ops/incidents', auth(buyerToken))).status).toBe(403);
    });

    it('admin → 200 축약형 배열(+ 두 번째 호출은 캐시 HIT) 또는 키 미설정 서버면 503', async () => {
      const first = await axios.get('/ops/incidents', auth(adminMobile.accessToken));
      expect([200, 503]).toContain(first.status);

      if (first.status === 503) {
        // 비활성(no-op) 경로: 서버가 죽지 않고 명시적으로 알린다
        expect(first.data.message).toMatch(/SENTRY_AUTH_TOKEN/);
        return;
      }

      expect(Array.isArray(first.data)).toBe(true);
      for (const item of first.data) {
        expect(Object.keys(item).sort()).toEqual(['count', 'id', 'lastSeen', 'level', 'title']);
        expect(item.id).toEqual(expect.any(String));
        expect(['error', 'warning', 'info']).toContain(item.level);
        expect(typeof item.count).toBe('number');
        expect(new Date(item.lastSeen).toString()).not.toBe('Invalid Date');
      }

      const second = await axios.get('/ops/incidents', auth(adminMobile.accessToken));
      expect(second.status).toBe(200);
      expect(second.headers['x-cache']).toBe('HIT');
      expect(second.data).toEqual(first.data);
    });
  });

  describe('C. GET /v1/ops/incidents/:id (Phase 1 — 푸시 딥링크의 도착지)', () => {
    it('토큰 없음 → 401, buyer → 403', async () => {
      expect((await axios.get('/ops/incidents/1')).status).toBe(401);
      expect((await axios.get('/ops/incidents/1', auth(buyerToken))).status).toBe(403);
    });

    it('admin → 상세 축약형(민감 entry 없음) / 숫자가 아닌 id·없는 id 는 404 / 키 미설정 서버면 503', async () => {
      const list = await axios.get('/ops/incidents', auth(adminMobile.accessToken));
      if (list.status === 503) {
        expect((await axios.get('/ops/incidents/1', auth(adminMobile.accessToken))).status).toBe(503);
        return;
      }

      expect((await axios.get('/ops/incidents/not-a-number', auth(adminMobile.accessToken))).status).toBe(404);
      expect((await axios.get('/ops/incidents/999999999999', auth(adminMobile.accessToken))).status).toBe(404);

      // 최근 24h 에 이슈가 없는 조용한 날에는 상세를 확인할 대상이 없다 — 위 404 까지만 단언한다
      if (list.data.length === 0) return;

      const id = list.data[0].id;
      const res = await axios.get(`/ops/incidents/${id}`, auth(adminMobile.accessToken));
      expect(res.status).toBe(200);
      expect(Object.keys(res.data).sort()).toEqual(
        ['breadcrumbs', 'count', 'culprit', 'exception', 'firstSeen', 'id', 'lastSeen', 'level', 'project', 'status', 'title'],
      );
      expect(res.data.id).toBe(id);
      expect(Array.isArray(res.data.breadcrumbs)).toBe(true);
      expect(res.data.breadcrumbs.length).toBeLessThanOrEqual(30);
      if (res.data.exception) {
        expect(res.data.exception.frames.length).toBeLessThanOrEqual(30);
        for (const frame of res.data.exception.frames) {
          expect(Object.keys(frame).sort()).toEqual(['colNo', 'filename', 'function', 'inApp', 'lineNo']);
        }
      }
    });
  });
});
