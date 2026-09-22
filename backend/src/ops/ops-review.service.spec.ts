import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OpsReviewService } from './ops-review.service';
import { OpsAnalysisEntity } from './entity/ops-analysis.entity';
import { OpsReviewEntity } from './entity/ops-review.entity';
import { REVIEW_CHECKLIST } from './dto/review.dto';
import { IdentifierCheckService } from './identifier-check.service';

/**
 * OpsReviewService 단위 테스트 — upsert 규칙 · 입력 검증 · 응답 변환 · SQL 결과 매핑.
 * SQL 문 자체(NOT EXISTS · FILTER · GROUP BY)는 e2e F 절이 실 DB 로 고정한다.
 * Phase 7: guided 가 upsert 키에 들어간 것 · relatedFiles 정규화(블라인드) · 메모 동봉 · stats 의 안내 전/후 분리.
 */
describe('OpsReviewService — 평가 루프(설계 §9 Phase 4 · Phase 7)', () => {
  let service: OpsReviewService;
  let reviews: { findOne: jest.Mock; find: jest.Mock; create: jest.Mock; save: jest.Mock };
  let analyses: { findOne: jest.Mock; query: jest.Mock };
  let identifierCheck: { checkMany: jest.Mock };

  const okAnalysis = (over: Partial<OpsAnalysisEntity> = {}): Partial<OpsAnalysisEntity> => ({
    id: 7,
    incidentId: '7732523858',
    status: 'ok',
    model: 'gemini-3.1-flash-lite',
    resultJson: { severity: 'high', rootCause: 'x', suggestedFix: 'y', relatedFiles: [], confidence: 'medium' },
    ...over,
  });

  /** listPending SQL 결과 한 행(메모 없음) */
  const pendingRow = (over: Record<string, unknown> = {}) => ({
    id: 7,
    incident_id: '7732523858',
    incident_title: 'AxiosError: Network Error',
    exception_text: 'AxiosError: Network Error',
    result_json: { severity: 'high', rootCause: 'x', suggestedFix: 'y', relatedFiles: [], confidence: 'medium' },
    model: 'gemini-3.1-flash-lite',
    createdAt: new Date('2026-09-21T09:00:00Z'),
    project: null,
    note_id: null,
    note_project: null,
    symptom: null,
    cause_location: null,
    fix_direction: null,
    common_mistakes: null,
    code_path: null,
    code_ref: null,
    code_start_line: null,
    code_end_line: null,
    code_text: null,
    note_updated_at: null,
    ...over,
  });

  beforeEach(async () => {
    let nextId = 100;
    reviews = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v: Partial<OpsReviewEntity>) => ({ ...v })),
      save: jest.fn(async (v: Partial<OpsReviewEntity>) => ({
        id: v.id ?? nextId++,
        createdAt: new Date('2026-09-21T10:00:00Z'),
        updatedAt: new Date('2026-09-21T10:00:00Z'),
        ...v,
      })),
    };
    analyses = { findOne: jest.fn().mockResolvedValue(okAnalysis()), query: jest.fn().mockResolvedValue([]) };
    identifierCheck = { checkMany: jest.fn().mockResolvedValue(new Map()) };

    const module = await Test.createTestingModule({
      providers: [
        OpsReviewService,
        { provide: getRepositoryToken(OpsReviewEntity), useValue: reviews },
        { provide: getRepositoryToken(OpsAnalysisEntity), useValue: analyses },
        { provide: IdentifierCheckService, useValue: identifierCheck },
      ],
    }).compile();
    service = module.get(OpsReviewService);
  });

  describe('submitReview — 저장과 upsert', () => {
    it('없는 분석 → 404', async () => {
      analyses.findOne.mockResolvedValue(null);
      await expect(service.submitReview(1, 999, { verdict: 'approved' })).rejects.toBeInstanceOf(NotFoundException);
      expect(reviews.save).not.toHaveBeenCalled();
    });

    it('parse_failed 행과 simulated 행은 평가 대상이 아니다 → 400', async () => {
      analyses.findOne.mockResolvedValue(okAnalysis({ status: 'parse_failed', resultJson: null }));
      await expect(service.submitReview(1, 7, { verdict: 'rejected' })).rejects.toBeInstanceOf(BadRequestException);

      analyses.findOne.mockResolvedValue(okAnalysis({ model: 'simulated' }));
      await expect(service.submitReview(1, 7, { verdict: 'rejected' })).rejects.toBeInstanceOf(BadRequestException);
      expect(reviews.save).not.toHaveBeenCalled();
    });

    it('첫 평가 → 새 행(created=true), rating·comment·checks 없으면 null, comment 는 trim, guided 기본 false', async () => {
      const { item, created } = await service.submitReview(42, 7, { verdict: 'approved', comment: '  좋음  ' });

      expect(created).toBe(true);
      expect(reviews.findOne).toHaveBeenCalledWith({ where: { analysisId: 7, reviewerId: 42, guided: false } });
      expect(reviews.create).toHaveBeenCalledWith({ analysisId: 7, reviewerId: 42, guided: false });
      expect(reviews.save).toHaveBeenCalledWith(
        expect.objectContaining({ analysisId: 7, reviewerId: 42, verdict: 'approved', rating: null, comment: '좋음', guided: false, checks: null }),
      );
      expect(item).toEqual({
        id: 100,
        analysisId: 7,
        reviewerId: 42,
        verdict: 'approved',
        rating: null,
        comment: '좋음',
        guided: false,
        checks: null,
        createdAt: '2026-09-21T10:00:00.000Z',
        updatedAt: '2026-09-21T10:00:00.000Z',
      });
    });

    it('안내 채점(guided=true) — 키에 guided 가 들어가 안내 전 행과 **다른 행**이 되고, checks 는 키 4개로 정돈된다', async () => {
      // 안내 전 행이 이미 있어도(findOne 은 guided 로 조회하므로) 새 행을 만든다
      reviews.findOne.mockResolvedValue(null);
      const { item, created } = await service.submitReview(42, 7, {
        verdict: 'rejected',
        guided: true,
        checks: { causeLocation: true, noInventedIdentifiers: false, bogus: true } as never,
      });

      expect(created).toBe(true);
      expect(reviews.findOne).toHaveBeenCalledWith({ where: { analysisId: 7, reviewerId: 42, guided: true } });
      expect(reviews.create).toHaveBeenCalledWith({ analysisId: 7, reviewerId: 42, guided: true });
      expect(item.guided).toBe(true);
      expect(item.checks).toEqual({ causeLocation: true, noInventedIdentifiers: false, applicableAsIs: null, confidenceFits: null });
      expect(Object.keys(item.checks ?? {})).not.toContain('bogus');
    });

    it('같은 평가자의 재평가 → 같은 guided 의 기존 행을 통째로 덮어쓴다(created=false, 안 보낸 rating·checks 는 null 로)', async () => {
      reviews.findOne.mockResolvedValue({ id: 5, analysisId: 7, reviewerId: 42, verdict: 'approved', rating: 5, comment: '좋음', guided: false, checks: null });

      const { item, created } = await service.submitReview(42, 7, { verdict: 'rejected' });

      expect(created).toBe(false);
      expect(reviews.create).not.toHaveBeenCalled();
      expect(reviews.save).toHaveBeenCalledWith(expect.objectContaining({ id: 5, verdict: 'rejected', rating: null, comment: null, checks: null }));
      expect(item.id).toBe(5);
      expect(item.verdict).toBe('rejected');
    });

    it('동시 저장으로 유니크 위반(23505)이 나면 그 사이 생긴 행에 덮어쓴다', async () => {
      reviews.save
        .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))
        .mockImplementationOnce(async (v: Partial<OpsReviewEntity>) => ({ ...v, createdAt: new Date(0), updatedAt: new Date(0) }));
      reviews.findOne
        .mockResolvedValueOnce(null) // 첫 조회: 없음 → create
        .mockResolvedValueOnce({ id: 9, analysisId: 7, reviewerId: 42, verdict: 'approved', rating: 3, comment: null, guided: false }); // 충돌 후 재조회

      const { item } = await service.submitReview(42, 7, { verdict: 'rejected', rating: 1 });

      expect(reviews.save).toHaveBeenCalledTimes(2);
      expect(item).toMatchObject({ id: 9, verdict: 'rejected', rating: 1 });
    });

    it('23505 가 아닌 DB 에러는 그대로 올라온다', async () => {
      reviews.save.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '42P01' }));
      await expect(service.submitReview(42, 7, { verdict: 'approved' })).rejects.toThrow('boom');
    });
  });

  describe('listPending — 블라인드 대기 목록', () => {
    it('SQL 결과를 카드 항목으로 매핑하고, promptVersion 은 응답에 없다 · 메모 없으면 note=null · checklist 동봉', async () => {
      analyses.query.mockResolvedValue([pendingRow()]);

      const items = await service.listPending(42);

      expect(items).toEqual([
        {
          analysisId: 7,
          incidentId: '7732523858',
          incidentTitle: 'AxiosError: Network Error',
          exceptionText: 'AxiosError: Network Error',
          result: { severity: 'high', rootCause: 'x', suggestedFix: 'y', relatedFiles: [], confidence: 'medium' },
          model: 'gemini-3.1-flash-lite',
          createdAt: '2026-09-21T09:00:00.000Z',
          note: null,
          checklist: REVIEW_CHECKLIST,
          identifierCheck: null,
        },
      ]);
      expect(Object.keys(items[0])).not.toContain('promptVersion');
      expect(Object.keys(items[0])).not.toContain('toolCalls');
      expect(items[0].checklist.map((c) => c.key)).toEqual(['causeLocation', 'noInventedIdentifiers', 'applicableAsIs', 'confidenceFits']);

      // 평가자 id 는 NOT EXISTS(정수) 와 md5 셔플(문자열) 두 자리에 각각 들어간다. Phase 7: 안내 채점(guided=true)만 뺀다
      const [sql, params] = analyses.query.mock.calls[0];
      expect(sql).toMatch(/NOT EXISTS/);
      expect(sql).toMatch(/r\.guided = true/);
      // 메모 있는 카드 먼저(재채점 14장이 옛 카드 뒤에 흩어지지 않게), 그 안에서 평가자별 고정 셔플
      expect(sql).toMatch(/ORDER BY \(n\.id IS NULL\), md5\(/);
      // 같은 인시던트·같은 버전은 최신 한 장만 · 메모 없는 카드는 이미 판정이 있으면 다시 묻지 않는다(실기기에서 CORS 가 10번 나온 뒤 추가)
      expect(sql).toMatch(/a\.id = \(\s*SELECT MAX\(b\.id\) FROM ops_analyses b[\s\S]*b\.prompt_version = a\.prompt_version/);
      expect(sql).toMatch(/n\.id IS NOT NULL OR NOT EXISTS \(\s*SELECT 1 FROM ops_reviews r2 WHERE r2\.analysis_id = a\.id AND r2\.reviewer_id = \$1/);
      expect(sql).toMatch(/simulated/);
      expect(sql).toMatch(/LEFT JOIN ops_incident_notes/);
      // SELECT 목록에 prompt_version 이 없다(블라인드). WHERE 의 "같은 버전 최신 1장" 비교에만 쓰인다
      expect(sql.split('FROM ops_analyses a')[0]).not.toMatch(/prompt_version/);
      expect(params).toEqual([42, '42', OpsReviewService.PENDING_LIMIT]);
    });

    it('메모가 있으면 note 로 실린다(코드 포함) — 같은 인시던트의 두 팔이 같은 메모를 본다', async () => {
      analyses.query.mockResolvedValue([
        pendingRow({
          note_id: 3,
          note_project: 'e-commerse-backend',
          symptom: '봇이 서버 자신 도메인을 Origin 으로',
          cause_location: 'backend/src/main.ts 61~66행',
          fix_direction: 'Sentry 필터 또는 cb(null,false)',
          common_mistakes: 'CORS_ORIGINS 에 추가',
          code_path: 'backend/src/main.ts',
          code_ref: '00107b7',
          code_start_line: 51,
          code_end_line: 72,
          code_text: '51| // CORS 설정',
          note_updated_at: new Date('2026-09-22T00:00:00Z'),
        }),
      ]);

      const [item] = await service.listPending(42);
      expect(item.note).toEqual({
        incidentId: '7732523858',
        project: 'e-commerse-backend',
        symptom: '봇이 서버 자신 도메인을 Origin 으로',
        causeLocation: 'backend/src/main.ts 61~66행',
        fixDirection: 'Sentry 필터 또는 cb(null,false)',
        commonMistakes: 'CORS_ORIGINS 에 추가',
        code: { path: 'backend/src/main.ts', ref: '00107b7', startLine: 51, endLine: 72, text: '51| // CORS 설정' },
        updatedAt: '2026-09-22T00:00:00.000Z',
      });
    });

    it('relatedFiles 를 저장소 경로로 정규화한다 — v1.1 의 `./src/…`·`src/…` 와 v3.1 의 `frontend/src/…` 가 같은 꼴이 된다(블라인드)', async () => {
      analyses.query.mockResolvedValue([
        pendingRow({
          id: 54,
          project: 'e-commerse-frontend',
          result_json: { severity: 'high', rootCause: 'x', suggestedFix: 'y', confidence: 'medium',
            relatedFiles: ['src/hooks/useCategories.ts', './src/components/common/SearchBar/CategorySelect.tsx', 'frontend/src/hooks/useCategories.ts', '../node_modules/x.js', 'backend/src/main.ts:65'] },
        }),
      ]);

      const [item] = await service.listPending(42);
      // 입력 순서 유지 · 중복(세 번째)은 한 번만 · 바꿀 수 없는 `../` 는 그대로 · 폴더 이름이 있으면 project 와 무관하게 통과
      expect(item.result.relatedFiles).toEqual([
        'frontend/src/hooks/useCategories.ts',
        'frontend/src/components/common/SearchBar/CategorySelect.tsx',
        '../node_modules/x.js',
        'backend/src/main.ts:65',
      ]);
    });

    it('identifierCheck(Phase 8) — 정규화된 relatedFiles·메모 코드 경로/ref·tool_calls 를 대조 서비스에 넘기고 결과를 카드에 붙인다 · 실패하면 null 로 내려간다', async () => {
      analyses.query.mockResolvedValue([
        pendingRow({
          id: 66,
          project: 'e-commerse-backend',
          result_json: { severity: 'high', rootCause: 'x', suggestedFix: 'process.env.FRONTEND_URL', confidence: 'medium', relatedFiles: ['./src/main.ts', 'backend/src/main.ts'] },
          tool_calls: null,
          code_path: 'backend/src/main.ts',
          code_ref: '00107b7',
        }),
        pendingRow({ id: 67, tool_calls: [{ path: 'backend/src/main.ts', ref: '00107b7', startLine: 50, endLine: 70, ok: true, lines: 21 }] }),
      ]);
      const view = { checkedFiles: ['backend/src/main.ts@00107b7'], checkedCount: 1, unknown: ['FRONTEND_URL'], maybeLibrary: [] };
      identifierCheck.checkMany.mockResolvedValue(new Map([[66, view]]));

      const items = await service.listPending(42);
      expect(identifierCheck.checkMany).toHaveBeenCalledWith([
        expect.objectContaining({ analysisId: 66, incidentId: '7732523858', suggestedFix: 'process.env.FRONTEND_URL', relatedFiles: ['backend/src/main.ts'], toolCalls: null, noteCodePath: 'backend/src/main.ts', noteCodeRef: '00107b7' }),
        expect.objectContaining({ analysisId: 67, toolCalls: [expect.objectContaining({ ref: '00107b7' })], noteCodePath: null, noteCodeRef: null }),
      ]);
      expect(items[0].identifierCheck).toEqual(view);
      expect(items[1].identifierCheck).toBeNull();

      identifierCheck.checkMany.mockRejectedValue(new Error('GitHub down'));
      const again = await service.listPending(42);
      expect(again).toHaveLength(2);
      expect(again.every((i) => i.identifierCheck === null)).toBe(true);
    });

    it('blindResult — project 힌트가 없으면 폴더 이름이 있는 경로만 바뀌고 나머지는 `./` 만 뗀다 · 중복 제거', () => {
      const r = OpsReviewService.blindResult(
        { severity: 'low', rootCause: '', suggestedFix: '', confidence: 'low', relatedFiles: ['./src/a.ts', 'src/a.ts', 'ops-companion/src/lib/sentry.ts', 'app:///ops-companion/app/(tabs)/profile.tsx'] },
        null,
      );
      expect(r.relatedFiles).toEqual(['src/a.ts', 'ops-companion/src/lib/sentry.ts', 'ops-companion/app/(tabs)/profile.tsx']);
    });
  });

  describe('getStats — 버전별 승인율(전체 · 안내 전 · 안내 후)', () => {
    it('approved/(approved+rejected) 로 승인율, 평가 없으면 null, 소수 셋째 자리 반올림 · guided 분리 · 항목별 pass/fail/unknown', async () => {
      analyses.query.mockResolvedValue([
        {
          prompt_version: 'v1', analyses: 6, ok: 5, parse_failed: 1, reviews: 3, approved: 1, rejected: 2, avg_rating: 2.3333,
          ug_reviews: 2, ug_approved: 1, ug_rejected: 1, ug_avg_rating: 3, g_reviews: 1, g_approved: 0, g_rejected: 1, g_avg_rating: 1, g_with_note: 1,
          chk_causeLocation_pass: 1, chk_causeLocation_fail: 0, chk_noInventedIdentifiers_pass: 0, chk_noInventedIdentifiers_fail: 1,
          chk_applicableAsIs_pass: 0, chk_applicableAsIs_fail: 0, chk_confidenceFits_pass: 0, chk_confidenceFits_fail: 1,
        },
        // tool_called·guided 열이 없는 행(옛 SQL 결과 형태)은 0 으로 본다
        { prompt_version: 'v2', analyses: 6, ok: 6, parse_failed: 0, reviews: 0, approved: 0, rejected: 0, avg_rating: null, tool_called: 2 },
      ]);

      const { versions, generatedAt } = await service.getStats();

      expect(versions[0]).toEqual({
        promptVersion: 'v1', analyses: 6, ok: 5, parseFailed: 1, parseFailedRate: 0.167,
        reviews: 3, approved: 1, rejected: 2, approvalRate: 0.333, avgRating: 2.333, toolCalled: 0,
        unguided: { reviews: 2, approved: 1, rejected: 1, approvalRate: 0.5, avgRating: 3 },
        guided: {
          reviews: 1, approved: 0, rejected: 1, approvalRate: 0, avgRating: 1, withNote: 1,
          checks: {
            causeLocation: { pass: 1, fail: 0, unknown: 0 },
            noInventedIdentifiers: { pass: 0, fail: 1, unknown: 0 },
            applicableAsIs: { pass: 0, fail: 0, unknown: 1 },
            confidenceFits: { pass: 0, fail: 1, unknown: 0 },
          },
        },
      });
      expect(versions[1]).toMatchObject({
        promptVersion: 'v2', approvalRate: null, avgRating: null, toolCalled: 2,
        unguided: { reviews: 0, approvalRate: null, avgRating: null },
        guided: { reviews: 0, withNote: 0, checks: { causeLocation: { pass: 0, fail: 0, unknown: 0 } } },
      });
      expect(new Date(generatedAt).getTime()).not.toBeNaN();
      const sql = analyses.query.mock.calls[0][0] as string;
      expect(sql).toMatch(/simulated/);
      expect(sql).not.toMatch(/a\.id >=/);
      expect(sql).toMatch(/r\.checks->>'noInventedIdentifiers'/);
      // 별칭은 큰따옴표 — 없으면 Postgres 가 소문자로 접어 camelCase 매핑이 전부 0 이 된다(e2e 로 잡힌 함정)
      expect(sql).toMatch(/AS "chk_noInventedIdentifiers_pass"/);
      expect(sql).toMatch(/AS "chk_confidenceFits_fail"/);
      expect(sql).toMatch(/LEFT JOIN ops_incident_notes/);
      expect(analyses.query.mock.calls[0][1]).toEqual([]);
    });

    it('minAnalysisId 를 주면 그 id 이상만 센다(Phase 6 — 새 세트만 집계). 정수가 아니면 무시', async () => {
      analyses.query.mockResolvedValue([]);

      await service.getStats({ minAnalysisId: 54.9 });
      const [sql, params] = analyses.query.mock.calls[0];
      expect(sql).toMatch(/a\.id >= \$1/);
      expect(params).toEqual([54]);

      await service.getStats({ minAnalysisId: Number.NaN });
      expect(analyses.query.mock.calls[1][0]).not.toMatch(/a\.id >=/);
      expect(analyses.query.mock.calls[1][1]).toEqual([]);
    });
  });

  describe('S4 보강(Phase 8 후속) — identifierCheckFor · summarizeReviews', () => {
    const item = (over: Record<string, unknown> = {}) =>
      ({
        id: 66,
        incidentId: '7732523858',
        status: 'ok',
        result: { severity: 'high', rootCause: 'x', suggestedFix: 'process.env.FRONTEND_URL', relatedFiles: ['./src/main.ts'], confidence: 'medium' },
        rawText: null,
        promptVersion: 'v1.1',
        model: 'm',
        latencyMs: 1,
        fewShotIds: null,
        toolCalls: null,
        createdAt: '2026-09-23T00:00:00.000Z',
        project: 'e-commerse-backend',
        note: null,
        identifierCheck: null,
        reviewSummary: null,
        ...over,
      }) as never;
    const note = {
      incidentId: '7732523858', project: 'e-commerse-backend', symptom: 's', causeLocation: 'c', fixDirection: 'f', commonMistakes: null,
      code: { path: 'backend/src/main.ts', ref: '00107b7', startLine: 51, endLine: 72, text: '…' }, updatedAt: '2026-09-22T00:00:00.000Z',
    };

    it('identifierCheckFor — 대기 카드와 같은 입력(정규화된 relatedFiles · 메모 코드 경로/ref · tool_calls)으로 한 장을 대조한다', async () => {
      const view = { checkedFiles: ['backend/src/main.ts@00107b7'], checkedCount: 1, unknown: ['FRONTEND_URL'], maybeLibrary: [] };
      identifierCheck.checkMany.mockResolvedValue(new Map([[66, view]]));
      expect(await service.identifierCheckFor(item(), note)).toEqual(view);
      expect(identifierCheck.checkMany).toHaveBeenCalledWith([
        { analysisId: 66, incidentId: '7732523858', suggestedFix: 'process.env.FRONTEND_URL', relatedFiles: ['backend/src/main.ts'], toolCalls: null, noteCodePath: 'backend/src/main.ts', noteCodeRef: '00107b7' },
      ]);
    });

    it('identifierCheckFor — project 가 없으면 메모의 project 로 정규화 · 메모 없으면 코드 경로 null · parse_failed 는 null', async () => {
      identifierCheck.checkMany.mockResolvedValue(new Map());
      expect(await service.identifierCheckFor(item({ project: null }), note)).toBeNull();
      expect(identifierCheck.checkMany.mock.calls[0][0][0]).toMatchObject({ relatedFiles: ['backend/src/main.ts'], noteCodePath: 'backend/src/main.ts' });
      await service.identifierCheckFor(item({ project: null }), null);
      // 힌트가 전혀 없으면 `./` 만 뗀다(blindResult 규칙)
      expect(identifierCheck.checkMany.mock.calls[1][0][0]).toMatchObject({ relatedFiles: ['src/main.ts'], noteCodePath: null, noteCodeRef: null });
      identifierCheck.checkMany.mockClear();
      expect(await service.identifierCheckFor(item({ status: 'parse_failed', result: null }), note)).toBeNull();
      expect(identifierCheck.checkMany).not.toHaveBeenCalled();
    });

    it('summarizeReviews — 승인/반려/평균 별점, mine 은 안내 채점 행 우선 · 채점 없으면 0 과 null', async () => {
      reviews.find.mockResolvedValue([
        { reviewerId: 42, verdict: 'approved', rating: 4, guided: false },
        { reviewerId: 42, verdict: 'rejected', rating: 2, guided: true },
        { reviewerId: 7, verdict: 'approved', rating: null, guided: true },
      ]);
      expect(await service.summarizeReviews(66, 42)).toEqual({
        reviews: 3, approved: 2, rejected: 1, avgRating: 3,
        mine: { verdict: 'rejected', rating: 2, guided: true },
      });
      expect(reviews.find).toHaveBeenCalledWith({ where: { analysisId: 66 } });
      expect((await service.summarizeReviews(66, 99)).mine).toBeNull();

      reviews.find.mockResolvedValue([]);
      expect(await service.summarizeReviews(66, 42)).toEqual({ reviews: 0, approved: 0, rejected: 0, avgRating: null, mine: null });
    });
  });

  describe('selectFewShot — 승인된 예시 선정', () => {
    it('대상 인시던트를 제외하고 N개를 별점순으로 고른다(SQL 인자 고정) · 메모 표는 읽지 않는다', async () => {
      analyses.query.mockResolvedValue([
        { id: 4, incident_title: 'T', exception_text: 'E', result_json: { severity: 'low' } },
      ]);

      const examples = await service.selectFewShot('7732523858');

      expect(examples).toEqual([{ analysisId: 4, incidentTitle: 'T', exceptionText: 'E', result: { severity: 'low' } }]);
      const [sql, params] = analyses.query.mock.calls[0];
      expect(sql).toMatch(/verdict = 'approved'/);
      expect(sql).toMatch(/incident_id <> \$1/);
      expect(sql).toMatch(/ORDER BY MAX\(r\.rating\) DESC NULLS LAST/);
      expect(sql).not.toMatch(/ops_incident_notes/);
      expect(params).toEqual(['7732523858', OpsReviewService.FEW_SHOT_N]);
    });

    it('n=0 이면 DB 를 부르지 않는다', async () => {
      expect(await service.selectFewShot('1', 0)).toEqual([]);
      expect(analyses.query).not.toHaveBeenCalled();
    });
  });
});
