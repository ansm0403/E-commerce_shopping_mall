import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { OpsNoteService } from './ops-note.service';
import { OpsIncidentNoteEntity } from './entity/ops-incident-note.entity';
import { SourceReaderService } from './source-reader.service';
import { OpsAnalysisService } from './ops-analysis.service';
import { OpsReviewService } from './ops-review.service';

/**
 * OpsNoteService 단위 테스트(Phase 7) — 코드 읽기 → 저장 순서 · 실패 시 저장 안 함 · PUT 의미(통째 덮어쓰기) · 마스킹.
 * 마지막 describe 는 "메모가 LLM 입력에 들어가지 않는다"를 **의존성 그래프와 SQL 문자열**로 고정한다(인수인계 함정 5).
 */
describe('OpsNoteService — 인시던트별 사실 메모(설계 §9 Phase 7)', () => {
  let service: OpsNoteService;
  let notes: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let reader: { read: jest.Mock; getDefaultRef: jest.Mock };

  const body = {
    symptom: '카테고리 응답이 배열이 아닌 객체였다',
    causeLocation: 'frontend/src/hooks/useCategories.ts flattenTree 의 for…of',
    fixDirection: 'Array.isArray 가드',
    commonMistakes: 'reduce 로 다시 쓴 가짜 코드',
    project: 'e-commerse-frontend',
  };

  beforeEach(async () => {
    notes = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: Partial<OpsIncidentNoteEntity>) => ({ ...v })),
      save: jest.fn(async (v: Partial<OpsIncidentNoteEntity>) => ({
        id: v.id ?? 1,
        createdAt: new Date('2026-09-22T10:00:00Z'),
        updatedAt: new Date('2026-09-22T10:00:00Z'),
        ...v,
      })),
    };
    reader = {
      read: jest.fn().mockResolvedValue({
        ok: true,
        path: 'frontend/src/hooks/useCategories.ts',
        ref: '7e3784f',
        startLine: 8,
        endLine: 19,
        totalLines: 28,
        content: ' 8| function flattenTree(nodes) {\n 9|   for (const node of nodes) {',
      }),
      getDefaultRef: jest.fn().mockReturnValue('main'),
    };

    const module = await Test.createTestingModule({
      providers: [
        OpsNoteService,
        { provide: getRepositoryToken(OpsIncidentNoteEntity), useValue: notes },
        { provide: SourceReaderService, useValue: reader },
      ],
    }).compile();
    service = module.get(OpsNoteService);
  });

  it('코드 범위가 있으면 먼저 읽고(ref 는 body 의 것), 읽은 그대로 code_* 에 저장한다 — created=true, X-Note 판단용', async () => {
    const { item, created } = await service.upsert('7747401267', { ...body, code: { path: 'frontend/src/hooks/useCategories.ts', startLine: 8, endLine: 19, ref: '7e3784f' } }, 1);

    expect(created).toBe(true);
    expect(reader.read).toHaveBeenCalledWith({ path: 'frontend/src/hooks/useCategories.ts', startLine: 8, endLine: 19, ref: '7e3784f' });
    expect(notes.create).toHaveBeenCalledWith({ incidentId: '7747401267' });
    expect(notes.save).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: '7747401267',
        project: 'e-commerse-frontend',
        symptom: body.symptom,
        causeLocation: body.causeLocation,
        fixDirection: body.fixDirection,
        commonMistakes: body.commonMistakes,
        codePath: 'frontend/src/hooks/useCategories.ts',
        codeRef: '7e3784f',
        codeStartLine: 8,
        codeEndLine: 19,
        codeText: expect.stringContaining('flattenTree'),
        authorId: 1,
      }),
    );
    expect(item).toMatchObject({
      incidentId: '7747401267',
      code: { path: 'frontend/src/hooks/useCategories.ts', ref: '7e3784f', startLine: 8, endLine: 19 },
      updatedAt: '2026-09-22T10:00:00.000Z',
    });
  });

  it('ref 를 생략하면 리더의 기본 브랜치로 읽는다', async () => {
    await service.upsert('1', { ...body, code: { path: 'backend/src/main.ts', startLine: 50, endLine: 70 } }, null);
    expect(reader.read).toHaveBeenCalledWith(expect.objectContaining({ ref: 'main' }));
  });

  it('코드 읽기 실패 → 400, 아무것도 저장하지 않는다(반쯤 채운 메모 금지)', async () => {
    reader.read.mockResolvedValue({ ok: false, path: 'x', ref: 'main', reason: '파일이 없다(경로나 커밋을 확인하라)' });
    await expect(
      service.upsert('1', { ...body, code: { path: 'frontend/src/none.ts', startLine: 1, endLine: 2 } }, 1),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(notes.save).not.toHaveBeenCalled();
  });

  it('endLine < startLine 이면 읽기 전에 400 · 인시던트 id 꼴이 아니면 400', async () => {
    await expect(service.upsert('1', { ...body, code: { path: 'backend/src/main.ts', startLine: 9, endLine: 3 } }, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(reader.read).not.toHaveBeenCalled();
    await expect(service.upsert('bad id!', body, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('같은 인시던트에 다시 PUT → 기존 행을 통째로 덮어쓴다(created=false). code 를 빼면 code_* 는 null 로', async () => {
    notes.findOne.mockResolvedValue({
      id: 9, incidentId: '1', project: 'old', symptom: 'old', causeLocation: 'old', fixDirection: 'old', commonMistakes: 'old',
      codePath: 'backend/src/main.ts', codeRef: 'abc1234', codeStartLine: 1, codeEndLine: 2, codeText: '1| x', authorId: 5,
    });

    const { item, created } = await service.upsert('1', { symptom: 'new', causeLocation: 'new', fixDirection: 'new' }, 7);

    expect(created).toBe(false);
    expect(notes.create).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
    expect(notes.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 9, symptom: 'new', commonMistakes: null, project: null, codePath: null, codeRef: null, codeStartLine: null, codeEndLine: null, codeText: null, authorId: 7 }),
    );
    expect(item.code).toBeNull();
    expect(item.commonMistakes).toBeNull();
  });

  it('메모 본문은 scrubText 를 거친다(이메일 마스킹) · 앞뒤 공백 제거', async () => {
    await service.upsert('1', { ...body, symptom: '  someone@example.com 이 신고  ' }, null);
    const saved = notes.save.mock.calls[0][0] as OpsIncidentNoteEntity;
    expect(saved.symptom).not.toContain('someone@example.com');
    expect(saved.symptom).toBe(saved.symptom.trim());
  });

  it('findByIncident — 없으면 null, 있으면 카드용 뷰', async () => {
    expect(await service.findByIncident('none')).toBeNull();
    notes.findOne.mockResolvedValue({
      incidentId: '1', project: null, symptom: 's', causeLocation: 'c', fixDirection: 'f', commonMistakes: null,
      codePath: null, codeRef: null, codeStartLine: null, codeEndLine: null, codeText: null, updatedAt: new Date(0),
    });
    expect(await service.findByIncident('1')).toEqual({
      incidentId: '1', project: null, symptom: 's', causeLocation: 'c', fixDirection: 'f', commonMistakes: null, code: null,
      updatedAt: '1970-01-01T00:00:00.000Z',
    });
  });
});

describe('사실 메모는 LLM 입력에 들어가지 않는다(인수인계 함정 5)', () => {
  it('OpsAnalysisService 는 OpsNoteService·메모 엔티티를 주입받지 않는다', () => {
    const params: Array<{ name?: string } | undefined> = Reflect.getMetadata('design:paramtypes', OpsAnalysisService) ?? [];
    const names = params.map((p) => p?.name ?? String(p));
    expect(names).not.toContain('OpsNoteService');
    expect(names.some((n) => /IncidentNote/i.test(n))).toBe(false);
  });

  it('few-shot 선정 SQL 과 프롬프트 조립은 ops_incident_notes 를 읽지 않는다', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        OpsReviewService,
        { provide: getRepositoryToken(OpsIncidentNoteEntity), useValue: {} },
        { provide: getRepositoryToken((await import('./entity/ops-review.entity')).OpsReviewEntity), useValue: {} },
        { provide: getRepositoryToken((await import('./entity/ops-analysis.entity')).OpsAnalysisEntity), useValue: { query } },
        // Phase 8: 이름 대조 서비스도 메모를 읽지 않는다 — 여기서는 의존성만 채운다(대조 규칙은 identifier-check.spec 이 고정)
        { provide: (await import('./identifier-check.service')).IdentifierCheckService, useValue: { checkMany: jest.fn() } },
      ],
    }).compile();
    await module.get(OpsReviewService).selectFewShot('1');
    expect(query.mock.calls[0][0]).not.toMatch(/ops_incident_notes/);

    // 프롬프트 문자열 어디에도 메모 필드가 없다(정적 텍스트 + 인시던트 데이터만)
    const prompt = OpsAnalysisService.buildUserPrompt({
      id: '1', title: 't', level: 'error', status: 'unresolved', count: 1, firstSeen: '', lastSeen: '', culprit: null,
      project: 'e-commerse-frontend', release: null, firstRelease: null, exception: null, breadcrumbs: [], permalink: null,
    } as never);
    expect(prompt).not.toMatch(/사실 메모|원인 위치|흔한 오답|causeLocation|fixDirection/);
    expect(OpsAnalysisService.SYSTEM + OpsAnalysisService.SERVICE_MAP + OpsAnalysisService.TOOL_GUIDE).not.toMatch(/메모|note/i);
  });
});
