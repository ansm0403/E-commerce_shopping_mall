import Script from 'next/script';
import Header from '../../components/header/Header';
import Footer from '../../components/footer/Footer';
import MaxWidthContainer from '../../components/layout/MaxWidthContainer';

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="magazine-store">
      <Script src="https://cdn.portone.io/v2/browser-sdk.js" strategy="afterInteractive" />
      {/* 키보드 사용자가 헤더(Tab 15회)를 건너뛰고 본문으로 — 포커스를 받을 때만 보인다 */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[1000] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-white focus:text-indigo-700 focus:font-semibold focus:shadow-lg focus:ring-2 focus:ring-indigo-600"
      >
        본문으로 건너뛰기
      </a>
      <Header />
      {/* tabIndex=-1: 건너뛰기 링크로 이동했을 때 포커스가 실제로 본문에 놓여 다음 Tab 이 본문 첫 요소로 간다 */}
      <main id="main-content" tabIndex={-1} className="outline-none scroll-mt-48">
        <MaxWidthContainer>
          {children}
        </MaxWidthContainer>
      </main>
      <Footer />
    </div>
  );
}
