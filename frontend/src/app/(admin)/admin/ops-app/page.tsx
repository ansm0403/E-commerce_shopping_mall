import LinkCheckSection from './components/LinkCheckSection';

/**
 * 관리자 "운영 앱" 페이지 — RN 운영 앱(Ops Companion)의 웹 쪽 입구 (설계 §9 "웹 → 앱 연동 확인" 결정 ⑧).
 * 앱이 무엇인지 → 설치(링크·QR·데모 계정) → 연동 확인(버튼 + 추적기 + 딥링크) → 앱에서 할 일.
 *
 * 백엔드 호출은 연동 확인 절(클라이언트 컴포넌트)의 `GET /ops/incidents` 뿐이라 DemoAccountGuard 대상이 아니다.
 * AdminGuard 는 (admin) layout 이 이미 건다.
 */

/**
 * preview 빌드 설치 링크 — `ops-companion/README.md` "설치해서 써 보기" 와 같은 값. 빌드마다 바뀐다(QR 도 같이 재생성).
 * expo.dev 빌드 **페이지**(`/accounts/…/builds/<id>`)가 아니라 **APK 아티팩트 직링크**다 — 페이지는 로그인하지 않은 방문자에게
 * "Something went wrong" 을 보여줬다(2026-09-23 실기기). 직링크는 익명 200(≈108MB). EAS 아티팩트는 빌드 후 14일에 만료된다.
 */
const INSTALL_URL = 'https://expo.dev/artifacts/eas/hzxaIa-NMrH-AITYKN2Vz7zJdqMdvuaFEWwjkdTQV1E.apk';
const INSTALL_BUILD_LABEL = 'preview 빌드 versionCode 4 · 2026-09-23 · Android APK 약 108MB';
/** `npx qrcode -o frontend/public/images/ops-app-install-qr.png -w 220 "<INSTALL_URL>"` 로 만든 정적 PNG(외부 이미지 도메인 없음 — CSP) */
const INSTALL_QR_SRC = '/images/ops-app-install-qr.png';

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
          이 페이지는 그 고리의 첫 칸, "실제 장애가 들어온다" 를 방문자가 스스로 확인하는 곳입니다 — 아래 버튼이 만든 에러가
          앱에 나타나면, 앱이 보여주는 다른 인시던트도 같은 길로 들어온 실제 데이터입니다.
        </p>
      </section>

      <section style={card}>
        <h2 style={h2}>설치 (Android)</h2>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- 정적 QR PNG, 최적화 불필요 */}
          <img
            src={INSTALL_QR_SRC}
            alt="운영 앱 설치 링크 QR"
            width={160}
            height={160}
            style={{ border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff', flexShrink: 0 }}
          />
          <ol style={{ margin: 0, paddingLeft: '20px', color: '#334155', fontSize: '14px', lineHeight: 1.7, flex: 1, minWidth: 260 }}>
            <li>
              폰에서 설치 링크를 엽니다(QR 을 찍어도 됩니다):{' '}
              <a href={INSTALL_URL} target="_blank" rel="noreferrer" style={{ color: '#2563eb', wordBreak: 'break-all' }}>
                {INSTALL_URL}
              </a>
              <div style={{ fontSize: '12px', color: '#64748b' }}>{INSTALL_BUILD_LABEL}. 스토어 밖 APK 라 "출처를 알 수 없는 앱 설치" 를 한 번 허용해야 합니다. iOS 는 지원하지 않습니다.</div>
            </li>
            <li>
              앱을 열고 로그인 화면의 <strong>"데모 계정으로 체험하기"</strong> 를 누릅니다 — 지금 이 웹의 "관리자 페이지 체험하기" 와
              같은 데모 관리자 계정입니다. 계정 정보를 입력할 필요가 없습니다.
            </li>
            <li>
              보이는 것은 실제 운영 Sentry 데이터(최근 14일)입니다. 데모 계정은 조회·AI 분석·채점이 되고, 재분석·메모 저장·푸시 알림은 꺼져
              있습니다(새 분석은 시간당 6건, 방문자 합산).
            </li>
          </ol>
        </div>
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
