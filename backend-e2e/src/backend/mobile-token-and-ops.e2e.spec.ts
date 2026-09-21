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
 * E. POST /v1/ops/incidents/:id/analysis — AI 분석(Phase 3)
 *   · 가드: 무토큰 401 / buyer 403 · 없는 이슈 404 · LLM 키 미설정 서버면 503
 *   · 강제 실패(simulate=parse_failed, 비운영 전용): LLM 없이 parse_failed 행 → 응답 형태·DB 행 단언
 *   · 캐시: 같은 이슈를 force 없이 다시 부르면 X-Cache HIT + 같은 id (LLM 을 몰래 다시 부르지 않는다)
 *   · 실제 LLM 호출은 이 스펙에서 하지 않는다 — 무료티어 쿼터와 비결정성 때문. 파이프라인은 단위 테스트가 고정한다
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
    // E 절이 만든 시뮬레이션 분석 행. 사용자 FK 가 없어 계정 정리로는 지워지지 않는다.
    await ds.query(`DELETE FROM ops_analyses WHERE model = 'simulated'`);
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

  describe('D. POST /v1/ops/devices (Phase 1 — 기기 push token 등록)', () => {
    const token = 'ExponentPushToken[e2e-mobile-ops-device-0001]';

    const tokenRows = (userId: number) =>
      ds.query(
        `SELECT expo_push_token, platform, disabled_at FROM ops_device_tokens WHERE user_id = $1`,
        [userId],
      );
    const adminId = async () =>
      (await ds.query(`SELECT id FROM users WHERE email = $1`, [emails.admin]))[0].id as number;

    it('토큰 없음 → 401, buyer → 403', async () => {
      expect((await axios.post('/ops/devices', { expoPushToken: token, platform: 'android' })).status).toBe(401);
      expect(
        (await axios.post('/ops/devices', { expoPushToken: token, platform: 'android' }, auth(buyerToken))).status,
      ).toBe(403);
    });

    it.each([
      ['형식이 아닌 토큰', { expoPushToken: 'not-a-token', platform: 'android' }],
      ['빈 토큰', { expoPushToken: '', platform: 'android' }],
      ['알 수 없는 platform', { expoPushToken: token, platform: 'windows' }],
      ['platform 누락', { expoPushToken: token }],
    ])('%s 은 400 — 잘못된 값이 표에 쌓이면 발송이 통째로 실패한다', async (_label, body) => {
      const res = await axios.post('/ops/devices', body, auth(adminMobile.accessToken));
      expect(res.status).toBe(400);
    });

    it('admin 등록 → 201, 같은 토큰 재등록은 행을 늘리지 않는다(upsert) + disabled 해제', async () => {
      const userId = await adminId();

      const first = await axios.post(
        '/ops/devices',
        { expoPushToken: token, platform: 'android' },
        auth(adminMobile.accessToken),
      );
      expect(first.status).toBe(201);
      expect(first.data).toEqual({ registered: true });
      expect(await tokenRows(userId)).toHaveLength(1);

      // Expo 가 DeviceNotRegistered 를 준 상태를 만들어 두고 재등록 → 다시 발송 대상이 되어야 한다
      await ds.query(`UPDATE ops_device_tokens SET disabled_at = NOW() WHERE user_id = $1`, [userId]);

      const again = await axios.post(
        '/ops/devices',
        { expoPushToken: token, platform: 'android' },
        auth(adminMobile.accessToken),
      );
      expect(again.status).toBe(201);

      const rows = await tokenRows(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].disabled_at).toBeNull();
    });
  });

  describe('E. POST /v1/ops/incidents/:id/analysis (Phase 3 — AI 분석)', () => {
    const ANALYSIS_KEYS = ['createdAt', 'id', 'incidentId', 'latencyMs', 'model', 'promptVersion', 'rawText', 'result', 'status'];

    it('토큰 없음 → 401, buyer → 403', async () => {
      expect((await axios.post('/ops/incidents/1/analysis', {})).status).toBe(401);
      expect((await axios.post('/ops/incidents/1/analysis', {}, auth(buyerToken))).status).toBe(403);
    });

    it('잘못된 body(simulate 허용값 밖)는 400 — 가드 뒤·서비스 앞에서 걸린다', async () => {
      // force 는 전역 ValidationPipe 의 enableImplicitConversion 때문에 'yes' 같은 문자열도 true 로 바뀌어 통과한다.
      // 프로젝트 전체 규칙이라 여기서 단언하지 않는다.
      expect(
        (await axios.post('/ops/incidents/1/analysis', { simulate: 'boom' }, auth(adminMobile.accessToken))).status,
      ).toBe(400);
    });

    it('강제 실패 → parse_failed 행(LLM 미호출) → 재요청은 캐시 HIT / 없는 이슈 404 / 키 미설정 서버면 503', async () => {
      const list = await axios.get('/ops/incidents', auth(adminMobile.accessToken));
      if (list.status === 503) {
        // Sentry 미설정이면 인시던트 자체를 못 읽으므로 분석도 503(Sentry) 로 끝난다
        expect((await axios.post('/ops/incidents/1/analysis', {}, auth(adminMobile.accessToken))).status).toBe(503);
        return;
      }

      const probe = await axios.post('/ops/incidents/999999999999/analysis', {}, auth(adminMobile.accessToken));
      if (probe.status === 503) {
        // LLM 키 미설정(no-op) 경로: 서버가 죽지 않고 명시적으로 알린다. 그 밖의 단언은 할 수 없다
        expect(probe.data.message).toMatch(/LLM/);
        return;
      }
      expect(probe.status).toBe(404);

      // 최근 24h 에 이슈가 없는 조용한 날에는 분석할 대상이 없다 — 여기까지만 단언한다
      if (list.data.length === 0) return;
      const id: string = list.data[0].id;

      // 강제 실패: 비운영 서버에서만 통한다. 운영 서버를 향해 돌리면(그럴 일은 없지만) 실제 분석이 만들어지므로
      // status 로 분기해 두 경우 모두 형태만은 고정한다.
      const failed = await axios.post(
        `/ops/incidents/${id}/analysis`,
        { simulate: 'parse_failed' },
        auth(adminMobile.accessToken),
      );
      expect(failed.status).toBe(201);
      expect(failed.headers['x-cache']).toBe('MISS');
      expect(Object.keys(failed.data).sort()).toEqual(ANALYSIS_KEYS);
      expect(failed.data.incidentId).toBe(id);
      expect(failed.data.promptVersion).toEqual(expect.any(String)); // Phase 4 비교 축 — 비어 있으면 안 된다
      if (failed.data.status === 'parse_failed') {
        expect(failed.data.result).toBeNull();
        expect(failed.data.rawText).toContain('[simulated parse_failed]');
        expect(failed.data.model).toBe('simulated');
        const rows = await ds.query(
          `SELECT status, result_json, prompt_version FROM ops_analyses WHERE id = $1`,
          [failed.data.id],
        );
        expect(rows).toEqual([{ status: 'parse_failed', result_json: null, prompt_version: failed.data.promptVersion }]);
      } else {
        expect(failed.data.status).toBe('ok');
        expect(failed.data.result).toMatchObject({ severity: expect.any(String), rootCause: expect.any(String) });
      }

      // force 없이 다시 → 최근 행 그대로(HIT). 화면을 다시 열 때마다 LLM 을 태우지 않는다
      const again = await axios.post(`/ops/incidents/${id}/analysis`, {}, auth(adminMobile.accessToken));
      expect(again.status).toBe(201);
      expect(again.headers['x-cache']).toBe('HIT');
      expect(again.data.id).toBe(failed.data.id);
    });
  });
});
