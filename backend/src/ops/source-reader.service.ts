import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../intrastructure/redis/redis.service';
import { scrubText } from '../common/utils/scrub-text';

/** `read_source` 도구의 입력. LLM 이 보내는 인자라 전부 검증 대상이다(타입도 믿지 않는다) */
export interface SourceReadRequest {
  path: unknown;
  startLine?: unknown;
  endLine?: unknown;
  /** 어느 커밋을 읽나. LLM 이 아니라 백엔드가 정한다(설계 §9 Phase 5 결정 ②) */
  ref: string;
}

export type SourceReadResult =
  | {
      ok: true;
      path: string;
      ref: string;
      startLine: number;
      endLine: number;
      totalLines: number;
      /** 줄 번호가 붙은 코드 조각(scrubText 적용) */
      content: string;
    }
  | { ok: false; path: string; ref: string; reason: string };

/**
 * GitHub 저장소의 소스 파일을 읽어 LLM 도구(`read_source`)의 결과로 만든다 (설계 §9 Phase 5 결정 ③·④).
 *
 * 왜 백엔드가 읽나: LLM 은 인터넷에 직접 닿지 않는다. 모델이 "이 파일 이 줄을 읽어 달라"고 요청하면
 * 이 서비스가 raw.githubusercontent.com 에서 파일을 받아 줄 범위만 잘라 돌려준다. 어시스턴트의 매출 조회
 * 도구와 같은 구조 — 실행은 항상 우리 코드가 하고, 모델은 결과 문자열만 본다.
 *
 * 안전장치 — 저장소가 public 이어도 "LLM 이 원하는 파일을 아무거나 읽는 구조"는 만들지 않는다:
 *  - 경로 허용 목록(ALLOWED_PREFIXES) 밖·`..`·절대경로·비밀값 파일 이름(DENIED_NAME)은 fetch 전에 거절
 *  - 한 번에 MAX_LINES 줄, 파일 크기 MAX_FILE_BYTES 이하
 *  - 결과도 LLM 입력이므로 scrubText(코드 주석·픽스처에 이메일이 있을 수 있다)
 *  - ref(커밋)는 호출 측(OpsAnalysisService)이 이벤트의 release 로 정한다. 모델이 고르지 않는다
 *
 * 비밀값 0 — 무인증 raw 읽기(시간당 60회/IP). 같은 커밋의 파일은 불변이라 Redis 에 길게 캐시한다.
 * 저장소가 private 으로 바뀌면 여기에 토큰 헤더 한 줄이 늘어난다(infra-story 5장 갱신 대상).
 *
 * 비활성(no-op) 관례: OPS_SOURCE_READ_ENABLED=false 면 isEnabled()=false 이고 분석은 Phase 4 경로(v1/v2)로 돈다.
 */
@Injectable()
export class SourceReaderService {
  private readonly logger = new Logger(SourceReaderService.name);

  /** 한 번에 읽을 수 있는 줄 수. 스택의 줄 앞뒤 ±40 이면 함수 하나는 보인다 */
  static readonly MAX_LINES = 80;
  /** 이보다 큰 파일은 읽지 않는다(번들·락파일 방어). 소스 파일은 보통 수십 KB 다 */
  static readonly MAX_FILE_BYTES = 400_000;
  static readonly TIMEOUT_MS = 5_000;
  /** 커밋 SHA 로 읽은 파일은 불변 — 길게. 브랜치(main)는 바뀌므로 짧게 */
  static readonly CACHE_TTL_COMMIT_SEC = 7 * 24 * 3600;
  static readonly CACHE_TTL_BRANCH_SEC = 600;
  static readonly CACHE_PREFIX = 'ops:src:';

  static readonly ALLOWED_PREFIXES = ['backend/src/', 'frontend/src/', 'ops-companion/app/', 'ops-companion/src/'];
  /**
   * Sentry 프로젝트 slug → 저장소 폴더(Phase 6). 프레임 filename 에 저장소 폴더 이름이 없을 때만 쓰는 힌트다.
   * 프론트(Next.js + Vercel 소스맵 업로드)의 프레임은 `./src/hooks/useCategories.ts` 꼴이라 — 빌드 cwd 가 `frontend/`
   * 이므로 `frontend/` 가 빠진다(실측 2026-09-22). 백엔드(`webpack://shopping-mall/backend/src/…`)·앱(`app:///ops-companion/…`)은
   * 폴더 이름이 들어 있어 이 표를 타지 않는다.
   */
  static readonly PROJECT_ROOTS: Readonly<Record<string, string>> = {
    'e-commerse-frontend': 'frontend',
    'e-commerse-backend': 'backend',
    'ops-companion': 'ops-companion',
  };
  /** 이름만으로 거절하는 파일. 허용 폴더 안에 있어도 읽지 않는다 */
  static readonly DENIED_NAME =
    /(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p12|jks|keystore)|google-services\.json|[^/]*firebase-adminsdk[^/]*)$/i;
  /** 커밋 SHA 꼴(짧은 7자리 ~ 전체 40자리). Sentry release 가 이 꼴이면 그 커밋을 읽는다 */
  static readonly COMMIT_REF = /^[0-9a-f]{7,40}$/i;
  static readonly MAX_PATH_LENGTH = 300;

  private readonly enabled: boolean;
  private readonly repo: string;
  private readonly defaultRef: string;

  constructor(
    config: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.enabled = (config.get<string>('OPS_SOURCE_READ_ENABLED') ?? 'true') !== 'false';
    this.repo = config.get<string>('OPS_SOURCE_REPO')?.trim() || 'ansm0403/E-commerce_shopping_mall';
    this.defaultRef = config.get<string>('OPS_SOURCE_DEFAULT_REF')?.trim() || 'main';
    if (!this.enabled) {
      this.logger.warn('OPS_SOURCE_READ_ENABLED=false — AI 분석이 소스 코드를 읽지 않습니다(v1/v2 경로).');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getDefaultRef(): string {
    return this.defaultRef;
  }

  getRepo(): string {
    return this.repo;
  }

  /**
   * 이벤트의 release → 읽을 ref. 커밋 SHA 꼴이면 그대로(정확한 시점), 아니면 기본 브랜치.
   * 앱의 `dev.ansmoon.opscompanion@1.0.0+3` 같은 릴리즈 이름은 커밋이 아니라 HEAD 로 간다.
   */
  resolveRef(release: string | null | undefined): { ref: string; exact: boolean } {
    const r = (release ?? '').trim();
    if (SourceReaderService.COMMIT_REF.test(r)) return { ref: r.toLowerCase(), exact: true };
    return { ref: this.defaultRef, exact: false };
  }

  /**
   * Sentry 프레임의 filename → 저장소 상대경로. 읽을 수 없는 꼴이면 null.
   *  - `webpack://shopping-mall/backend/src/main.ts`(--enable-source-maps 적용 후 백엔드) → `backend/src/main.ts`
   *  - `app:///ops-companion/app/(tabs)/profile.tsx`(앱, 소스맵 업로드) → `ops-companion/app/(tabs)/profile.tsx`
   *  - `C:\\…\\backend\\src\\x.ts`(로컬 개발 서버) → `backend/src/x.ts`
   *  - `./src/hooks/useCategories.ts` + project `e-commerse-frontend`(프론트, Vercel 소스맵 업로드 후) → `frontend/src/hooks/useCategories.ts`
   *  - `../node_modules/axios/dist/browser/axios.cjs`(프론트 라이브러리 프레임) → null(`..` 거절)
   *  - `/app/backend/dist/main.js`(소스맵 없는 옛 운영 이벤트)·`_next/static/chunks/…`(프론트, 소스맵 미업로드) → null
   *
   * `project`(Sentry slug)는 filename 에 저장소 폴더 이름이 없을 때만 쓰는 힌트다(PROJECT_ROOTS). 폴더 이름이 있으면
   * project 와 무관하게 그 자리부터 자른다 — 백엔드·앱의 기존 동작은 그대로다.
   */
  static normalizeFramePath(filename: string | null | undefined, project?: string | null): string | null {
    if (typeof filename !== 'string' || filename.length === 0) return null;
    const unified = filename.replace(/\\/g, '/').split(/[?#]/)[0];
    let best = -1;
    for (const prefix of SourceReaderService.ALLOWED_PREFIXES) {
      const marker = `/${prefix}`;
      const idx = unified.indexOf(marker);
      if (idx >= 0 && (best === -1 || idx < best)) best = idx;
      if (unified.startsWith(prefix)) best = best === -1 ? 0 : Math.min(best, 0);
    }
    if (best >= 0) {
      const candidate = unified.slice(unified[best] === '/' ? best + 1 : best);
      return SourceReaderService.checkPath(candidate).ok ? candidate : null;
    }

    // 폴더 이름이 없는 프레임: 프로젝트 힌트로 저장소 폴더를 앞에 붙인다. 앞의 `./` 하나만 접고(webpack 상대경로),
    // `../`·절대경로·URL 은 checkPath 가 거절한다 — `../node_modules/…` 가 `frontend/../node_modules` 로 새지 않는다.
    const root = project ? SourceReaderService.PROJECT_ROOTS[project] : undefined;
    if (!root) return null;
    const relative = unified.startsWith('./') ? unified.slice(2) : unified;
    if (relative.startsWith('/') || /^[a-z]+:/i.test(relative) || relative.startsWith('../')) return null;
    const candidate = `${root}/${relative}`;
    return SourceReaderService.checkPath(candidate).ok ? candidate : null;
  }

  /** 경로 검증. fetch 전에 돈다 — 거절 사유는 모델에게 그대로 돌아가 다음 호출을 고치게 한다 */
  static checkPath(path: unknown): { ok: true; path: string } | { ok: false; reason: string } {
    if (typeof path !== 'string' || path.trim().length === 0) return { ok: false, reason: 'path 는 비어 있지 않은 문자열이어야 한다' };
    const p = path.trim();
    if (p.length > SourceReaderService.MAX_PATH_LENGTH) return { ok: false, reason: 'path 가 너무 길다' };
    if (p.includes('\0') || p.includes('\\')) return { ok: false, reason: 'path 에 허용되지 않는 문자가 있다' };
    if (p.startsWith('/') || /^[a-z]+:/i.test(p)) return { ok: false, reason: 'path 는 저장소 상대경로여야 한다(절대경로·URL 불가)' };
    if (p.split('/').some((seg) => seg === '..' || seg === '.' || seg.length === 0)) {
      return { ok: false, reason: 'path 에 ..·.·빈 세그먼트를 쓸 수 없다' };
    }
    if (!SourceReaderService.ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix))) {
      return { ok: false, reason: `읽을 수 있는 폴더는 ${SourceReaderService.ALLOWED_PREFIXES.join(', ')} 뿐이다` };
    }
    if (SourceReaderService.DENIED_NAME.test(p)) return { ok: false, reason: '설정·비밀값 파일은 읽지 않는다' };
    return { ok: true, path: p };
  }

  /**
   * 파일의 줄 범위를 읽는다. 실패는 던지지 않고 { ok:false, reason } 로 돌려준다 —
   * 도구 결과는 모델에게 돌아가 "그 파일은 못 읽었다"를 알리는 데이터이고, 분석 자체는 계속돼야 한다(DoD ③).
   */
  async read(req: SourceReadRequest): Promise<SourceReadResult> {
    const ref = SourceReaderService.COMMIT_REF.test(req.ref) ? req.ref.toLowerCase() : this.defaultRef;
    const checked = SourceReaderService.checkPath(req.path);
    if (!checked.ok) return { ok: false, path: String(req.path ?? ''), ref, reason: checked.reason };
    const path = checked.path;

    const startLine = Math.max(1, Math.floor(SourceReaderService.toNumber(req.startLine, 1)));
    let endLine = Math.floor(SourceReaderService.toNumber(req.endLine, startLine + SourceReaderService.MAX_LINES - 1));
    if (endLine < startLine) return { ok: false, path, ref, reason: 'endLine 은 startLine 이상이어야 한다' };
    endLine = Math.min(endLine, startLine + SourceReaderService.MAX_LINES - 1);

    const file = await this.fetchFile(ref, path);
    if (!file.ok) return { ok: false, path, ref, reason: file.reason };

    const lines = file.text.split('\n');
    const totalLines = lines.length;
    if (startLine > totalLines) {
      return { ok: false, path, ref, reason: `startLine 이 파일 길이(${totalLines}줄)를 넘는다` };
    }
    const end = Math.min(endLine, totalLines);
    const width = String(end).length;
    const numbered = lines
      .slice(startLine - 1, end)
      .map((line, i) => `${String(startLine + i).padStart(width)}| ${line.replace(/\r$/, '')}`)
      .join('\n');

    this.logger.log(`소스 읽기: ${path}:${startLine}-${end} @${ref} (${totalLines}줄${file.cached ? ', 캐시' : ''})`);
    return { ok: true, path, ref, startLine, endLine: end, totalLines, content: scrubText(numbered) ?? '' };
  }

  /**
   * 파일 **전체** 텍스트(Phase 8 이름 대조용). 경로 검증·ref 해석·캐시는 read 와 같고, 줄 번호와 scrubText 가 없다 —
   * 이 텍스트는 LLM 에 가지 않고 서버 안에서 이름만 뽑는 데 쓰인다(IdentifierCheckService). 앱으로도 나가지 않는다.
   */
  async readFile(
    path: unknown,
    ref: string,
  ): Promise<{ ok: true; path: string; ref: string; text: string } | { ok: false; path: string; ref: string; reason: string }> {
    const resolvedRef = SourceReaderService.COMMIT_REF.test(ref ?? '') ? ref.toLowerCase() : this.defaultRef;
    const checked = SourceReaderService.checkPath(path);
    if (!checked.ok) return { ok: false, path: String(path ?? ''), ref: resolvedRef, reason: checked.reason };
    const file = await this.fetchFile(resolvedRef, checked.path);
    if (!file.ok) return { ok: false, path: checked.path, ref: resolvedRef, reason: file.reason };
    return { ok: true, path: checked.path, ref: resolvedRef, text: file.text };
  }

  /**
   * 파일 전체를 받아 Redis 에 둔다. 같은 파일의 다른 줄 범위를 이어서 읽는 것이 흔하므로 조각이 아니라 전체를 캐시한다.
   * 없는 파일(404)도 짧게 기억한다 — 모델이 같은 잘못된 경로를 반복 요청해도 GitHub 를 다시 부르지 않는다.
   */
  private async fetchFile(
    ref: string,
    path: string,
  ): Promise<{ ok: true; text: string; cached: boolean } | { ok: false; reason: string }> {
    const cacheKey = `${SourceReaderService.CACHE_PREFIX}${ref}:${path}`;
    const cached = await this.redisService.getCache<{ text?: string; missing?: boolean }>(cacheKey).catch(() => null);
    if (cached && typeof cached === 'object') {
      if (cached.missing) return { ok: false, reason: '파일이 없다(경로나 커밋을 확인하라)' };
      if (typeof cached.text === 'string') return { ok: true, text: cached.text, cached: true };
    }

    const ttl = SourceReaderService.COMMIT_REF.test(ref)
      ? SourceReaderService.CACHE_TTL_COMMIT_SEC
      : SourceReaderService.CACHE_TTL_BRANCH_SEC;
    const url = `https://raw.githubusercontent.com/${this.repo}/${encodeURIComponent(ref)}/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(SourceReaderService.TIMEOUT_MS) });
    } catch (e) {
      this.logger.warn(`GitHub 읽기 실패(${path}@${ref}): ${(e as Error).message}`);
      return { ok: false, reason: '읽기 실패(GitHub 응답 없음 또는 시간 초과)' };
    }

    if (res.status === 404) {
      await this.redisService.setCache(cacheKey, { missing: true }, 60).catch(() => undefined);
      return { ok: false, reason: '파일이 없다(경로나 커밋을 확인하라)' };
    }
    if (res.status === 403 || res.status === 429) {
      this.logger.warn(`GitHub 요청 상한(${res.status}) — ${path}@${ref}`);
      return { ok: false, reason: 'GitHub 요청 상한에 걸렸다. 잠시 뒤에는 읽을 수 있다' };
    }
    if (!res.ok) {
      this.logger.warn(`GitHub 응답 ${res.status} — ${path}@${ref}`);
      return { ok: false, reason: `GitHub 응답 오류(${res.status})` };
    }

    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > SourceReaderService.MAX_FILE_BYTES) return { ok: false, reason: '파일이 너무 크다' };
    const text = await res.text();
    if (text.length > SourceReaderService.MAX_FILE_BYTES) return { ok: false, reason: '파일이 너무 크다' };

    await this.redisService.setCache(cacheKey, { text }, ttl).catch(() => undefined);
    return { ok: true, text, cached: false };
  }

  private static toNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
    return fallback;
  }
}
