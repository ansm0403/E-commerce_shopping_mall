/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // 브랜드 = 흑백. 상품 사진이 색을 내므로 UI 는 색을 빼고, 강조는 accent(할인·가격) 하나만 쓴다.
        // 600 이 기본(버튼·선택 상태), 700 은 hover — 검정에서 더 어두워질 곳이 없어 한 단계 **밝게** 둔다(순서가 뒤집힌 의도적 예외).
        primary: {
          50:  '#f5f5f5',
          100: '#ebebeb',
          200: '#d6d6d6',
          300: '#b0b0b0',
          400: '#6b6b6b', // 보조 글자 — 흰 바탕 대비 5.3:1(AA). 더 밝히면 axe 대비 위반
          500: '#4a4a4a',
          600: '#111111', // main
          700: '#333333', // hover
          800: '#000000', // active
          900: '#000000',
        },
        accent: {
          50:  '#fff1f0',
          100: '#ffe0dd',
          600: '#dc2f2a', // 할인율·특가 — 흰 바탕 대비 4.68:1(AA). #e5322d 는 4.35 로 axe 위반
          700: '#c4231f',
        },
        secondary: {
          50:  '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b', // main
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
      },
      keyframes: {
        fadeInScale: {
          '0%':   { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fadeInScale': 'fadeInScale 0.15s ease-out',
      },
      // z-index 레이어 체계 — 숫자 대신 의미 있는 이름으로 관리
      // 레이어 간격을 10씩 두어 중간에 추가할 여지를 남김
      zIndex: {
        'base':       '0',    // 기본 컨텐츠
        'raised':     '10',   // 살짝 띄워야 하는 요소 (카드 hover 등)
        'banner':     '20',   // 배너 내부 요소 (오버레이, CTA 버튼)
        'header':     '30',   // 헤더 자체
        'dropdown':   '40',   // 드롭다운, 팝오버
        'sticky':     '50',   // sticky 헤더/사이드바
        'modal-bg':   '60',   // 모달 배경 딤처리
        'modal':      '70',   // 모달 본체
        'toast':      '80',   // 토스트 알림
      },
    },
  },
  plugins: [],
};
