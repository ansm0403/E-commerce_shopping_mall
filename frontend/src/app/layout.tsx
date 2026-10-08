
import './global.css';
import NextTopLoader from 'nextjs-toploader';
import ReactQueryProvider from '../providers/reactQuery-provider';
import AuthContextProvider from '../contexts/AuthContext';
import SplashScreen from '../components/SplashScreen/SplashScreen';

export const metadata = {
  title: { default: 'SHOPMALL | 일상에 더하는 새로운 취향', template: '%s | SHOPMALL' },
  description: '의류, 뷰티, 신발, 책, 식품, 생활용품까지. 일상을 채우는 새로운 취향을 SHOPMALL에서 발견하세요.',
};

// <head> 안에서 동기적으로 실행되어 body가 페인트되기 전에 data-splash를 설정한다.
// 이 덕분에 메인 페이지가 순간적으로 보이는 깜빡임(FOUC)이 사라진다.
const splashInitScript = `(function(){try{if(!sessionStorage.getItem('shopping-mall-splash-shown')){document.documentElement.setAttribute('data-splash','active');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/*
         * [OPT-8] preconnect / dns-prefetch — 외부 도메인 연결 선행 처리
         *
         * preconnect: DNS 조회 + TCP 핸드셰이크 + TLS 협상을 HTML 파싱 시점에 미리 수행
         * dns-prefetch: DNS 조회만 선행 (preconnect보다 가벼움, 보조 수단)
         *
         * 적용 대상:
         *   - PortOne: 결제 SDK가 로드하는 도메인 (모든 페이지 head에 미리 연결)
         *
         * ─── 측정 방법 ─────────────────────────────────────────────
         * 도구: Chrome DevTools > Network > 연결 타임라인
         * 측정 지표: SDK 도메인의 첫 요청 시 "Stalled / DNS Lookup / Initial connection" 시간
         * 비교 방법:
         *   1. DevTools > Network > 컬럼 우클릭 → "Connection ID" 체크
         *   2. preconnect 없을 때: portone SDK 요청에 "DNS Lookup + SSL" 표시 (~100-300ms)
         *   3. preconnect 있을 때: 해당 단계 없거나 < 5ms
         */}
        <link rel="preconnect" href="https://cdn.portone.io" />
        <link rel="dns-prefetch" href="https://cdn.portone.io" />
        <link rel="preconnect" href="https://api.portone.io" />
        <link rel="dns-prefetch" href="https://api.portone.io" />

        {/* Pretendard(OFL) 자체 호스팅 — CSP font-src 'self' 라 CDN 을 못 쓴다. 분할 버전이라 쓰인 글자 조각만 받는다 */}
        {/* eslint-disable-next-line @next/next/no-css-tags -- 92개 분할 woff2 를 상대경로로 부르는 CSS 라 번들에 넣지 않고 public 에서 그대로 쓴다 */}
        <link rel="stylesheet" href="/fonts/pretendard/pretendardvariable-dynamic-subset.css" />

        <script dangerouslySetInnerHTML={{ __html: splashInitScript }} />
      </head>
      <body>
        <SplashScreen />
        <NextTopLoader />
        <ReactQueryProvider>
          <AuthContextProvider>
            {children}
          </AuthContextProvider>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
