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
 * F. 평가 루프(Phase 4) — GET /ops/analyses/pending · POST /ops/analyses/:id/review · GET /ops/analyses/stats
 *   · 픽스처: ok 행과 parse_failed 행을 DB 에 직접 심는다(model='e2e-fixture'). LLM 을 부르지 않는다
 *   · pending 은 ok 행만, promptVersion 없이(블라인드) · 평가 저장 → 목록에서 사라짐 · 재평가는 덮어쓰기(upsert)
 *   · stats 가 버전별 승인율·구조화 실패율을 낸다 — DoD 의 숫자가 이 경로에서 나온다
 *   · Phase 7(채점 안내): PUT /ops/incidents/:id/note 로 사실 메모 upsert → pending 카드에 note·checklist 동봉, relatedFiles 정규화 ·
 *     guided=true 평가는 안내 전 평가와 **별도 행**(옛 행 보존) · pending 은 안내 평가가 없는 분석만 · stats 에 unguided/guided 분리
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
  let adminId: number;
  let buyerToken: string;

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();

    await cleanupE2eData(ds, SUITE);
    await resetLoginRateLimits();

    adminId = await createUser(ds, { email: emails.admin, role: 'admin' });
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
        ['breadcrumbs', 'count', 'culprit', 'exception', 'firstRelease', 'firstSeen', 'id', 'lastSeen', 'level', 'project', 'release', 'status', 'title'],
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
    // Phase 8 후속: S4 보강 필드 4개(project · note · identifierCheck · reviewSummary) — 컨트롤러가 채운다
    const ANALYSIS_KEYS = ['createdAt', 'fewShotIds', 'id', 'identifierCheck', 'incidentId', 'latencyMs', 'model', 'note', 'project', 'promptVersion', 'rawText', 'result', 'reviewSummary', 'status', 'toolCalls'];

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
        expect(failed.data.toolCalls).toBeNull(); // 시뮬레이션은 도구를 주지 않는다(Phase 5)
        // Phase 8 후속: 구조화 실패 행은 대조할 코드가 없다 · 새 행이라 채점 0 · 메모는 인시던트에 따라 있을 수도(null 또는 객체)
        expect(failed.data.identifierCheck).toBeNull();
        expect(failed.data.reviewSummary).toEqual({ reviews: 0, approved: 0, rejected: 0, avgRating: null, mine: null });
        expect(failed.data.note === null || typeof failed.data.note === 'object').toBe(true);
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

  describe('F. 평가 루프 — /ops/analyses/pending · /:id/review · /stats (Phase 4) + 채점 안내(Phase 7)', () => {
    const FIXTURE_MODEL = 'e2e-fixture';
    const FIXTURE_VERSION = 'e2e-v9';
    const INCIDENT = 'e2e-issue-1';
    // relatedFiles 는 카드에 나갈 때 저장소 경로로 정규화된다(Phase 7 블라인드) — project 가 프론트면 `./src/x.ts` → `frontend/src/x.ts`
    const RESULT = { severity: 'low', rootCause: 'e2e 픽스처 원인', suggestedFix: '조치 없음', relatedFiles: ['./src/x.ts', 'backend/src/main.ts'], confidence: 'high' };
    const BLIND_FILES = ['frontend/src/x.ts', 'backend/src/main.ts'];
    // Phase 8: identifierCheck(조치 코드 이름 대조). 픽스처 조치('조치 없음')엔 코드 이름이 없어 GitHub 를 부르지 않고 checkedCount 0 으로 온다
    const PENDING_KEYS = ['analysisId', 'checklist', 'createdAt', 'exceptionText', 'identifierCheck', 'incidentId', 'incidentTitle', 'model', 'note', 'result'];
    const CHECK_KEYS = ['causeLocation', 'noInventedIdentifiers', 'applicableAsIs', 'confidenceFits'];
    const NOTE = { symptom: 'e2e 증상', causeLocation: 'e2e 원인 위치', fixDirection: 'e2e 조치 방향', commonMistakes: 'e2e 오답', project: 'e-commerse-frontend' };
    let okId: number;
    let failedId: number;

    beforeAll(async () => {
      // LLM 없이 평가 API 만 검증하려고 분석 행을 직접 심는다. incident_id 는 Sentry 를 안 부르므로 아무 문자열이어도 된다.
      const [ok] = await ds.query(
        `INSERT INTO ops_analyses (incident_id, status, result_json, raw_text, prompt_version, model, latency_ms, incident_title, exception_text, project)
         VALUES ($4, 'ok', $1, NULL, $2, $3, 0, 'e2e 픽스처 제목', 'E2eError: fixture', 'e-commerse-frontend') RETURNING id`,
        [JSON.stringify(RESULT), FIXTURE_VERSION, FIXTURE_MODEL, INCIDENT],
      );
      const [failed] = await ds.query(
        `INSERT INTO ops_analyses (incident_id, status, result_json, raw_text, prompt_version, model, latency_ms)
         VALUES ($3, 'parse_failed', NULL, 'not json', $1, $2, 0) RETURNING id`,
        [FIXTURE_VERSION, FIXTURE_MODEL, INCIDENT],
      );
      okId = ok.id;
      failedId = failed.id;
      await ds.query(`DELETE FROM ops_incident_notes WHERE incident_id = $1`, [INCIDENT]);
    });

    afterAll(async () => {
      // 평가 행은 analysis FK CASCADE 로 함께 지워진다. 남기면 다음 실제 분석의 few-shot 예시로 섞여 들어간다
      await ds.query(`DELETE FROM ops_analyses WHERE model = $1`, [FIXTURE_MODEL]);
      await ds.query(`DELETE FROM ops_incident_notes WHERE incident_id = $1`, [INCIDENT]);
    });

    it('토큰 없음 → 401, buyer → 403 (네 엔드포인트 모두)', async () => {
      expect((await axios.get('/ops/analyses/pending')).status).toBe(401);
      expect((await axios.get('/ops/analyses/stats')).status).toBe(401);
      expect((await axios.post(`/ops/analyses/${okId}/review`, { verdict: 'approved' })).status).toBe(401);
      expect((await axios.put(`/ops/incidents/${INCIDENT}/note`, NOTE)).status).toBe(401);
      expect((await axios.get('/ops/analyses/pending', auth(buyerToken))).status).toBe(403);
      expect((await axios.get('/ops/analyses/stats', auth(buyerToken))).status).toBe(403);
      expect((await axios.post(`/ops/analyses/${okId}/review`, { verdict: 'approved' }, auth(buyerToken))).status).toBe(403);
      expect((await axios.put(`/ops/incidents/${INCIDENT}/note`, NOTE, auth(buyerToken))).status).toBe(403);
    });

    it('pending: 픽스처 ok 행이 보이고 promptVersion 이 없다(블라인드) · relatedFiles 는 정규화 · 메모 없으면 note=null · checklist 4개 · parse_failed 행은 없다', async () => {
      const res = await axios.get('/ops/analyses/pending', auth(adminMobile.accessToken));
      expect(res.status).toBe(200);
      const mine = res.data.find((p: { analysisId: number }) => p.analysisId === okId);
      expect(mine).toBeDefined();
      expect(Object.keys(mine).sort()).toEqual(PENDING_KEYS);
      expect(mine).toMatchObject({
        incidentId: INCIDENT,
        incidentTitle: 'e2e 픽스처 제목',
        exceptionText: 'E2eError: fixture',
        model: FIXTURE_MODEL,
        result: { ...RESULT, relatedFiles: BLIND_FILES },
        note: null,
        identifierCheck: { checkedFiles: [], checkedCount: 0, unknown: [], maybeLibrary: [] },
      });
      expect(mine.checklist.map((c: { key: string }) => c.key)).toEqual(CHECK_KEYS);
      expect(res.data.some((p: { analysisId: number }) => p.analysisId === failedId)).toBe(false);
    });

    it('PUT note: 잘못된 입력 400(빈 symptom · code 범위 역순) → 저장(CREATED) → 다시 PUT 은 UPDATED → pending 카드에 note 로 실린다', async () => {
      const a = auth(adminMobile.accessToken);
      expect((await axios.put(`/ops/incidents/${INCIDENT}/note`, { ...NOTE, symptom: '' }, a)).status).toBe(400);
      expect((await axios.put(`/ops/incidents/${INCIDENT}/note`, { ...NOTE, code: { path: 'backend/src/main.ts', startLine: 9, endLine: 3 } }, a)).status).toBe(400);
      expect(await ds.query(`SELECT count(*)::int AS n FROM ops_incident_notes WHERE incident_id = $1`, [INCIDENT])).toEqual([{ n: 0 }]);

      // 코드 없는 메모(GitHub 를 부르지 않는다). Sentry 도 부르지 않으므로 옛 인시던트에도 달 수 있다
      const first = await axios.put(`/ops/incidents/${INCIDENT}/note`, NOTE, a);
      expect(first.status).toBe(200);
      expect(first.headers['x-note']).toBe('CREATED');
      expect(first.data).toMatchObject({ incidentId: INCIDENT, ...NOTE, code: null });

      const second = await axios.put(`/ops/incidents/${INCIDENT}/note`, { ...NOTE, fixDirection: '고친 조치 방향' }, a);
      expect(second.headers['x-note']).toBe('UPDATED');
      expect(await ds.query(`SELECT count(*)::int AS n, min(fix_direction) AS f FROM ops_incident_notes WHERE incident_id = $1`, [INCIDENT])).toEqual([{ n: 1, f: '고친 조치 방향' }]);

      const pending = await axios.get('/ops/analyses/pending', a);
      const mine = pending.data.find((p: { analysisId: number }) => p.analysisId === okId);
      expect(mine.note).toMatchObject({ incidentId: INCIDENT, symptom: 'e2e 증상', fixDirection: '고친 조치 방향', code: null });
    });

    it('잘못된 입력: verdict 허용값 밖·rating 6·checks 에 boolean 아닌 값 → 400 / 없는 분석 404 / parse_failed 행 400 / id 가 숫자가 아니면 400', async () => {
      const a = auth(adminMobile.accessToken);
      expect((await axios.post(`/ops/analyses/${okId}/review`, { verdict: 'maybe' }, a)).status).toBe(400);
      expect((await axios.post(`/ops/analyses/${okId}/review`, { verdict: 'approved', rating: 6 }, a)).status).toBe(400);
      expect((await axios.post(`/ops/analyses/${okId}/review`, { verdict: 'approved', guided: true, checks: { causeLocation: 'yes' } }, a)).status).toBe(400);
      expect((await axios.post(`/ops/analyses/${okId}/review`, {}, a)).status).toBe(400);
      expect((await axios.post('/ops/analyses/999999999/review', { verdict: 'approved' }, a)).status).toBe(404);
      expect((await axios.post(`/ops/analyses/${failedId}/review`, { verdict: 'rejected' }, a)).status).toBe(400);
      expect((await axios.post('/ops/analyses/abc/review', { verdict: 'approved' }, a)).status).toBe(400);
      // 아무것도 저장되지 않았다
      expect(await ds.query(`SELECT count(*)::int AS n FROM ops_reviews WHERE analysis_id IN ($1, $2)`, [okId, failedId])).toEqual([{ n: 0 }]);
    });

    it('안내 없는 평가(CREATED) → 재평가는 덮어쓰기(UPDATED, 같은 id) → 안내 평가는 **별도 행**(옛 행 보존) → pending 에서 사라짐 → stats 에 전/후가 나란히', async () => {
      const a = auth(adminMobile.accessToken);

      // ① 안내 없는 평가(Phase 6 까지의 방식 — guided 를 안 보낸다)
      const first = await axios.post(`/ops/analyses/${okId}/review`, { verdict: 'approved', rating: 5, comment: ' 정확함 ' }, a);
      expect(first.status).toBe(201);
      expect(first.headers['x-review']).toBe('CREATED');
      expect(first.data).toMatchObject({ analysisId: okId, reviewerId: adminId, verdict: 'approved', rating: 5, comment: '정확함', guided: false, checks: null });
      expect(typeof first.data.id).toBe('number');

      // Phase 7: 안내 채점이 없고 **메모가 있으므로**(앞 테스트의 PUT note) 아직 pending 에 남아 있다 — 재채점 경로.
      // 메모가 없었다면 "이미 판정이 있는 카드"라 빠진다(같은 인시던트가 열 번씩 나오던 실기기 문제의 해법). 이 describe 는 순서에 기댄다
      let pending = await axios.get('/ops/analyses/pending', a);
      expect(pending.data.some((p: { analysisId: number }) => p.analysisId === okId)).toBe(true);

      // 같은 평가자가 다시(안내 없이) → 행이 늘지 않고 판정이 바뀐다. 안 보낸 rating 은 null 로(통째로 덮어쓰기)
      const second = await axios.post(`/ops/analyses/${okId}/review`, { verdict: 'rejected' }, a);
      expect(second.status).toBe(201);
      expect(second.headers['x-review']).toBe('UPDATED');
      expect(second.data).toMatchObject({ id: first.data.id, verdict: 'rejected', rating: null, comment: null, guided: false });

      // ② 안내와 함께 채점 → 새 행(CREATED). 옛 행은 그대로 남는다
      const guided = await axios.post(
        `/ops/analyses/${okId}/review`,
        { verdict: 'approved', rating: 4, guided: true, checks: { causeLocation: true, noInventedIdentifiers: false, applicableAsIs: true } },
        a,
      );
      expect(guided.status).toBe(201);
      expect(guided.headers['x-review']).toBe('CREATED');
      expect(guided.data.id).not.toBe(first.data.id);
      expect(guided.data).toMatchObject({
        verdict: 'approved', rating: 4, guided: true,
        checks: { causeLocation: true, noInventedIdentifiers: false, applicableAsIs: true, confidenceFits: null },
      });
      expect(
        await ds.query(`SELECT guided, verdict, rating FROM ops_reviews WHERE analysis_id = $1 ORDER BY guided`, [okId]),
      ).toEqual([
        { guided: false, verdict: 'rejected', rating: null },
        { guided: true, verdict: 'approved', rating: 4 },
      ]);

      // 안내 채점이 생겼으니 이제 pending 에서 빠진다
      pending = await axios.get('/ops/analyses/pending', a);
      expect(pending.data.some((p: { analysisId: number }) => p.analysisId === okId)).toBe(false);

      // 안내 채점 재전송은 guided 행을 덮어쓴다(UPDATED, 같은 id)
      const guidedAgain = await axios.post(`/ops/analyses/${okId}/review`, { verdict: 'rejected', guided: true, checks: { causeLocation: false } }, a);
      expect(guidedAgain.headers['x-review']).toBe('UPDATED');
      expect(guidedAgain.data).toMatchObject({ id: guided.data.id, verdict: 'rejected', checks: { causeLocation: false, noInventedIdentifiers: null } });

      // ③ 집계: 픽스처 버전 = 분석 2(ok 1 + parse_failed 1) · 평가 2(안내 전 rejected · 안내 후 rejected) → 전체 승인율 0, 실패율 0.5
      //    안내 후: 메모 있음 1 · ① 실패 1 · 나머지 미판단
      const stats = await axios.get('/ops/analyses/stats', a);
      expect(stats.status).toBe(200);
      const v = stats.data.versions.find((x: { promptVersion: string }) => x.promptVersion === FIXTURE_VERSION);
      expect(v).toEqual({
        promptVersion: FIXTURE_VERSION,
        analyses: 2,
        ok: 1,
        parseFailed: 1,
        parseFailedRate: 0.5,
        reviews: 2,
        approved: 0,
        rejected: 2,
        approvalRate: 0,
        avgRating: null,
        toolCalled: 0,
        unguided: { reviews: 1, approved: 0, rejected: 1, approvalRate: 0, avgRating: null },
        guided: {
          reviews: 1, approved: 0, rejected: 1, approvalRate: 0, avgRating: null, withNote: 1,
          checks: {
            causeLocation: { pass: 0, fail: 1, unknown: 0 },
            noInventedIdentifiers: { pass: 0, fail: 0, unknown: 1 },
            applicableAsIs: { pass: 0, fail: 0, unknown: 1 },
            confidenceFits: { pass: 0, fail: 0, unknown: 1 },
          },
        },
      });
      // simulated 행은 어느 버전에도 세지 않는다(E 절이 만든 것이 있어도)
      expect(stats.data.versions.every((x: { promptVersion: string }) => x.promptVersion !== 'simulated')).toBe(true);
    });
  });

  /**
   * G. 데모 계정(포트폴리오 방문자, 토큰 payload isDemo=true) — 2026-09-23 외부 배포(설계 §9 "외부 배포").
   *   · demo-login 도 X-Client: mobile 이면 body 에 refreshToken(DEMO_LOGIN_ENABLED 가 아닌 서버면 403 만 확인)
   *   · 기기 등록은 저장하지 않고 {registered:false, reason:'demo'} · 재분석(force)·simulate 는 403 · 메모 PUT 은 403(DemoAccountGuard)
   *   · 목록은 최근 14d(X-Period) · 평가는 저장되지만 대기 목록에서 빠지지 않고(showAll) stats 에도 세지 않는다
   *   전부 is_demo 사용자 한 명으로 고정한다 — 실제 데모 관리자(.env)는 건드리지 않는다.
   */
  describe('G. 데모 계정 — 조회는 되고, 쿼터·공용 데이터·푸시를 건드리는 길은 막힌다', () => {
    const FIXTURE_MODEL = 'e2e-fixture-demo';
    const FIXTURE_VERSION = 'e2e-demo-v1';
    const INCIDENT = 'e2e-demo-issue-1';
    const RESULT = { severity: 'low', rootCause: 'e2e 데모 픽스처', suggestedFix: '조치 없음', relatedFiles: [], confidence: 'low' };
    let demo: { accessToken: string; refreshToken: string };
    let demoId: number;
    let okId: number;

    beforeAll(async () => {
      demoId = await createUser(ds, { email: emails.demoAdmin, role: 'admin', isDemo: true });
      const res = await loginRaw(emails.demoAdmin, MOBILE);
      demo = { accessToken: res.data.accessToken, refreshToken: res.data.refreshToken };
      expect(res.data.user).toMatchObject({ isDemo: true, roles: ['admin'] });

      const [ok] = await ds.query(
        `INSERT INTO ops_analyses (incident_id, status, result_json, raw_text, prompt_version, model, latency_ms, incident_title, exception_text)
         VALUES ($4, 'ok', $1, NULL, $2, $3, 0, 'e2e 데모 픽스처 제목', 'E2eError: demo') RETURNING id`,
        [JSON.stringify(RESULT), FIXTURE_VERSION, FIXTURE_MODEL, INCIDENT],
      );
      okId = ok.id;
      // 이전 실행이 (가드 없는 옛 서버로) 메모를 남겼을 수 있다 — "403 이면 행이 없다" 단언이 그 잔재에 걸리지 않게
      await ds.query(`DELETE FROM ops_incident_notes WHERE incident_id = $1`, [INCIDENT]);
    });

    afterAll(async () => {
      await ds.query(`DELETE FROM ops_analyses WHERE model = $1`, [FIXTURE_MODEL]);
      await ds.query(`DELETE FROM ops_incident_notes WHERE incident_id = $1`, [INCIDENT]);
    });

    it('POST /auth/demo-login + X-Client: mobile → body 에 refreshToken 과 isDemo 관리자(웹 경로는 종전 그대로 쿠키만)', async () => {
      // demo-login 도 IP 당 로그인 상한을 센다 — 앞 스위트들이 창구를 다 썼을 수 있으니 loginRaw 처럼 비우고 간다
      await resetLoginRateLimits();
      const mobile = await axios.post('/auth/demo-login', {}, { headers: MOBILE });
      if (mobile.status === 403) {
        // DEMO_LOGIN_ENABLED 가 아닌 서버 — 분기 자체는 컨트롤러 단위 테스트가 고정한다
        expect(mobile.data.message).toMatch(/데모/);
        return;
      }
      expect(mobile.status).toBe(200);
      expect(typeof mobile.data.refreshToken).toBe('string');
      expect(mobile.data.user).toMatchObject({ isDemo: true });
      expect(mobile.data.user.roles).toContain('admin');

      const web = await axios.post('/auth/demo-login', {});
      expect(web.status).toBe(200);
      expect(web.data).not.toHaveProperty('refreshToken');
      expect(refreshCookieOf(web)).toBeDefined();
    });

    it('기기 등록: 201 이지만 저장하지 않는다 — {registered:false, reason:"demo"}, 표에 행 없음', async () => {
      const res = await axios.post(
        '/ops/devices',
        { expoPushToken: 'ExponentPushToken[e2e-demo-visitor-0001]', platform: 'android' },
        auth(demo.accessToken),
      );
      expect(res.status).toBe(201);
      expect(res.data).toEqual({ registered: false, reason: 'demo' });
      expect(await ds.query(`SELECT 1 FROM ops_device_tokens WHERE user_id = $1`, [demoId])).toHaveLength(0);
    });

    it('AI 분석: force·simulate 는 403 — LLM 키·Sentry 설정과 무관하게 같은 답이고 행도 생기지 않는다', async () => {
      const a = auth(demo.accessToken);
      const before = (await ds.query(`SELECT COUNT(*)::int AS n FROM ops_analyses`))[0].n;
      const forced = await axios.post('/ops/incidents/7742806116/analysis', { force: true }, a);
      expect(forced.status).toBe(403);
      expect(forced.data.message).toMatch(/데모/);
      expect((await axios.post('/ops/incidents/7742806116/analysis', { simulate: 'parse_failed' }, a)).status).toBe(403);
      expect((await ds.query(`SELECT COUNT(*)::int AS n FROM ops_analyses`))[0].n).toBe(before);
    });

    it('사실 메모 PUT → 403(DemoAccountGuard). 관리자 경로는 그대로다', async () => {
      const body = { symptom: '데모', causeLocation: '데모', fixDirection: '데모' };
      const res = await axios.put(`/ops/incidents/${INCIDENT}/note`, body, auth(demo.accessToken));
      expect(res.status).toBe(403);
      expect(res.data.message).toMatch(/데모 계정/);
      expect(await ds.query(`SELECT 1 FROM ops_incident_notes WHERE incident_id = $1`, [INCIDENT])).toHaveLength(0);
    });

    it('인시던트 목록: X-Period 가 14d(관리자는 24h) — 키 미설정 서버면 둘 다 503', async () => {
      const res = await axios.get('/ops/incidents', auth(demo.accessToken));
      const admin = await axios.get('/ops/incidents', auth(adminMobile.accessToken));
      if (res.status === 503) {
        expect(admin.status).toBe(503);
        return;
      }
      expect(res.status).toBe(200);
      expect(res.headers['x-period']).toBe('14d');
      expect(admin.headers['x-period']).toBe('24h');
    });

    it('평가: 저장은 되지만(201) 대기 목록에서 빠지지 않고(showAll), stats 에는 세지 않으며, 관리자의 대기 목록엔 영향이 없다', async () => {
      const a = auth(demo.accessToken);
      const pendingBefore = await axios.get('/ops/analyses/pending', a);
      expect(pendingBefore.data.some((p: { analysisId: number }) => p.analysisId === okId)).toBe(true);

      const saved = await axios.post(`/ops/analyses/${okId}/review`, { verdict: 'approved', rating: 5, guided: true }, a);
      expect(saved.status).toBe(201);
      expect(saved.data).toMatchObject({ reviewerId: demoId, verdict: 'approved' });

      // 방문자 모두가 한 계정을 쓰므로 채점해도 카드가 사라지지 않는다(뒤 방문자가 빈 화면을 보지 않게)
      const pendingAfter = await axios.get('/ops/analyses/pending', a);
      expect(pendingAfter.data.some((p: { analysisId: number }) => p.analysisId === okId)).toBe(true);

      // 승인율·few-shot 풀에는 들어가지 않는다 — 외부인의 스와이프가 순환 고리를 오염시키지 않게
      const stats = await axios.get('/ops/analyses/stats', auth(adminMobile.accessToken));
      const v = stats.data.versions.find((x: { promptVersion: string }) => x.promptVersion === FIXTURE_VERSION);
      expect(v).toMatchObject({ analyses: 1, reviews: 0, approved: 0, approvalRate: null });

      // 관리자는 아직 채점하지 않았으니 자기 대기 목록에서 그 카드를 본다(데모의 판정은 남의 목록을 건드리지 않는다)
      const adminPending = await axios.get('/ops/analyses/pending', auth(adminMobile.accessToken));
      expect(adminPending.data.some((p: { analysisId: number }) => p.analysisId === okId)).toBe(true);
    });
  });
});
