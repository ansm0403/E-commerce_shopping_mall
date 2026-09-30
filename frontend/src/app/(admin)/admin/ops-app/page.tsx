import LinkCheckSection from './components/LinkCheckSection';
import { ANDROID_INSTALL_URL, OPS_WEB_URL } from './links';

/**
 * 관리자 "운영 앱" 페이지 — RN 운영 앱(Ops Companion)의 웹 쪽 입구 (설계 §9 "웹 → 앱 연동 확인" 결정 ⑧).
 * 앱이 무엇인지 → 설치(링크·QR·데모 계정) → 연동 확인(버튼 + 추적기 + 딥링크) → 앱에서 할 일.
 *
 * 백엔드 호출은 연동 확인 절(클라이언트 컴포넌트)의 `GET /ops/incidents` 뿐이라 DemoAccountGuard 대상이 아니다.
 * AdminGuard 는 (admin) layout 이 이미 건다.
 */

/**
 * 설치 링크는 **고정 주소**(`ANDROID_INSTALL_URL` = 웹 체험판 도메인의 `/android`)다. 실제 APK 는 GitHub Release 자산이고
 * (expo.dev 빌드 페이지는 익명 방문자에게 오류, EAS 직링크는 14일 만료 — Release 는 만료 없음) `ops-companion/vercel.json` 의
 * redirect 가 그리로 보낸다. 새 빌드 때 바꿀 것 = vercel.json destination + 아래 라벨. QR 은 다시 만들지 않는다.
 */
const INSTALL_BUILD_LABEL = 'preview 빌드 versionCode 4 · 2026-09-23 · Android APK 약 108MB';
/** `npx qrcode -o frontend/public/images/ops-app-install-qr.png -w 220 -m 2 "<ANDROID_INSTALL_URL>"` 로 만든 정적 PNG(외부 이미지 도메인 없음 — CSP) */
const INSTALL_QR_SRC = '/images/ops-app-install-qr.png';
/** `npx qrcode -o frontend/public/images/ops-app-web-qr.png -w 220 -m 2 "<OPS_WEB_URL>"` — 웹 체험판(2026-09-30) */
const WEB_QR_SRC = '/images/ops-app-web-qr.png';

export default function AdminOpsAppPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '920px' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>운영 앱 — Ops Companion</h1>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
          쇼핑몰 운영자용 온콜 앱(React Native). 이 페이지에서 설치하고, 웹과 앱이 같은 운영 데이터를 본다는 것을 직접 확인합니다.
        </p>
      </header>

      <section style={card}>
        <h2 style={h2}>무엇인가</h2>
        <p style={p}>
          Sentry 에 들어온 쇼핑몰(프론트·백엔드) 장애를 폰에서 보고, AI 가 <strong>실제 소스 코드를 GitHub 에서 읽어</strong> 원인과
          조치를 분석하고, 사람이 그 답을 채점하는 앱입니다. 채점 결과는 다음 분석의 프롬프트·도구를 고치는 근거가 됩니다
          (Sentry → 앱 → AI 분석 → 사람 채점 → 개선). 푸시 알림·딥링크·생체 잠금·소스맵까지 운영 백엔드와 붙어 돕니다.
        </p>
        <p style={{ ...p, fontSize: '13px', color: '#64748b' }}>
          이 페이지는 그 고리의 첫 칸, &quot;실제 장애가 들어온다&quot; 를 방문자가 스스로 확인하는 곳입니다 — 아래 버튼이 만든 에러가
          앱에 나타나면, 앱이 보여주는 다른 인시던트도 같은 길로 들어온 실제 데이터입니다.
        </p>
      </section>

      <section style={card}>
        <h2 style={h2}>설치 · 체험</h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={option}>
            <h3 style={h3}>Android — 앱 설치</h3>
            {/* eslint-disable-next-line @next/next/no-img-element -- 정적 QR PNG, 최적화 불필요 */}
            <img src={INSTALL_QR_SRC} alt="운영 앱 설치 링크 QR" width={140} height={140} style={qr} />
            <p style={small}>
              폰에서 QR 을 찍거나{' '}
              <a href={ANDROID_INSTALL_URL} target="_blank" rel="noreferrer" style={link}>
                설치 링크(APK)
              </a>
              를 엽니다. 스토어 밖 APK 라 &quot;출처를 알 수 없는 앱 설치&quot; 를 한 번 허용해야 합니다. 푸시·생체 잠금까지 전부 됩니다.
            </p>
            <p style={{ ...small, color: '#94a3b8' }}>{INSTALL_BUILD_LABEL}</p>
          </div>
          <div style={option}>
            <h3 style={h3}>iPhone · PC — 웹 체험판</h3>
            {/* eslint-disable-next-line @next/next/no-img-element -- 정적 QR PNG, 최적화 불필요 */}
            <img src={WEB_QR_SRC} alt="운영 앱 웹 체험판 QR" width={140} height={140} style={qr} />
            <p style={small}>
              설치 없이{' '}
              <a href={OPS_WEB_URL} target="_blank" rel="noreferrer" style={link}>
                {OPS_WEB_URL.replace('https://', '')}
              </a>{' '}
              를 엽니다. 같은 React Native 코드를 웹으로 내보낸 것이라 화면·기능이 같고, 푸시·생체 잠금만 없습니다. iPhone 은 APK 를 설치할 수
              없어 이 길로 체험합니다.
            </p>
          </div>
        </div>
        <ol style={{ margin: 0, paddingLeft: '20px', color: '#334155', fontSize: '14px', lineHeight: 1.7 }}>
          <li>
            로그인 화면의 <strong>&quot;데모 계정으로 체험하기&quot;</strong> 를 누릅니다 — 지금 이 웹의 &quot;관리자 페이지 체험하기&quot; 와 같은
            데모 관리자 계정입니다. 계정 정보를 입력할 필요가 없습니다.
          </li>
          <li>
            보이는 것은 실제 운영 Sentry 데이터(최근 14일)입니다. 데모 계정은 조회·AI 분석·채점이 되고, 재분석·메모 저장·푸시 알림은 꺼져
            있습니다(새 분석은 시간당 6건, 방문자 합산).
          </li>
        </ol>
      </section>

      <LinkCheckSection />

      <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
        설계·학습 노트: 저장소 <code>docs/roadmap/ops-companion-design.md</code> §9, <code>docs/learning/ops-companion/</code>,
        앱 실행법 <code>ops-companion/README.md</code>.
      </p>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};
const h2: React.CSSProperties = { margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' };
const p: React.CSSProperties = { margin: 0, fontSize: '14px', color: '#334155', lineHeight: 1.7 };
const h3: React.CSSProperties = { margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' };
const option: React.CSSProperties = {
  flex: '1 1 260px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '16px',
  border: '1px solid #e2e8f0',
  borderRadius: '10px',
};
const qr: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff' };
const small: React.CSSProperties = { margin: 0, fontSize: '13px', color: '#475569', lineHeight: 1.6 };
const link: React.CSSProperties = { color: '#2563eb', wordBreak: 'break-all' };
