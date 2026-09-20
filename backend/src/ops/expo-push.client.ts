import { Injectable, Logger } from '@nestjs/common';

/** 앱으로 보낼 알림 한 통. data 는 앱이 딥링크를 만들 때 읽는다(설계 §3.3). */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: { incidentId: string; url: string };
  /** 안드로이드에서 소리·중요도를 결정하는 채널 이름. 앱이 만든 채널과 같아야 한다 */
  channelId?: string;
  priority?: 'default' | 'high';
}

/** 토큰 한 개당 결과. error='DeviceNotRegistered' 면 그 토큰은 죽은 것이다. */
export interface ExpoPushResult {
  token: string;
  ok: boolean;
  error?: string;
}

/**
 * Expo Push Service 클라이언트.
 *
 * 왜 이것만으로 폰이 울리는가: Expo 가 우리 대신 FCM(안드로이드)·APNs(iOS)에 말을 건다.
 * 우리는 `ExponentPushToken[...]` 하나만 알면 되고, FCM 자격증명은 Expo 프로젝트에 등록해 둔다.
 * 그래서 백엔드에 구글 서비스 계정 키를 둘 필요가 없다(§7 ① 의 취지와 같다).
 *
 * 인증: 우리 Expo 프로젝트는 푸시 보안(Enhanced Security)을 켜지 않았으므로 토큰 없이 보낼 수 있다.
 * EXPO_ACCESS_TOKEN 이 설정돼 있으면 Authorization 헤더로 함께 보낸다(나중에 켤 때를 대비).
 */
@Injectable()
export class ExpoPushClient {
  private readonly logger = new Logger(ExpoPushClient.name);
  private static readonly URL = 'https://exp.host/--/api/v2/push/send';
  private static readonly TIMEOUT_MS = 10_000;
  /** Expo 권장 배치 크기 */
  static readonly CHUNK_SIZE = 100;

  constructor(private readonly accessToken?: string) {}

  /**
   * 여러 통을 한 번의 HTTP 요청으로 보낸다(Expo 가 배열을 받는다).
   * 응답의 data 배열은 보낸 순서와 1:1 이므로 인덱스로 토큰과 맞춘다.
   * 요청 자체가 실패하면 전체를 실패로 돌려준다 — 호출 측이 발송 기록을 되돌릴 수 있게.
   */
  async send(messages: ExpoPushMessage[]): Promise<ExpoPushResult[]> {
    if (messages.length === 0) return [];

    const results: ExpoPushResult[] = [];
    for (let i = 0; i < messages.length; i += ExpoPushClient.CHUNK_SIZE) {
      const chunk = messages.slice(i, i + ExpoPushClient.CHUNK_SIZE);
      results.push(...(await this.sendChunk(chunk)));
    }
    return results;
  }

  private async sendChunk(chunk: ExpoPushMessage[]): Promise<ExpoPushResult[]> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    let tickets: Array<{ status?: string; details?: { error?: string }; message?: string }>;
    try {
      const res = await fetch(ExpoPushClient.URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(ExpoPushClient.TIMEOUT_MS),
      });

      if (!res.ok) {
        this.logger.error(`Expo push API 실패: HTTP ${res.status}`);
        return chunk.map((m) => ({ token: m.to, ok: false, error: `HTTP ${res.status}` }));
      }

      const body = (await res.json()) as { data?: unknown };
      tickets = Array.isArray(body.data) ? body.data : [];
    } catch (err) {
      this.logger.error(`Expo push 전송 실패: ${(err as Error).message}`);
      return chunk.map((m) => ({ token: m.to, ok: false, error: 'request_failed' }));
    }

    return chunk.map((m, index) => {
      const ticket = tickets[index];
      if (!ticket) return { token: m.to, ok: false, error: 'no_ticket' };
      if (ticket.status === 'ok') return { token: m.to, ok: true };

      // 흔한 error: DeviceNotRegistered(앱 삭제·토큰 폐기), MessageTooBig, MessageRateExceeded
      const error = ticket.details?.error ?? ticket.message ?? 'unknown';
      this.logger.warn(`Expo push 거부: ${error}`);
      return { token: m.to, ok: false, error };
    });
  }
}
