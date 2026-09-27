import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Standard Webhooks 서명 검증 (PortOne V2 웹훅 버전 2024-04-25 가 따르는 규격)
 *
 * PortOne 은 웹훅마다 헤더 세 개를 붙인다.
 *   webhook-id        : 메시지 고유 번호
 *   webhook-timestamp : 보낸 시각(초 단위 unix time)
 *   webhook-signature : "v1,<base64>" 가 공백으로 여러 개 올 수 있다(시크릿 교체 기간)
 *
 * 서명 = HMAC-SHA256( key = base64decode(시크릿에서 "whsec_" 를 뗀 것),
 *                    msg = `${webhook-id}.${webhook-timestamp}.${원문 body}` )
 *
 * 원문 body 가 필요하다 — JSON 으로 파싱했다가 다시 문자열로 만들면 공백·키 순서가 달라져
 * 서명이 어긋난다(main.ts 의 `rawBody: true`).
 *
 * 외부 의존성 없이 구현한 이유: 규격이 공개돼 있고 계산이 HMAC 하나뿐이라, 결제 경로에
 * 0.x 버전 SDK 를 더하는 것보다 40줄을 테스트로 고정하는 편이 검토하기 쉽다.
 */

export const WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 5 * 60;

export type WebhookSignatureFailure =
  | 'missing_headers'
  | 'invalid_timestamp'
  | 'timestamp_out_of_range'
  | 'bad_secret'
  | 'no_match';

export class WebhookSignatureError extends Error {
  constructor(public readonly reason: WebhookSignatureFailure, message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  const value = direct ?? headers[Object.keys(headers).find((k) => k.toLowerCase() === name) ?? ''];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** "whsec_" 접두어를 떼고 base64 를 푼 HMAC 키. 접두어가 없어도 받아 준다. */
export function decodeWebhookSecret(secret: string): Buffer {
  const trimmed = (secret ?? '').trim();
  const b64 = trimmed.startsWith('whsec_') ? trimmed.slice('whsec_'.length) : trimmed;
  if (!b64) throw new WebhookSignatureError('bad_secret', '웹훅 시크릿이 비어 있다');
  const key = Buffer.from(b64, 'base64');
  if (key.length === 0) throw new WebhookSignatureError('bad_secret', '웹훅 시크릿이 base64 가 아니다');
  return key;
}

function computeSignature(key: Buffer, id: string, timestamp: string, body: string | Buffer): Buffer {
  const hmac = createHmac('sha256', key);
  hmac.update(`${id}.${timestamp}.`);
  hmac.update(body);
  return hmac.digest();
}

/**
 * 검증 성공 시 { id, timestamp } 를 돌려주고, 실패하면 WebhookSignatureError 를 던진다.
 * @param nowSec 테스트용 현재 시각(초). 기본은 실제 시각.
 */
export function verifyStandardWebhook(
  secret: string,
  rawBody: string | Buffer,
  headers: WebhookHeaders,
  nowSec: number = Math.floor(Date.now() / 1000),
): { id: string; timestamp: number } {
  const id = readHeader(headers, 'webhook-id');
  const timestampRaw = readHeader(headers, 'webhook-timestamp');
  const signatureHeader = readHeader(headers, 'webhook-signature');
  if (!id || !timestampRaw || !signatureHeader) {
    throw new WebhookSignatureError('missing_headers', 'webhook-id / webhook-timestamp / webhook-signature 헤더가 없다');
  }

  if (!/^\d+$/.test(timestampRaw)) {
    throw new WebhookSignatureError('invalid_timestamp', `webhook-timestamp 가 정수가 아니다: ${timestampRaw}`);
  }
  const timestamp = Number(timestampRaw);
  if (Math.abs(nowSec - timestamp) > WEBHOOK_TIMESTAMP_TOLERANCE_SEC) {
    throw new WebhookSignatureError(
      'timestamp_out_of_range',
      `webhook-timestamp 가 허용 오차(${WEBHOOK_TIMESTAMP_TOLERANCE_SEC}s)를 벗어났다: ${timestamp} vs now ${nowSec}`,
    );
  }

  const key = decodeWebhookSecret(secret);
  const expected = computeSignature(key, id, timestampRaw, rawBody);

  // "v1,AAA v1,BBB" — 버전이 v1 인 것만 비교. 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다.
  const matched = signatureHeader
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('v1,'))
    .map((s) => Buffer.from(s.slice(3), 'base64'))
    .some((candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected));

  if (!matched) throw new WebhookSignatureError('no_match', '서명이 일치하지 않는다');
  return { id, timestamp };
}

/** 테스트·로컬 프로브용 — PortOne 이 붙이는 것과 같은 형식의 서명 문자열("v1,<base64>")을 만든다. */
export function signStandardWebhook(secret: string, rawBody: string | Buffer, id: string, timestamp: number | string): string {
  const key = decodeWebhookSecret(secret);
  return `v1,${computeSignature(key, id, String(timestamp), rawBody).toString('base64')}`;
}
