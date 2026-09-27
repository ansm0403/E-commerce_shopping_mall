import {
  WEBHOOK_TIMESTAMP_TOLERANCE_SEC,
  WebhookSignatureError,
  decodeWebhookSecret,
  signStandardWebhook,
  verifyStandardWebhook,
} from './webhook-signature';

/**
 * Standard Webhooks 검증 규칙을 고정한다.
 * 시크릿은 PortOne 콘솔 형식("whsec_" + base64)과 같은 모양의 테스트 값이다 — 실제 시크릿이 아니다.
 */
const SECRET = 'whsec_' + Buffer.from('test-secret-key-for-webhook-signature-spec').toString('base64');
const OTHER_SECRET = 'whsec_' + Buffer.from('another-secret').toString('base64');
const BODY = '{"type":"Transaction.Paid","timestamp":"2026-09-28T00:00:00Z","data":{"paymentId":"pay_1","transactionId":"tx_1"}}';
const NOW = 1_790_000_000; // 임의의 고정 시각(초)
const ID = 'msg_2qXYZ';

function headersFor(body: string, opts: { secret?: string; id?: string; ts?: number | string } = {}) {
  const ts = opts.ts ?? NOW;
  return {
    'webhook-id': opts.id ?? ID,
    'webhook-timestamp': String(ts),
    'webhook-signature': signStandardWebhook(opts.secret ?? SECRET, body, opts.id ?? ID, ts),
  };
}

function reasonOf(fn: () => unknown) {
  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof WebhookSignatureError) return (e as WebhookSignatureError).reason;
    throw e;
  }
  return 'ok';
}

describe('verifyStandardWebhook', () => {
  it('올바른 시크릿·본문·헤더면 id 와 timestamp 를 돌려준다', () => {
    expect(verifyStandardWebhook(SECRET, BODY, headersFor(BODY), NOW)).toEqual({ id: ID, timestamp: NOW });
  });

  it('본문은 Buffer 로 줘도 같은 결과다 (rawBody 는 Buffer 로 온다)', () => {
    expect(verifyStandardWebhook(SECRET, Buffer.from(BODY, 'utf8'), headersFor(BODY), NOW).id).toBe(ID);
  });

  it('본문이 한 글자라도 바뀌면 no_match', () => {
    const tampered = BODY.replace('pay_1', 'pay_2');
    expect(reasonOf(() => verifyStandardWebhook(SECRET, tampered, headersFor(BODY), NOW))).toBe('no_match');
  });

  it('JSON 을 파싱했다가 다시 직렬화한 본문(공백 차이)도 no_match — 원문이 필요한 이유', () => {
    const reserialized = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(reasonOf(() => verifyStandardWebhook(SECRET, reserialized, headersFor(BODY), NOW))).toBe('no_match');
  });

  it('다른 시크릿으로 만든 서명은 no_match', () => {
    expect(reasonOf(() => verifyStandardWebhook(SECRET, BODY, headersFor(BODY, { secret: OTHER_SECRET }), NOW))).toBe('no_match');
  });

  it('webhook-id 가 바뀌면 no_match (id 도 서명에 들어간다)', () => {
    const h = { ...headersFor(BODY), 'webhook-id': 'msg_other' };
    expect(reasonOf(() => verifyStandardWebhook(SECRET, BODY, h, NOW))).toBe('no_match');
  });

  it('허용 오차(5분)를 넘긴 과거 timestamp 는 timestamp_out_of_range', () => {
    const ts = NOW - WEBHOOK_TIMESTAMP_TOLERANCE_SEC - 1;
    expect(reasonOf(() => verifyStandardWebhook(SECRET, BODY, headersFor(BODY, { ts }), NOW))).toBe('timestamp_out_of_range');
  });

  it('허용 오차를 넘긴 미래 timestamp 도 timestamp_out_of_range', () => {
    const ts = NOW + WEBHOOK_TIMESTAMP_TOLERANCE_SEC + 1;
    expect(reasonOf(() => verifyStandardWebhook(SECRET, BODY, headersFor(BODY, { ts }), NOW))).toBe('timestamp_out_of_range');
  });

  it('허용 오차 경계값(정확히 5분)은 통과한다', () => {
    const ts = NOW - WEBHOOK_TIMESTAMP_TOLERANCE_SEC;
    expect(verifyStandardWebhook(SECRET, BODY, headersFor(BODY, { ts }), NOW).timestamp).toBe(ts);
  });

  it('timestamp 가 정수가 아니면 invalid_timestamp', () => {
    const h = { ...headersFor(BODY), 'webhook-timestamp': '2026-09-28T00:00:00Z' };
    expect(reasonOf(() => verifyStandardWebhook(SECRET, BODY, h, NOW))).toBe('invalid_timestamp');
  });

  it('헤더 하나라도 없으면 missing_headers', () => {
    const { 'webhook-signature': _omit, ...withoutSig } = headersFor(BODY);
    expect(reasonOf(() => verifyStandardWebhook(SECRET, BODY, withoutSig, NOW))).toBe('missing_headers');
    expect(reasonOf(() => verifyStandardWebhook(SECRET, BODY, {}, NOW))).toBe('missing_headers');
  });

  it('서명 여러 개 중 하나만 맞아도 통과 (시크릿 교체 기간)', () => {
    const h = headersFor(BODY);
    const stale = signStandardWebhook(OTHER_SECRET, BODY, ID, NOW);
    h['webhook-signature'] = `${stale} ${h['webhook-signature']}`;
    expect(verifyStandardWebhook(SECRET, BODY, h, NOW).id).toBe(ID);
  });

  it('v1 이 아닌 서명 버전은 무시한다', () => {
    const h = headersFor(BODY);
    h['webhook-signature'] = h['webhook-signature'].replace('v1,', 'v2,');
    expect(reasonOf(() => verifyStandardWebhook(SECRET, BODY, h, NOW))).toBe('no_match');
  });

  it('헤더 이름은 대소문자를 가리지 않고, 배열이면 첫 값을 쓴다', () => {
    const base = headersFor(BODY);
    const h = {
      'Webhook-Id': base['webhook-id'],
      'WEBHOOK-TIMESTAMP': [base['webhook-timestamp']],
      'webhook-signature': [base['webhook-signature']],
    };
    expect(verifyStandardWebhook(SECRET, BODY, h, NOW).id).toBe(ID);
  });

  it('"whsec_" 접두어가 없는 시크릿도 같은 키로 읽는다', () => {
    const bare = SECRET.slice('whsec_'.length);
    expect(decodeWebhookSecret(bare).equals(decodeWebhookSecret(SECRET))).toBe(true);
    expect(verifyStandardWebhook(bare, BODY, headersFor(BODY), NOW).id).toBe(ID);
  });

  it('빈 시크릿은 bad_secret', () => {
    expect(reasonOf(() => verifyStandardWebhook('', BODY, headersFor(BODY), NOW))).toBe('bad_secret');
    expect(reasonOf(() => verifyStandardWebhook('whsec_', BODY, headersFor(BODY), NOW))).toBe('bad_secret');
  });
});
