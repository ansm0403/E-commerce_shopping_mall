import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Sentry Web API 에서 실제로 쓰는 필드만 적은 최소 타입.
 * (전체 응답은 40여 필드 — 필요한 것만 읽고 나머지는 버린다)
 */
export interface SentryIssue {
  id: string;
  title: string;
  level: string;
  count: string;
  lastSeen: string;
}

/**
 * 목록 조회에서 함께 오는 필드(2026-09-20 실측). 푸시 판정에 쓴다:
 * project.slug 로 어느 서비스의 장애인지 가리고, substatus(new/escalating/regressed/ongoing)는
 * 참고용으로만 본다 — 우리 판정 기준은 "우리가 이 이슈를 푸시한 적이 있는가"(ops_push_log)다.
 */
export interface SentryIssueListItem extends SentryIssue {
  project?: { slug?: string } | null;
  firstSeen?: string;
  substatus?: string | null;
  status?: string;
}

/** 단건 조회(GET /issues/{id}/)에서 추가로 읽는 필드 */
export interface SentryIssueDetail extends SentryIssue {
  firstSeen: string;
  culprit?: string | null;
  status?: string;
  project?: { slug?: string } | null;
}

export interface SentryStackFrame {
  filename?: string | null;
  function?: string | null;
  lineNo?: number | null;
  colNo?: number | null;
  inApp?: boolean;
}

export interface SentryBreadcrumb {
  timestamp?: string | null;
  category?: string | null;
  level?: string | null;
  message?: string | null;
  type?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * GET /issues/{id}/events/latest/ — entries 는 type 으로 갈리는 배열이다(2026-09-20 실측:
 * exception · breadcrumbs · request · debugmeta). 앞의 둘만 읽는다.
 */
export interface SentryEvent {
  entries?: Array<
    | {
        type: 'exception';
        data?: {
          values?: Array<{
            type?: string | null;
            value?: string | null;
            stacktrace?: { frames?: SentryStackFrame[] | null } | null;
          }> | null;
        };
      }
    | { type: 'breadcrumbs'; data?: { values?: SentryBreadcrumb[] | null } }
    | { type: string; data?: unknown }
  >;
}

/** Sentry 가 2xx 가 아닌 응답을 줬을 때. status 로 404(없는 이슈)를 구분한다 */
export class SentryApiError extends Error {
  constructor(readonly status: number) {
    super(`Sentry API responded ${status}`);
  }
}

/**
 * Sentry Web API 클라이언트 (읽기 전용).
 *
 * 비활성(no-op) 관례: SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG 가 없으면 isEnabled()=false 이고
 * 호출 측이 먼저 확인한다 — LlmClient.isEnabled(), Sentry DSN, 이메일 모듈과 같은 방식.
 * 로컬에서 키 없이도 서버가 떠야 하기 때문.
 *
 * 토큰은 이 클래스 밖으로 나가지 않는다(응답에 실리지 않음 — §7 절대 규칙).
 * 무료(Developer) 플랜에서도 이 API 는 200 을 돌려준다(2026-09-16 실측, ex-observability-map §5-1).
 */
@Injectable()
export class SentryApiClient {
  private readonly logger = new Logger(SentryApiClient.name);
  private static readonly BASE_URL = 'https://sentry.io/api/0';
  private static readonly TIMEOUT_MS = 8_000;

  private readonly token: string | undefined;
  private readonly orgSlug: string | undefined;

  constructor(config: ConfigService) {
    this.token = config.get<string>('SENTRY_AUTH_TOKEN')?.trim() || undefined;
    this.orgSlug = config.get<string>('SENTRY_ORG_SLUG')?.trim() || undefined;

    if (!this.isEnabled()) {
      this.logger.warn(
        'SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG 미설정 — /v1/ops/incidents 는 503 을 반환합니다(비활성).',
      );
    }
  }

  isEnabled(): boolean {
    return Boolean(this.token && this.orgSlug);
  }

  /**
   * GET /organizations/{org}/issues/?statsPeriod=24h
   * sort=date 는 "마지막 발생(lastSeen) 최신순" — 폴링은 이 순서가 있어야 커서와 맞물린다.
   */
  async listIssues(
    statsPeriod: string,
    opts: { query?: string; limit?: number; sort?: 'date' | 'new' | 'freq' } = {},
  ): Promise<SentryIssueListItem[]> {
    const params = new URLSearchParams({ statsPeriod });
    if (opts.query !== undefined) params.set('query', opts.query);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.sort !== undefined) params.set('sort', opts.sort);

    const body = await this.get(`/issues/?${params.toString()}`);
    if (!Array.isArray(body)) {
      this.logger.error('Sentry issues API 응답이 배열이 아님');
      throw new Error('Sentry API returned unexpected payload');
    }
    return body as SentryIssueListItem[];
  }

  /** GET /organizations/{org}/issues/{id}/ — 조직 범위 경로라 남의 조직 이슈 id 는 404 다 */
  async getIssue(issueId: string): Promise<SentryIssueDetail> {
    return (await this.get(`/issues/${encodeURIComponent(issueId)}/`)) as SentryIssueDetail;
  }

  /** GET /organizations/{org}/issues/{id}/events/latest/ — 스택트레이스·breadcrumbs 의 원천 */
  async getLatestEvent(issueId: string): Promise<SentryEvent> {
    return (await this.get(`/issues/${encodeURIComponent(issueId)}/events/latest/`)) as SentryEvent;
  }

  /**
   * 조직 범위 GET 공통부. 실패 시 상태코드만 로그에 남기고 SentryApiError 를 던진다 —
   * 본문(Sentry 오류 메시지)은 클라이언트로 내려보내지 않는다.
   */
  private async get(path: string): Promise<unknown> {
    if (!this.isEnabled()) {
      throw new Error('SentryApiClient is disabled');
    }

    const url = `${SentryApiClient.BASE_URL}/organizations/${encodeURIComponent(
      this.orgSlug as string,
    )}${path}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(SentryApiClient.TIMEOUT_MS),
    });

    if (!res.ok) {
      this.logger.error(`Sentry API 실패: HTTP ${res.status} (${path.split('?')[0]})`);
      throw new SentryApiError(res.status);
    }
    return (await res.json()) as unknown;
  }
}
