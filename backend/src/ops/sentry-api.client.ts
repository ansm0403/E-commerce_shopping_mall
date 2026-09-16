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
   * 실패 시 상태코드만 로그에 남기고 throw — 본문(Sentry 오류 메시지)은 클라이언트로 내려보내지 않는다.
   */
  async listIssues(statsPeriod: string): Promise<SentryIssue[]> {
    if (!this.isEnabled()) {
      throw new Error('SentryApiClient is disabled');
    }

    const url = `${SentryApiClient.BASE_URL}/organizations/${encodeURIComponent(
      this.orgSlug as string,
    )}/issues/?statsPeriod=${encodeURIComponent(statsPeriod)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(SentryApiClient.TIMEOUT_MS),
    });

    if (!res.ok) {
      this.logger.error(`Sentry issues API 실패: HTTP ${res.status}`);
      throw new Error(`Sentry API responded ${res.status}`);
    }

    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) {
      this.logger.error('Sentry issues API 응답이 배열이 아님');
      throw new Error('Sentry API returned unexpected payload');
    }
    return body as SentryIssue[];
  }
}
