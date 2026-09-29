'use client';

/**
 * 연동 확인 — 버튼 한 번으로 진짜 Sentry 에러를 내고, 웹이 **앱과 같은 엔드포인트**(`GET /ops/incidents`)로
 * 그 이슈가 앱 목록에 나타나는 것을 지켜본다(설계 §9 "웹 → 앱 연동 확인" 결정 ⑨). 나타나면 "앱에서 열기" 딥링크(결정 ⑩).
 *
 * 흐름: 코드 생성 → sendVisitorTestError → 추적기 3단계(보냄 ✓ / Sentry 수집 중 / 앱 목록 노출 ✓)
 *  · "보냄 ✓" 는 SDK 가 서버 응답을 받은 뒤(`waitForSend`)에만 켠다 — 광고 차단기가 전송을 막아도 event id 는 만들어지므로
 *    id 만 보고 ✓ 를 켜면 거짓 안심이 된다(2026-09-27 운영 실기기). 실패면 붉은 안내.
 *  · 폴링은 20초 간격 최대 9회(3분). 백엔드 목록 캐시가 60초라 더 자주 물을 이유가 없다. 운영 실측은 첫 확인(20초 이내)에 노출.
 *  · 페이지를 떠나면 폴링을 멈춘다(cleanup).
 *  · 노출 확인 후 상세(`GET /ops/incidents/:id`)에서 첫 발생 시각을 읽어 버튼 시각과 나란히 보여준다(결정 ⑦).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { authClient } from '../../../../../lib/axios/axios-http-client';
import {
  VISITOR_TEST_COOLDOWN_MS,
  formatKst,
  generateVisitorCode,
  isSentryEnabled,
  markVisitorTestSent,
  readCooldownRemainingMs,
  sendVisitorTestError,
  visitorTestMarker,
  waitForSend,
  type SendConfirmation,
  type VisitorTestSend,
} from '../visitor-test';
import { appDeepLink, webTrialLink } from '../links';

/** 앱과 같은 응답(backend `IncidentSummary`) — 여기서 쓰는 필드만 */
interface IncidentSummary {
  id: string;
  title: string;
  level: 'error' | 'warning' | 'info';
  count: number;
  lastSeen: string;
}

interface IncidentDetail {
  id: string;
  firstSeen: string;
  lastSeen: string;
}

type TrackerStage = 'idle' | 'polling' | 'found' | 'timeout';

interface FoundIncident {
  id: string;
  title: string;
  lastSeen: string;
  firstSeen: string | null;
}

export const POLL_INTERVAL_MS = 20_000;
export const POLL_MAX_ATTEMPTS = 9;

/** 딥링크는 앱이 깔려 있을 수 있는 안드로이드에서만 — 아이폰엔 설치할 앱이 없어 눌러도 아무 일도 없다 */
const isAndroidUserAgent = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

const AD_BLOCKER_HINT =
  '광고 차단기(uBlock·AdGuard 등)가 Sentry 전송을 막았을 가능성이 큽니다. 차단기를 끄거나 이 사이트를 허용한 뒤 페이지를 새로고침하고 다시 보내세요.';

export default function LinkCheckSection() {
  const [sentryOn, setSentryOn] = useState<boolean | null>(null);
  const [isAndroid, setIsAndroid] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(0);
  const [sent, setSent] = useState<VisitorTestSend | null>(null);
  const [sendState, setSendState] = useState<'pending' | SendConfirmation['status']>('pending');
  const [sendCode, setSendCode] = useState<number | undefined>(undefined);
  const [stage, setStage] = useState<TrackerStage>('idle');
  const [attempts, setAttempts] = useState(0);
  const [found, setFound] = useState<FoundIncident | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 브라우저에서만 알 수 있는 것들 — SSR 과 첫 렌더를 맞추기 위해 effect 에서 읽는다
  useEffect(() => {
    setSentryOn(isSentryEnabled());
    setIsAndroid(isAndroidUserAgent());
    setCooldownMs(readCooldownRemainingMs());
  }, []);

  // 쿨다운 카운트다운(1초)
  useEffect(() => {
    if (cooldownMs <= 0) return;
    const t = setTimeout(() => setCooldownMs(readCooldownRemainingMs()), 1000);
    return () => clearTimeout(t);
  }, [cooldownMs]);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 보낸 뒤 앱과 같은 목록 API 를 20초마다 — 내 코드가 제목에 있는 항목이 나타나면 끝
  useEffect(() => {
    if (!sent) return;
    const marker = visitorTestMarker(sent.code);
    let count = 0;
    setStage('polling');
    setAttempts(0);
    setFound(null);
    setPollError(null);

    const tick = async () => {
      count += 1;
      setAttempts(count);
      try {
        const { data } = await authClient.get<IncidentSummary[]>('/ops/incidents');
        const hit = Array.isArray(data) ? data.find((item) => item.title.includes(marker)) : undefined;
        if (hit) {
          stopPolling();
          setFound({ id: hit.id, title: hit.title, lastSeen: hit.lastSeen, firstSeen: null });
          setStage('found');
          // 첫 발생 시각은 상세에만 있다 — 실패해도 노출 확인 자체는 이미 끝났으므로 조용히 넘어간다
          try {
            const detail = await authClient.get<IncidentDetail>(`/ops/incidents/${hit.id}`);
            setFound((prev) => (prev ? { ...prev, firstSeen: detail.data.firstSeen ?? null } : prev));
          } catch {
            /* 상세 없이도 충분 */
          }
          return;
        }
        setPollError(null);
      } catch (err) {
        setPollError(err instanceof Error ? err.message : '목록 조회 실패');
      }
      if (count >= POLL_MAX_ATTEMPTS) {
        stopPolling();
        setStage('timeout');
      }
    };

    timerRef.current = setInterval(tick, POLL_INTERVAL_MS);
    return stopPolling;
  }, [sent, stopPolling]);

  const handleSend = () => {
    if (cooldownMs > 0) return;
    const code = generateVisitorCode();
    const result = sendVisitorTestError(code);
    markVisitorTestSent(result.sentAt.getTime());
    setCooldownMs(VISITOR_TEST_COOLDOWN_MS);
    setSendState('pending');
    setSendCode(undefined);
    setSent(result);
    // 서버 응답이 온 뒤에만 "보냄 ✓". 차단돼서 응답이 없으면 8초 뒤 실패로 판정한다.
    void waitForSend(result.eventId).then((confirmation) => {
      setSendState(confirmation.status);
      setSendCode(confirmation.statusCode);
    });
  };

  const marker = sent ? visitorTestMarker(sent.code) : null;
  const sendFailed = sendState === 'failed';

  return (
    <section style={card}>
      <h2 style={h2}>연동 확인 — 내가 낸 에러가 앱에 뜬다</h2>
      <p style={muted}>
        아래 버튼은 이 브라우저에서 <strong>진짜 에러</strong>를 만들어 쇼핑몰 프론트의 Sentry 프로젝트로 보냅니다
        (미리 심어 둔 데이터가 아닙니다). 운영 앱은 같은 Sentry 를 읽으므로, 잠시 뒤 앱 인시던트 목록에
        방문자 코드가 붙은 항목이 나타납니다. 이 페이지도 앱과 <strong>같은 API</strong>로 그 항목을 기다렸다가 표시합니다.
      </p>
      <p style={{ ...muted, color: '#b91c1c', fontWeight: 600 }}>
        광고 차단기(uBlock·AdGuard 등)를 켠 브라우저에서는 전송이 막힙니다. 차단기가 Sentry 를 추적기로 분류해 이 사이트의 전송 경로까지
        차단하기 때문입니다. 누르기 전에 차단기를 끄거나 이 사이트를 허용해 주세요.
      </p>

      {sentryOn === false && (
        <div style={warn}>
          이 환경은 Sentry 가 꺼져 있습니다(<code>NEXT_PUBLIC_SENTRY_DSN</code> 없음). 버튼을 눌러도 아무 데도 전송되지 않습니다 —
          운영 배포(Vercel)에서 확인하세요.
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleSend}
          disabled={cooldownMs > 0}
          style={{
            padding: '10px 18px',
            borderRadius: '8px',
            border: 'none',
            background: cooldownMs > 0 ? '#cbd5e1' : '#dc2626',
            color: '#fff',
            fontSize: '14px',
            fontWeight: 700,
            cursor: cooldownMs > 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {cooldownMs > 0 ? `다시 보내기까지 ${Math.ceil(cooldownMs / 1000)}초` : '테스트 에러 보내기'}
        </button>
        <span style={{ fontSize: '12px', color: '#64748b' }}>브라우저당 60초에 한 번. 이슈 하나당 이벤트 1건만 생깁니다.</span>
      </div>

      {sent && marker && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={codeBox}>
            <div style={{ fontSize: '12px', color: '#64748b' }}>앱 목록에서 찾을 제목</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', letterSpacing: '0.5px' }}>{marker}</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>
              보낸 시각(KST) <strong style={{ color: '#0f172a' }}>{formatKst(sent.sentAt)}</strong>
              {sendState === 'confirmed' && sent.eventId ? <> · Sentry 응답 확인 · event {sent.eventId.slice(0, 8)}…</> : null}
            </div>
          </div>

          {sendFailed && (
            <div style={danger}>
              <strong>전송이 확인되지 않았습니다.</strong> {AD_BLOCKER_HINT}
              {sendCode ? ` (Sentry 응답 ${sendCode})` : ''}
            </div>
          )}

          <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Step
              done={sendState === 'confirmed'}
              active={sendState === 'pending'}
              failed={sendFailed}
              label="브라우저에서 보냄"
              detail={
                sendState === 'pending'
                  ? 'Sentry 응답 기다리는 중…'
                  : sendFailed
                    ? '응답 없음 — 위 안내를 보세요'
                    : `fingerprint: portfolio-visitor-test / ${sent.code}`
              }
            />
            <Step
              done={stage === 'found'}
              active={stage === 'polling'}
              label="Sentry 수집"
              detail={
                stage === 'found'
                  ? '수집 완료'
                  : stage === 'timeout'
                    ? '3분 안에 확인되지 않았습니다'
                    : '보통 수십 초 — 백엔드 목록 캐시(60초)까지 합쳐 최대 2분'
              }
            />
            <Step
              done={stage === 'found'}
              active={stage === 'polling'}
              failed={stage === 'timeout'}
              label="앱 목록에 노출 (GET /ops/incidents — 앱과 같은 API)"
              detail={
                stage === 'found' && found
                  ? `확인 · 인시던트 #${found.id}${found.firstSeen ? ` · 첫 발생(KST) ${formatKst(found.firstSeen)}` : ''}`
                  : stage === 'polling'
                    ? `20초마다 확인 중… (${attempts}/${POLL_MAX_ATTEMPTS})${pollError ? ` — 마지막 조회 실패: ${pollError}` : ''}`
                    : stage === 'timeout'
                      ? (
                          <span style={{ color: '#b91c1c', fontWeight: 600 }}>
                            3분 동안 보이지 않았습니다. {AD_BLOCKER_HINT} 차단기가 아니라면 앱 목록을 당겨서 새로고침해 보세요(캐시 만료 후 재조회).
                          </span>
                        )
                      : ''
              }
            />
          </ol>

          {stage === 'found' && found && (
            <div style={okBox}>
              <div style={{ fontWeight: 700, color: '#166534' }}>
                앱 목록에 노출됐습니다 — 앱 상세의 &quot;처음 N분 전&quot; 이 위 보낸 시각과 맞는지 보세요.
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {isAndroid && (
                  <a href={appDeepLink(found.id)} style={deepLinkBtn}>
                    앱에서 열기
                  </a>
                )}
                <a href={webTrialLink(found.id)} target="_blank" rel="noreferrer" style={webTrialBtn}>
                  웹 체험판에서 열기
                </a>
              </div>
              <div style={{ fontSize: '13px', color: '#166534' }}>
                {isAndroid
                  ? '앱을 설치했다면 "앱에서 열기", 아니라면 웹 체험판으로 같은 인시던트를 엽니다.'
                  : `웹 체험판(아이폰·PC)에서 데모 로그인하면 이 인시던트로 바로 이동합니다. 안드로이드 폰에서 이 페이지를 열면 설치한 앱으로 여는 "앱에서 열기"(${appDeepLink(found.id)})도 나타납니다.`}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <h3 style={h3}>앱에서 할 일</h3>
        <ol style={{ margin: 0, paddingLeft: '20px', color: '#334155', fontSize: '14px', lineHeight: 1.7 }}>
          <li>
            인시던트 목록에서 <strong>{marker ?? '[방문자 테스트 XXXX]'}</strong> 를 찾습니다(또는 위 &quot;앱에서 열기&quot; · &quot;웹 체험판에서 열기&quot;).
            안 보이면 목록을 당겨서 새로고침 — 백엔드 캐시가 60초입니다.
          </li>
          <li>상세의 &quot;처음 N분 전&quot; 을 위 보낸 시각과 비교합니다 — 미리 심은 데이터로는 못 만드는 값입니다.</li>
          <li>
            <strong>AI 분석</strong>을 누릅니다. 분석이 이 페이지의 소스 파일(<code>ops-app/visitor-test.ts</code>)을 GitHub 에서 읽고
            &quot;의도된 테스트 에러&quot; 라고 답하는지 보세요. 데모 계정의 새 분석은 <strong>시간당 6건</strong>(방문자 합산) — 한도면
            이미 분석된 다른 인시던트로 이어서 보세요.
          </li>
          <li>
            <strong>평가 탭</strong>에서 그 분석을 채점(승인/반려·별점)한 뒤, 분석 화면을 다시 열면 &quot;내 판정&quot; 이 보입니다.
            데모 계정의 채점은 저장되지만 집계에는 들어가지 않습니다.
          </li>
        </ol>
      </div>
    </section>
  );
}

function Step({
  done,
  active,
  failed,
  label,
  detail,
}: {
  done: boolean;
  active?: boolean;
  failed?: boolean;
  label: string;
  detail: ReactNode;
}) {
  const color = done ? '#16a34a' : failed ? '#dc2626' : active ? '#2563eb' : '#94a3b8';
  return (
    <li style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 700,
          color: '#fff',
          background: color,
        }}
      >
        {done ? '✓' : failed ? '!' : active ? '…' : ''}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: done ? '#0f172a' : failed ? '#b91c1c' : '#475569' }}>{label}</span>
        {detail ? <span style={{ fontSize: '12px', color: '#64748b' }}>{detail}</span> : null}
      </span>
    </li>
  );
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};
const h2: React.CSSProperties = { margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' };
const h3: React.CSSProperties = { margin: '0 0 6px', fontSize: '14px', fontWeight: 700, color: '#0f172a' };
const muted: React.CSSProperties = { margin: 0, fontSize: '14px', color: '#475569', lineHeight: 1.6 };
const warn: React.CSSProperties = {
  background: '#fef3c7',
  border: '1px solid #fcd34d',
  color: '#78350f',
  borderRadius: '8px',
  padding: '10px 12px',
  fontSize: '13px',
};
const danger: React.CSSProperties = {
  background: '#fef2f2',
  border: '1px solid #fca5a5',
  color: '#b91c1c',
  borderRadius: '8px',
  padding: '10px 12px',
  fontSize: '13px',
  lineHeight: 1.6,
};
const codeBox: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px dashed #cbd5e1',
  borderRadius: '8px',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};
const okBox: React.CSSProperties = {
  background: '#f0fdf4',
  border: '1px solid #86efac',
  borderRadius: '8px',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};
const deepLinkBtn: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: '10px 16px',
  borderRadius: '8px',
  background: '#16a34a',
  color: '#fff',
  fontSize: '14px',
  fontWeight: 700,
  textDecoration: 'none',
};
const webTrialBtn: React.CSSProperties = {
  ...deepLinkBtn,
  background: '#fff',
  color: '#166534',
  border: '1px solid #16a34a',
};
