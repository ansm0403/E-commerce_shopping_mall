import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OpsAnalysisService } from './ops-analysis.service';
import { OpsService } from './ops.service';
import { RedisService } from '../intrastructure/redis/redis.service';
import { LLM_CLIENT } from '../intrastructure/ai/ai.constants';
import { OpsAnalysisEntity } from './entity/ops-analysis.entity';
import { IncidentDetail } from './dto/incident-detail.dto';

/** GET /ops/incidents/:id 가 돌려주는 축약형 상세(2026-09-20 실측 형태) */
const incident = (over: Partial<IncidentDetail> = {}): IncidentDetail => ({
  id: '7742806116',
  title: 'AxiosError: Network Error',
  level: 'error',
  count: 3,
  lastSeen: '2026-09-21T02:00:00Z',
  firstSeen: '2026-09-20T23:00:00Z',
  culprit: 'GET /api/categories',
  project: 'e-commerse-frontend',
  status: 'unresolved',
  exception: {
    type: 'AxiosError',
    value: 'Network Error',
    frames: [
      { filename: 'src/lib/axios/axios-http-client.ts', function: 'onRejected', lineNo: 88, colNo: 12, inApp: true },
      { filename: 'node_modules/axios/lib/core/settle.js', function: 'settle', lineNo: 19, colNo: 3, inApp: false },
    ],
  },
  breadcrumbs: [
    { timestamp: '2026-09-21T01:59:58Z', category: 'navigation', level: 'info', message: '/ → /products' },
    { timestamp: '2026-09-21T01:59:59Z', category: 'xhr', level: 'error', message: 'GET /api/categories → 0' },
  ],
  ...over,
});

const VALID_JSON = JSON.stringify({
  severity: 'high',
  rootCause: '백엔드 응답 없이 연결이 끊겼다.',
  suggestedFix: '재시도 + 타임아웃:\n```ts\naxios.create({ timeout: 15_000 })\n```',
  relatedFiles: ['src/lib/axios/axios-http-client.ts'],
  confidence: 'medium',
});

describe('OpsAnalysisService — AI 분석 파이프라인(설계 §3.4)', () => {
  let service: OpsAnalysisService;
  let ops: { getIncident: jest.Mock };
  let redis: { checkRateLimit: jest.Mock; acquireLock: jest.Mock; releaseLock: jest.Mock };
  let llm: { isEnabled: jest.Mock; generate: jest.Mock };
  let repo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let env: Record<string, string | undefined>;

  const build = async () => {
    const module = await Test.createTestingModule({
      providers: [
        OpsAnalysisService,
        { provide: OpsService, useValue: ops },
        { provide: RedisService, useValue: redis },
        { provide: LLM_CLIENT, useValue: llm },
        { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
        { provide: getRepositoryToken(OpsAnalysisEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(OpsAnalysisService);
  };

  beforeEach(async () => {
    ops = { getIncident: jest.fn().mockResolvedValue({ item: incident(), cached: false }) };
    redis = {
      checkRateLimit: jest.fn().mockResolvedValue(true),
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    llm = { isEnabled: jest.fn().mockReturnValue(true), generate: jest.fn() };
    let nextId = 1;
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: Partial<OpsAnalysisEntity>) => v),
      // save 는 DB 가 채워 주는 id/createdAt 을 흉내 낸다
      save: jest.fn(async (v: Partial<OpsAnalysisEntity>) => ({ ...v, id: nextId++, createdAt: new Date('2026-09-21T03:00:00Z') })),
    };
    env = { GEMINI_MODEL: 'gemini-3.1-flash-lite' };
    await build();
  });

  it('LLM 키 없음(비활성) → 503, Sentry 도 LLM 도 부르지 않는다', async () => {
    llm.isEnabled.mockReturnValue(false);
    await expect(service.analyze('7742806116')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(ops.getIncident).not.toHaveBeenCalled();
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('없는 인시던트 → getIncident 의 404 가 그대로 올라온다(분석 행도 만들지 않는다)', async () => {
    ops.getIncident.mockRejectedValue(new NotFoundException());
    await expect(service.analyze('999')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('첫 응답이 스키마를 지키면 1회 호출로 ok 저장 — 응답에는 result 가 있고 rawText 는 null', async () => {
    llm.generate.mockResolvedValueOnce(VALID_JSON);

    const { item, cached } = await service.analyze('7742806116');

    expect(cached).toBe(false);
    expect(llm.generate).toHaveBeenCalledTimes(1);
    expect(item).toMatchObject({
      id: 1,
      incidentId: '7742806116',
      status: 'ok',
      result: { severity: 'high', confidence: 'medium', relatedFiles: ['src/lib/axios/axios-http-client.ts'] },
      rawText: null,
      promptVersion: 'v1',
      model: 'gemini-3.1-flash-lite',
      createdAt: '2026-09-21T03:00:00.000Z',
    });
    expect(typeof item.latencyMs).toBe('number');
    // ⚠ promptVersion 은 반드시 저장된다(Phase 4 의 비교 축)
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ promptVersion: 'v1', status: 'ok' }));
  });

  it('프롬프트: system 은 스키마 지시, user 는 인시던트 데이터(inApp 표식·breadcrumb 포함)', async () => {
    llm.generate.mockResolvedValueOnce(VALID_JSON);
    await service.analyze('7742806116');

    const [{ system, messages }] = llm.generate.mock.calls[0];
    expect(system.static).toContain('"severity":"critical"|"high"|"medium"|"low"');
    expect(system.static).toContain('코드펜스');
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('AxiosError: Network Error');
    expect(messages[0].content).toContain('[app] onRejected — src/lib/axios/axios-http-client.ts:88:12');
    expect(messages[0].content).toContain('GET /api/categories → 0');
  });

  it('프롬프트에 넣기 전 제목·culprit 의 이메일·전화를 마스킹한다(무료티어 입력은 학습에 쓰일 수 있다)', async () => {
    ops.getIncident.mockResolvedValue({
      item: incident({ title: 'Error: user kim.shop@example.com not found', culprit: 'call 010-1234-5678' }),
      cached: false,
    });
    llm.generate.mockResolvedValueOnce(VALID_JSON);
    await service.analyze('7742806116');

    const content: string = llm.generate.mock.calls[0][0].messages[0].content;
    expect(content).not.toContain('kim.shop@example.com');
    expect(content).toContain('k***@***');
    expect(content).not.toContain('010-1234-5678');
  });

  it('첫 응답이 스키마를 어기면 사유를 실어 1회 재시도하고, 두 번째가 맞으면 ok 로 저장한다', async () => {
    llm.generate
      .mockResolvedValueOnce('원인은 네트워크 문제로 보입니다. 재시도를 권합니다.')
      .mockResolvedValueOnce('```json\n' + VALID_JSON + '\n```');

    const { item } = await service.analyze('7742806116');

    expect(item.status).toBe('ok');
    expect(llm.generate).toHaveBeenCalledTimes(2);
    // 재시도는 "같은 질문 반복"이 아니다 — 틀린 응답 + 위반 사유 + 교정 요청이 대화에 얹힌다
    const second = llm.generate.mock.calls[1][0].messages;
    expect(second).toHaveLength(3);
    expect(second[1]).toEqual({ role: 'assistant', content: '원인은 네트워크 문제로 보입니다. 재시도를 권합니다.' });
    expect(second[2].role).toBe('user');
    expect(second[2].content).toContain('JSON 객체를 찾을 수 없다');
  });

  it('재시도 후에도 어기면 parse_failed 로 저장 — result 는 null, rawText 에 마지막 원문(마스킹)', async () => {
    llm.generate
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce('still not json — contact kim.shop@example.com');

    const { item } = await service.analyze('7742806116');

    expect(llm.generate).toHaveBeenCalledTimes(2);
    expect(item.status).toBe('parse_failed');
    expect(item.result).toBeNull();
    expect(item.rawText).toBe('still not json — contact k***@***');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'parse_failed', resultJson: null, promptVersion: 'v1' }),
    );
  });

  it('LLM 자체가 throw 하면(타임아웃·429 등) 행을 만들지 않고 락만 풀고 에러를 올린다', async () => {
    llm.generate.mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED'));
    await expect(service.analyze('7742806116')).rejects.toThrow('429 RESOURCE_EXHAUSTED');
    expect(repo.save).not.toHaveBeenCalled();
    expect(redis.releaseLock).toHaveBeenCalledWith('ops:analysis:7742806116');
  });

  it('최근 행이 있으면(force 아님) LLM 을 부르지 않고 그 행을 준다 — parse_failed 도 그대로(몰래 재시도 금지)', async () => {
    repo.findOne.mockResolvedValue({
      id: 7,
      incidentId: '7742806116',
      status: 'parse_failed',
      resultJson: null,
      rawText: '원문',
      promptVersion: 'v1',
      model: 'gemini-3.1-flash-lite',
      latencyMs: 1234,
      createdAt: new Date('2026-09-21T02:30:00Z'),
    });

    const { item, cached } = await service.analyze('7742806116');

    expect(cached).toBe(true);
    expect(item).toMatchObject({ id: 7, status: 'parse_failed', rawText: '원문', result: null });
    expect(llm.generate).not.toHaveBeenCalled();
    expect(redis.checkRateLimit).not.toHaveBeenCalled();
    expect(repo.findOne).toHaveBeenCalledWith({ where: { incidentId: '7742806116' }, order: { createdAt: 'DESC' } });
  });

  it('force=true 면 최근 행이 있어도 새로 분석한다(앱의 "다시 분석")', async () => {
    repo.findOne.mockResolvedValue({ id: 7, status: 'ok' });
    llm.generate.mockResolvedValueOnce(VALID_JSON);

    const { item, cached } = await service.analyze('7742806116', { force: true });

    expect(cached).toBe(false);
    expect(item.id).toBe(1);
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  it('분당 상한 초과 → 429, LLM 을 부르지 않는다(무료티어 RPM 15 방어)', async () => {
    redis.checkRateLimit.mockResolvedValue(false);
    const err = await service.analyze('7742806116').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(redis.checkRateLimit).toHaveBeenCalledWith('ops:analysis:llm', 5, 60);
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('OPS_ANALYSIS_MAX_PER_MIN 으로 상한을 바꿀 수 있다', async () => {
    env.OPS_ANALYSIS_MAX_PER_MIN = '2';
    await build();
    llm.generate.mockResolvedValueOnce(VALID_JSON);
    await service.analyze('7742806116');
    expect(redis.checkRateLimit).toHaveBeenCalledWith('ops:analysis:llm', 2, 60);
  });

  it('같은 인시던트가 이미 분석 중(락 실패) → 409', async () => {
    redis.acquireLock.mockResolvedValue(false);
    await expect(service.analyze('7742806116')).rejects.toBeInstanceOf(ConflictException);
    expect(llm.generate).not.toHaveBeenCalled();
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });

  describe('강제 실패 시뮬레이션(DoD "AI 가 스키마를 어겨도 앱이 깨지지 않는다" 검증용)', () => {
    it('비운영에서 simulate=parse_failed 면 LLM 없이 parse_failed 행을 만든다(최근 행이 있어도 — force 와 같다)', async () => {
      repo.findOne.mockResolvedValue({ id: 7, status: 'ok' });
      const { item, cached } = await service.analyze('7742806116', { simulate: 'parse_failed' });

      expect(cached).toBe(false);
      expect(item.status).toBe('parse_failed');
      expect(item.model).toBe('simulated');
      expect(item.rawText).toContain('[simulated parse_failed]');
      expect(llm.generate).not.toHaveBeenCalled();
      expect(redis.checkRateLimit).not.toHaveBeenCalled();
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('운영(NODE_ENV=production)에서는 무시되고 정상 경로로 간다 — 운영 DB 에 가짜 실패를 남기지 않는다', async () => {
      env.NODE_ENV = 'production';
      await build();
      llm.generate.mockResolvedValueOnce(VALID_JSON);

      const { item } = await service.analyze('7742806116', { simulate: 'parse_failed' });

      expect(item.status).toBe('ok');
      expect(llm.generate).toHaveBeenCalledTimes(1);
    });
  });
});
