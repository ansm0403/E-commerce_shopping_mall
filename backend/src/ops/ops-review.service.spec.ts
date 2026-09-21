import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OpsReviewService } from './ops-review.service';
import { OpsAnalysisEntity } from './entity/ops-analysis.entity';
import { OpsReviewEntity } from './entity/ops-review.entity';

/**
 * OpsReviewService 단위 테스트 — upsert 규칙 · 입력 검증 · 응답 변환 · SQL 결과 매핑.
 * SQL 문 자체(NOT EXISTS · FILTER · GROUP BY)는 e2e F 절이 실 DB 로 고정한다.
 */
describe('OpsReviewService — 평가 루프(설계 §9 Phase 4)', () => {
  let service: OpsReviewService;
  let reviews: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let analyses: { findOne: jest.Mock; query: jest.Mock };

  const okAnalysis = (over: Partial<OpsAnalysisEntity> = {}): Partial<OpsAnalysisEntity> => ({
    id: 7,
    incidentId: '7732523858',
    status: 'ok',
    model: 'gemini-3.1-flash-lite',
    resultJson: { severity: 'high', rootCause: 'x', suggestedFix: 'y', relatedFiles: [], confidence: 'medium' },
    ...over,
  });

  beforeEach(async () => {
    let nextId = 100;
    reviews = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: Partial<OpsReviewEntity>) => ({ ...v })),
      save: jest.fn(async (v: Partial<OpsReviewEntity>) => ({
        id: v.id ?? nextId++,
        createdAt: new Date('2026-09-21T10:00:00Z'),
        updatedAt: new Date('2026-09-21T10:00:00Z'),
        ...v,
      })),
    };
    analyses = { findOne: jest.fn().mockResolvedValue(okAnalysis()), query: jest.fn().mockResolvedValue([]) };

    const module = await Test.createTestingModule({
      providers: [
        OpsReviewService,
        { provide: getRepositoryToken(OpsReviewEntity), useValue: reviews },
        { provide: getRepositoryToken(OpsAnalysisEntity), useValue: analyses },
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

    it('첫 평가 → 새 행(created=true), rating·comment 없으면 null, comment 는 trim', async () => {
      const { item, created } = await service.submitReview(42, 7, { verdict: 'approved', comment: '  좋음  ' });

      expect(created).toBe(true);
      expect(reviews.create).toHaveBeenCalledWith({ analysisId: 7, reviewerId: 42 });
      expect(reviews.save).toHaveBeenCalledWith(
        expect.objectContaining({ analysisId: 7, reviewerId: 42, verdict: 'approved', rating: null, comment: '좋음' }),
      );
      expect(item).toEqual({
        id: 100,
        analysisId: 7,
        reviewerId: 42,
        verdict: 'approved',
        rating: null,
        comment: '좋음',
        createdAt: '2026-09-21T10:00:00.000Z',
        updatedAt: '2026-09-21T10:00:00.000Z',
      });
    });

    it('같은 평가자의 재평가 → 기존 행을 통째로 덮어쓴다(created=false, 안 보낸 rating 은 null 로)', async () => {
      reviews.findOne.mockResolvedValue({ id: 5, analysisId: 7, reviewerId: 42, verdict: 'approved', rating: 5, comment: '좋음' });

      const { item, created } = await service.submitReview(42, 7, { verdict: 'rejected' });

      expect(created).toBe(false);
      expect(reviews.create).not.toHaveBeenCalled();
      expect(reviews.save).toHaveBeenCalledWith(expect.objectContaining({ id: 5, verdict: 'rejected', rating: null, comment: null }));
      expect(item.id).toBe(5);
      expect(item.verdict).toBe('rejected');
    });

    it('동시 저장으로 유니크 위반(23505)이 나면 그 사이 생긴 행에 덮어쓴다', async () => {
      reviews.save
        .mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))
        .mockImplementationOnce(async (v: Partial<OpsReviewEntity>) => ({ ...v, createdAt: new Date(0), updatedAt: new Date(0) }));
      reviews.findOne
        .mockResolvedValueOnce(null) // 첫 조회: 없음 → create
        .mockResolvedValueOnce({ id: 9, analysisId: 7, reviewerId: 42, verdict: 'approved', rating: 3, comment: null }); // 충돌 후 재조회

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
    it('SQL 결과를 카드 항목으로 매핑하고, promptVersion 은 응답에 없다', async () => {
      analyses.query.mockResolvedValue([
        {
          id: 7,
          incident_id: '7732523858',
          incident_title: 'AxiosError: Network Error',
          exception_text: 'AxiosError: Network Error',
          result_json: { severity: 'high', rootCause: 'x', suggestedFix: 'y', relatedFiles: [], confidence: 'medium' },
          model: 'gemini-3.1-flash-lite',
          createdAt: new Date('2026-09-21T09:00:00Z'),
        },
      ]);

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
        },
      ]);
      expect(Object.keys(items[0])).not.toContain('promptVersion');

      // 평가자 id 는 NOT EXISTS(정수) 와 md5 셔플(문자열) 두 자리에 각각 들어간다
      const [sql, params] = analyses.query.mock.calls[0];
      expect(sql).toMatch(/NOT EXISTS/);
      expect(sql).toMatch(/md5\(/);
      expect(sql).toMatch(/simulated/);
      expect(params).toEqual([42, '42', OpsReviewService.PENDING_LIMIT]);
    });
  });

  describe('getStats — 버전별 승인율', () => {
    it('approved/(approved+rejected) 로 승인율, 평가 없으면 null, 소수 셋째 자리 반올림', async () => {
      analyses.query.mockResolvedValue([
        { prompt_version: 'v1', analyses: 6, ok: 5, parse_failed: 1, reviews: 3, approved: 1, rejected: 2, avg_rating: 2.3333 },
        { prompt_version: 'v2', analyses: 6, ok: 6, parse_failed: 0, reviews: 0, approved: 0, rejected: 0, avg_rating: null },
      ]);

      const { versions, generatedAt } = await service.getStats();

      expect(versions).toEqual([
        {
          promptVersion: 'v1', analyses: 6, ok: 5, parseFailed: 1, parseFailedRate: 0.167,
          reviews: 3, approved: 1, rejected: 2, approvalRate: 0.333, avgRating: 2.333,
        },
        {
          promptVersion: 'v2', analyses: 6, ok: 6, parseFailed: 0, parseFailedRate: 0,
          reviews: 0, approved: 0, rejected: 0, approvalRate: null, avgRating: null,
        },
      ]);
      expect(new Date(generatedAt).getTime()).not.toBeNaN();
      expect(analyses.query.mock.calls[0][0]).toMatch(/simulated/);
    });
  });

  describe('selectFewShot — 승인된 예시 선정', () => {
    it('대상 인시던트를 제외하고 N개를 별점순으로 고른다(SQL 인자 고정)', async () => {
      analyses.query.mockResolvedValue([
        { id: 4, incident_title: 'T', exception_text: 'E', result_json: { severity: 'low' } },
      ]);

      const examples = await service.selectFewShot('7732523858');

      expect(examples).toEqual([{ analysisId: 4, incidentTitle: 'T', exceptionText: 'E', result: { severity: 'low' } }]);
      const [sql, params] = analyses.query.mock.calls[0];
      expect(sql).toMatch(/verdict = 'approved'/);
      expect(sql).toMatch(/incident_id <> \$1/);
      expect(sql).toMatch(/ORDER BY MAX\(r\.rating\) DESC NULLS LAST/);
      expect(params).toEqual(['7732523858', OpsReviewService.FEW_SHOT_N]);
    });

    it('n=0 이면 DB 를 부르지 않는다', async () => {
      expect(await service.selectFewShot('1', 0)).toEqual([]);
      expect(analyses.query).not.toHaveBeenCalled();
    });
  });
});
