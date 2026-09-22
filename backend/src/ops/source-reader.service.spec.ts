import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SourceReaderService } from './source-reader.service';
import { RedisService } from '../intrastructure/redis/redis.service';

/** 200줄짜리 가짜 소스. 60번째 줄에 이메일이 있어 마스킹을 검증한다 */
const FILE = Array.from({ length: 200 }, (_, i) => (i === 59 ? `const owner = 'kim.shop@example.com'; // line ${i + 1}` : `line ${i + 1}`)).join('\n');

const response = (status: number, body = '', headers: Record<string, string> = {}): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  }) as unknown as Response;

describe('SourceReaderService — read_source 도구의 실행부(설계 §9 Phase 5 결정 ③·④)', () => {
  let service: SourceReaderService;
  let redis: { getCache: jest.Mock; setCache: jest.Mock };
  let env: Record<string, string | undefined>;
  let fetchMock: jest.Mock;

  const build = async () => {
    const module = await Test.createTestingModule({
      providers: [
        SourceReaderService,
        { provide: RedisService, useValue: redis },
        { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
      ],
    }).compile();
    service = module.get(SourceReaderService);
  };

  beforeEach(async () => {
    env = {};
    redis = { getCache: jest.fn().mockResolvedValue(null), setCache: jest.fn().mockResolvedValue(undefined) };
    fetchMock = jest.fn().mockResolvedValue(response(200, FILE));
    global.fetch = fetchMock as unknown as typeof fetch;
    await build();
  });

  describe('normalizeFramePath — Sentry 프레임 → 저장소 경로', () => {
    it.each([
      ['webpack://shopping-mall/backend/src/main.ts', 'backend/src/main.ts'],
      ['webpack://@shopping-mall/backend/./src/ops/ops.service.ts', null], // ./ 세그먼트는 거절(Node 가 정규화한 꼴만 읽는다)
      ['app:///ops-companion/app/(tabs)/profile.tsx', 'ops-companion/app/(tabs)/profile.tsx'],
      ['/ops-companion/src/lib/sentry.ts', 'ops-companion/src/lib/sentry.ts'],
      ['C:\\Users\\kiria\\Desktop\\fullstack\\shopping_mall\\backend\\src\\ops\\ops.service.ts', 'backend/src/ops/ops.service.ts'],
      ['backend/src/main.ts', 'backend/src/main.ts'],
      ['/app/backend/dist/main.js', null], // 소스맵 없는 옛 운영 이벤트 — 번들 좌표
      ['app:///_next/static/chunks/8577-a802262ffa48f8c4.js', null], // 프론트 — 소스맵 미업로드
      ['/app/node_modules/cors/lib/index.js', null],
      ['webpack://shopping-mall/backend/src/.env.local', null], // 허용 폴더 안이어도 비밀값 파일
      ['', null],
      [null, null],
    ])('%s → %s', (input, expected) => {
      expect(SourceReaderService.normalizeFramePath(input)).toBe(expected);
    });

    // Phase 6 — 프론트(Vercel 소스맵 업로드 후)의 실이벤트 꼴(2026-09-22, 이슈 7747401267):
    //   inApp  filename=./src/hooks/useCategories.ts  absPath=app:///_next/static/chunks/app/(main)/src/hooks/useCategories.ts
    //   lib    filename=../node_modules/axios/dist/browser/axios.cjs
    // 빌드 cwd 가 frontend/ 라 저장소 폴더 이름이 없다 → project slug 를 힌트로 붙인다.
    it.each([
      ['./src/hooks/useCategories.ts', 'e-commerse-frontend', 'frontend/src/hooks/useCategories.ts'],
      ['./src/components/common/SearchBar/CategorySelect.tsx', 'e-commerse-frontend', 'frontend/src/components/common/SearchBar/CategorySelect.tsx'],
      ['src/lib/axios/axios-http-client.ts', 'e-commerse-frontend', 'frontend/src/lib/axios/axios-http-client.ts'],
      ['../node_modules/axios/dist/browser/axios.cjs', 'e-commerse-frontend', null], // 라이브러리 — .. 거절
      ['./src/../.env.local', 'e-commerse-frontend', null], // .. 세그먼트
      ['./.env.local', 'e-commerse-frontend', null], // 허용 폴더(src/) 밖
      ['app:///_next/static/chunks/8577-a802262ffa48f8c4.js', 'e-commerse-frontend', null], // 소스맵 이전 이벤트는 여전히 null
      ['./src/hooks/useCategories.ts', null, null], // 힌트 없으면 폴더를 특정할 수 없다
      ['./src/hooks/useCategories.ts', 'unknown-project', null],
      ['./src/main.ts', 'e-commerse-backend', 'backend/src/main.ts'],
      ['webpack://shopping-mall/backend/src/main.ts', 'e-commerse-frontend', 'backend/src/main.ts'], // 폴더 이름이 있으면 힌트보다 우선
      ['app:///ops-companion/app/(tabs)/profile.tsx', 'ops-companion', 'ops-companion/app/(tabs)/profile.tsx'],
    ])('%s (project=%s) → %s', (input, project, expected) => {
      expect(SourceReaderService.normalizeFramePath(input, project)).toBe(expected);
    });
  });

  describe('checkPath — fetch 전에 거절하는 것', () => {
    it.each([
      ['backend/src/../../.env', '..'],
      ['/backend/src/main.ts', '상대경로'],
      ['https://evil.example/x', '상대경로'],
      ['backend/src/config/.env.production', '비밀값'],
      ['backend/src/certs/server.pem', '비밀값'],
      ['ops-companion/app/google-services.json', '비밀값'],
      ['backend/src/shop-firebase-adminsdk-abc.json', '비밀값'],
      ['README.md', '읽을 수 있는 폴더'],
      ['backend/Dockerfile', '읽을 수 있는 폴더'],
      ['backend/src//main.ts', '빈 세그먼트'],
      ['backend\\src\\main.ts', '허용되지 않는 문자'],
      ['', '비어 있지'],
      [42, '비어 있지'],
    ])('%s 는 거절(%s)', (input, reason) => {
      const r = SourceReaderService.checkPath(input);
      expect(r.ok).toBe(false);
      expect((r as { reason: string }).reason).toContain(reason);
    });

    it('허용 경로는 통과한다', () => {
      expect(SourceReaderService.checkPath('backend/src/main.ts')).toEqual({ ok: true, path: 'backend/src/main.ts' });
      expect(SourceReaderService.checkPath(' ops-companion/app/(tabs)/profile.tsx ')).toEqual({
        ok: true,
        path: 'ops-companion/app/(tabs)/profile.tsx',
      });
    });
  });

  describe('resolveRef — 이벤트 release → 읽을 커밋', () => {
    it('커밋 SHA 꼴이면 그 커밋(exact), 아니면 기본 브랜치', () => {
      expect(service.resolveRef('8610ACA')).toEqual({ ref: '8610aca', exact: true });
      expect(service.resolveRef('c6a2c4b1cafa00f67779e34e05e94b105c9d4399')).toEqual({
        ref: 'c6a2c4b1cafa00f67779e34e05e94b105c9d4399',
        exact: true,
      });
      expect(service.resolveRef('dev.ansmoon.opscompanion@1.0.0+3')).toEqual({ ref: 'main', exact: false });
      expect(service.resolveRef(null)).toEqual({ ref: 'main', exact: false });
      expect(service.resolveRef('unknown')).toEqual({ ref: 'main', exact: false });
    });

    it('OPS_SOURCE_DEFAULT_REF 로 기본 브랜치를 바꿀 수 있다', async () => {
      env.OPS_SOURCE_DEFAULT_REF = 'develop';
      await build();
      expect(service.resolveRef(undefined)).toEqual({ ref: 'develop', exact: false });
    });
  });

  describe('read', () => {
    it('줄 범위를 번호 붙여 돌려주고, 커밋 ref 는 7일 캐시한다(같은 커밋의 파일은 불변)', async () => {
      const r = await service.read({ path: 'backend/src/main.ts', startLine: 58, endLine: 61, ref: '8610aca' });

      expect(r).toEqual({
        ok: true,
        path: 'backend/src/main.ts',
        ref: '8610aca',
        startLine: 58,
        endLine: 61,
        totalLines: 200,
        content: "58| line 58\n59| line 59\n60| const owner = 'k***@***'; // line 60\n61| line 61",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://raw.githubusercontent.com/ansm0403/E-commerce_shopping_mall/8610aca/backend/src/main.ts',
      );
      expect(redis.setCache).toHaveBeenCalledWith('ops:src:8610aca:backend/src/main.ts', { text: FILE }, 7 * 24 * 3600);
    });

    it('브랜치(main)는 10분만 캐시하고, 커밋 꼴이 아닌 ref 는 main 으로 바꾼다', async () => {
      await service.read({ path: 'backend/src/main.ts', startLine: 1, endLine: 2, ref: 'not-a-sha' });
      expect(fetchMock.mock.calls[0][0]).toContain('/E-commerce_shopping_mall/main/backend/src/main.ts');
      expect(redis.setCache).toHaveBeenCalledWith('ops:src:main:backend/src/main.ts', { text: FILE }, 600);
    });

    it('캐시 HIT 이면 GitHub 를 부르지 않는다', async () => {
      redis.getCache.mockResolvedValue({ text: FILE });
      const r = await service.read({ path: 'backend/src/main.ts', startLine: 1, endLine: 1, ref: '8610aca' });
      expect(r.ok).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(redis.getCache).toHaveBeenCalledWith('ops:src:8610aca:backend/src/main.ts');
    });

    it('범위 상한: 80줄을 넘기면 잘라 주고, startLine 0·문자열 숫자도 받아들인다', async () => {
      const r = await service.read({ path: 'backend/src/main.ts', startLine: '0', endLine: 500, ref: 'main' });
      expect(r).toMatchObject({ ok: true, startLine: 1, endLine: 80 });
      expect((r as { content: string }).content.split('\n')).toHaveLength(80);
      // 줄 번호 폭은 끝 줄 기준으로 맞춘다
      expect((r as { content: string }).content.startsWith(' 1| line 1\n')).toBe(true);

      const tail = await service.read({ path: 'backend/src/main.ts', startLine: 195, ref: 'main' });
      expect(tail).toMatchObject({ ok: true, startLine: 195, endLine: 200 });
    });

    it('endLine < startLine · 파일 길이 밖의 startLine 은 사유와 함께 실패(던지지 않는다)', async () => {
      expect(await service.read({ path: 'backend/src/main.ts', startLine: 50, endLine: 10, ref: 'main' })).toMatchObject({
        ok: false,
        reason: expect.stringContaining('endLine'),
      });
      expect(await service.read({ path: 'backend/src/main.ts', startLine: 999, ref: 'main' })).toMatchObject({
        ok: false,
        reason: expect.stringContaining('200줄'),
      });
    });

    it('거절 경로는 GitHub 를 부르지 않는다', async () => {
      const r = await service.read({ path: 'backend/src/../.env', ref: 'main' });
      expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('..') });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('404 는 "없다" + 60초 부정 캐시, 403/429 는 "상한", 그 밖의 오류는 상태코드, 네트워크 예외는 "읽기 실패"', async () => {
      fetchMock.mockResolvedValueOnce(response(404));
      expect(await service.read({ path: 'backend/src/nope.ts', ref: 'main' })).toMatchObject({
        ok: false,
        reason: expect.stringContaining('없다'),
      });
      expect(redis.setCache).toHaveBeenCalledWith('ops:src:main:backend/src/nope.ts', { missing: true }, 60);

      redis.getCache.mockResolvedValueOnce({ missing: true });
      expect(await service.read({ path: 'backend/src/nope.ts', ref: 'main' })).toMatchObject({ ok: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockResolvedValueOnce(response(429));
      expect(await service.read({ path: 'backend/src/main.ts', ref: 'main' })).toMatchObject({
        ok: false,
        reason: expect.stringContaining('상한'),
      });

      fetchMock.mockResolvedValueOnce(response(500));
      expect(await service.read({ path: 'backend/src/main.ts', ref: 'main' })).toMatchObject({
        ok: false,
        reason: expect.stringContaining('500'),
      });

      fetchMock.mockRejectedValueOnce(new Error('TimeoutError'));
      expect(await service.read({ path: 'backend/src/main.ts', ref: 'main' })).toMatchObject({
        ok: false,
        reason: expect.stringContaining('읽기 실패'),
      });
    });

    it('너무 큰 파일은 읽지 않는다(헤더로도, 본문으로도)', async () => {
      fetchMock.mockResolvedValueOnce(response(200, 'x', { 'content-length': String(SourceReaderService.MAX_FILE_BYTES + 1) }));
      expect(await service.read({ path: 'backend/src/main.ts', ref: 'main' })).toMatchObject({
        ok: false,
        reason: expect.stringContaining('너무 크다'),
      });

      fetchMock.mockResolvedValueOnce(response(200, 'y'.repeat(SourceReaderService.MAX_FILE_BYTES + 1)));
      expect(await service.read({ path: 'backend/src/main.ts', ref: 'main' })).toMatchObject({ ok: false });
      expect(redis.setCache).not.toHaveBeenCalled();
    });

    it('Redis 가 죽어도 읽기는 된다(캐시 실패는 삼킨다)', async () => {
      redis.getCache.mockRejectedValue(new Error('ECONNREFUSED'));
      redis.setCache.mockRejectedValue(new Error('ECONNREFUSED'));
      const r = await service.read({ path: 'backend/src/main.ts', startLine: 1, endLine: 1, ref: 'main' });
      expect(r).toMatchObject({ ok: true, content: '1| line 1' });
    });

    it('URL 의 경로 세그먼트를 인코딩한다 — 괄호는 URL 에 그대로 두어도 된다(encodeURIComponent 규칙), 한글·공백은 인코딩된다', async () => {
      await service.read({ path: 'ops-companion/app/(tabs)/profile.tsx', ref: 'main' });
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://raw.githubusercontent.com/ansm0403/E-commerce_shopping_mall/main/ops-companion/app/(tabs)/profile.tsx',
      );
      await service.read({ path: 'backend/src/seed/한글 파일.ts', ref: 'main' });
      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://raw.githubusercontent.com/ansm0403/E-commerce_shopping_mall/main/backend/src/seed/%ED%95%9C%EA%B8%80%20%ED%8C%8C%EC%9D%BC.ts',
      );
    });
  });

  it('OPS_SOURCE_READ_ENABLED=false 면 비활성, OPS_SOURCE_REPO 로 저장소를 바꿀 수 있다', async () => {
    env.OPS_SOURCE_READ_ENABLED = 'false';
    env.OPS_SOURCE_REPO = 'someone/fork';
    await build();
    expect(service.isEnabled()).toBe(false);
    await service.read({ path: 'backend/src/main.ts', ref: 'main' });
    expect(fetchMock.mock.calls[0][0]).toContain('raw.githubusercontent.com/someone/fork/main/');
  });
});
