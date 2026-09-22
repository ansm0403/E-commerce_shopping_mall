import { Test } from '@nestjs/testing';
import { IdentifierCheckService, type IdentifierCheckInput } from './identifier-check.service';
import { SourceReaderService } from './source-reader.service';

/**
 * IdentifierCheckService 단위 테스트 — 인시던트 단위 파일 합집합(블라인드) · ref 선택 · 파일 캐시 · 실패 격리 · "이름 없으면 안 읽는다".
 * 대조 규칙 자체는 identifier-check.spec.ts 가 고정한다.
 */
describe('IdentifierCheckService — 이름 대조 칩의 I/O(설계 §9 Phase 8 A)', () => {
  let service: IdentifierCheckService;
  let reader: { readFile: jest.Mock; isEnabled: jest.Mock; getDefaultRef: jest.Mock };

  const SOURCES: Record<string, string> = {
    'backend/src/main.ts': "const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(','); // FRONTEND_URL 은 주석에만\napp.enableCors({ origin: (origin, cb) => cb(null, true) });",
    'frontend/src/components/home/ProductSection.tsx': 'const products = result?.data ?? [];\nproducts.map((product) => <ProductCard key={product.id} product={product} />);',
  };

  const input = (over: Partial<IdentifierCheckInput> = {}): IdentifierCheckInput => ({
    analysisId: 66,
    incidentId: '7732523858',
    suggestedFix: '```ts\napp.enableCors({ origin: (origin, callback) => { const allowedOrigins = [process.env.FRONTEND_URL]; callback(null, true); } });\n```',
    relatedFiles: ['backend/src/main.ts'],
    toolCalls: null,
    noteCodePath: 'backend/src/main.ts',
    noteCodeRef: '00107b7',
    ...over,
  });

  beforeEach(async () => {
    reader = {
      readFile: jest.fn(async (p: string, ref: string) =>
        SOURCES[p] ? { ok: true, path: p, ref, text: SOURCES[p] } : { ok: false, path: p, ref, reason: '파일이 없다' },
      ),
      isEnabled: jest.fn().mockReturnValue(true),
      getDefaultRef: jest.fn().mockReturnValue('main'),
    };
    const module = await Test.createTestingModule({
      providers: [IdentifierCheckService, { provide: SourceReaderService, useValue: reader }],
    }).compile();
    service = module.get(IdentifierCheckService);
  });

  it('#66 꼴: 메모 코드 파일을 읽어 FRONTEND_URL 을 unknown 으로, checkedFiles 는 `경로@짧은ref`', async () => {
    const out = await service.checkMany([input()]);
    expect(out.get(66)).toEqual({ checkedFiles: ['backend/src/main.ts@00107b7'], checkedCount: 3, unknown: ['FRONTEND_URL'], maybeLibrary: [] });
    expect(reader.readFile).toHaveBeenCalledWith('backend/src/main.ts', '00107b7');
  });

  it('같은 인시던트의 두 팔은 relatedFiles 가 달라도 **같은 파일 집합**으로 대조된다(블라인드) · 파일은 한 번만 읽는다', async () => {
    const v11 = input({ analysisId: 66, relatedFiles: ['backend/src/main.ts'], noteCodePath: null, noteCodeRef: null });
    const v31 = input({
      analysisId: 67,
      suggestedFix: '```ts\nreturn cb(new ForbiddenException(\'x\'));\n```',
      relatedFiles: ['backend/src/main.ts', 'frontend/src/components/home/ProductSection.tsx'],
      toolCalls: [{ path: 'backend/src/main.ts', ref: '00107b7', startLine: 50, endLine: 70, ok: true, lines: 21 }],
      noteCodePath: null,
      noteCodeRef: null,
    });
    const out = await service.checkMany([v11, v31]);
    const files = ['backend/src/main.ts@00107b7', 'frontend/src/components/home/ProductSection.tsx@00107b7'];
    expect(out.get(66)?.checkedFiles).toEqual(files);
    expect(out.get(67)?.checkedFiles).toEqual(files);
    expect(out.get(67)).toMatchObject({ unknown: [], maybeLibrary: ['ForbiddenException'] });
    // ref 는 메모가 없으니 tool_calls 의 첫 성공 ref · 두 파일 각 1회
    expect(reader.readFile).toHaveBeenCalledTimes(2);
    expect(reader.readFile.mock.calls.every((c) => c[1] === '00107b7')).toBe(true);
  });

  it('조치에 대조할 이름이 없으면 파일을 읽지 않고 checkedCount 0 (e2e 픽스처 "조치 없음")', async () => {
    const out = await service.checkMany([input({ analysisId: 1, suggestedFix: '조치 없음' })]);
    expect(out.get(1)).toEqual({ checkedFiles: [], checkedCount: 0, unknown: [], maybeLibrary: [] });
    expect(reader.readFile).not.toHaveBeenCalled();
  });

  it('같은 인시던트의 다른 카드가 파일을 읽었으면, 이름 없는 카드도 같은 checkedFiles 를 받는다(#54 v1.1 은 이름 0 · #55 v3.1 은 1 — 파일 수가 팔을 드러내지 않게)', async () => {
    const out = await service.checkMany([
      input({ analysisId: 54, suggestedFix: '```\nconst f = (nodes) => nodes;\n```' }),
      input({ analysisId: 55, suggestedFix: '```\nallowedOrigins.includes(origin)\n```' }),
    ]);
    expect(out.get(54)).toEqual({ checkedFiles: ['backend/src/main.ts@00107b7'], checkedCount: 0, unknown: [], maybeLibrary: [] });
    expect(out.get(55)).toMatchObject({ checkedFiles: ['backend/src/main.ts@00107b7'], checkedCount: 2, unknown: [] });
  });

  it('읽을 수 있는 파일이 하나도 없으면 null("대조할 코드 없음") — 던지지 않는다', async () => {
    const out = await service.checkMany([input({ analysisId: 2, relatedFiles: ['frontend/src/nope.ts', '../node_modules/x.js'], noteCodePath: null, noteCodeRef: null })]);
    expect(out.get(2)).toBeNull();
    // `../` 는 checkPath 가 거절해 읽기 시도도 없다
    expect(reader.readFile).toHaveBeenCalledTimes(1);
  });

  it('readFile 이 던져도 그 파일만 빠진다', async () => {
    reader.readFile.mockRejectedValueOnce(new Error('boom'));
    const out = await service.checkMany([input({ analysisId: 3, relatedFiles: ['frontend/src/components/home/ProductSection.tsx'] })]);
    // 첫 호출(main.ts)이 실패 → ProductSection 만 대조됐다
    expect(out.get(3)?.checkedFiles).toEqual(['frontend/src/components/home/ProductSection.tsx@00107b7']);
  });

  it('리더가 비활성(OPS_SOURCE_READ_ENABLED=false)이면 읽지 않고 null', async () => {
    reader.isEnabled.mockReturnValue(false);
    const out = await service.checkMany([input()]);
    expect(out.get(66)).toBeNull();
    expect(reader.readFile).not.toHaveBeenCalled();
  });

  describe('pickRef / pickFiles', () => {
    it('ref: 메모 코드 ref → tool_calls 첫 성공 ref → 기본 브랜치', () => {
      expect(IdentifierCheckService.pickRef([input()], 'main')).toBe('00107b7');
      expect(
        IdentifierCheckService.pickRef(
          [input({ noteCodeRef: null, toolCalls: [{ path: 'a', ref: 'bad', startLine: null, endLine: null, ok: false, reason: 'x' }, { path: 'b', ref: '7e3784f', startLine: 1, endLine: 2, ok: true }] })],
          'main',
        ),
      ).toBe('7e3784f');
      expect(IdentifierCheckService.pickRef([input({ noteCodeRef: null, toolCalls: [] })], 'main')).toBe('main');
    });

    it('files: 메모 코드 파일 먼저 · 줄 번호 접미 제거 · 허용 폴더 밖·중복 제외 · 상한 6', () => {
      const files = IdentifierCheckService.pickFiles([
        input({ noteCodePath: 'frontend/src/hooks/useCategories.ts', relatedFiles: ['backend/src/main.ts:65', 'frontend/src/hooks/useCategories.ts', '../node_modules/x.js', '/etc/passwd', 'backend/.env'] }),
        input({ noteCodePath: null, relatedFiles: ['frontend/src/a.ts', 'frontend/src/b.ts', 'frontend/src/c.ts', 'frontend/src/d.ts', 'frontend/src/e.ts'] }),
      ]);
      expect(files).toEqual(['frontend/src/hooks/useCategories.ts', 'backend/src/main.ts', 'frontend/src/a.ts', 'frontend/src/b.ts', 'frontend/src/c.ts', 'frontend/src/d.ts']);
    });
  });
});
