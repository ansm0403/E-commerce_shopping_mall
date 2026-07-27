//@ts-check

// ============================================================
// [OPT-1] Bundle Analyzer
// 측정 대상: 페이지별 JS 번들 크기 (First Load JS)
// 측정 방법: ANALYZE=true yarn nx build frontend → 브라우저에서 .next/analyze/*.html 열기
// 기대 효과: 불필요하게 큰 청크 식별 → dynamic import 대상 파악
// ============================================================
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: true,
});

const { composePlugins, withNx } = require('@nx/next');
const { withSentryConfig } = require('@sentry/nextjs');

// ============================================================
// [nginx+HTTPS 방식] — 향후 EC2에 도메인 + Nginx + Let's Encrypt 적용 시 사용
// 전환 절차: docs/Modify-proxy.md 참고
// 이 방식에서는 브라우저가 https://api.yourdomain.com 을 직접 호출하므로
// CSP connectSrc에 API 도메인을 명시해야 한다.
// ============================================================
// const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/v1';
// const apiOrigin = new URL(apiUrl).origin;

// const isDev = process.env.NODE_ENV !== 'production';

// const connectSrc = [
//   "'self'",
//   apiOrigin,                                    // API 서버 (로컬이든 Elastic IP든)
//   ...(isDev ? ['ws://localhost:3000'] : []),    // 개발 환경에서만 HMR WebSocket 허용
//   'https://*.portone.io',
//   'https://*.iamport.co',
// ].join(' ');

// ============================================================
// [프록시 방식] — 현재 활성
// 브라우저 → Vercel /api/* → EC2 (서버사이드 프록시)
// 브라우저 입장에서 API 요청은 같은 오리진(Vercel)이므로 'self'만으로 충분
// nginx+HTTPS 전환 시: 이 블록 주석 처리 후 위 nginx+HTTPS 블록 활성화
// ============================================================
const isDev = process.env.NODE_ENV !== 'production';

const connectSrc = [
  "'self'",  // 프록시 덕에 같은 오리진으로 충분
  ...(isDev ? ['http://localhost:4000', 'ws://localhost:3000'] : []),  // 로컬 개발용
  'https://*.portone.io',
  'https://*.iamport.co',
].join(' ');

/**
 * @type {import('@nx/next/plugins/with-nx').WithNxOptions}
 **/
const nextConfig = {
  // Use this to set Nx-specific options
  // See: https://nx.dev/recipes/next/next-config-setup
  nx: {},
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,

  // standalone 빌드 시 런타임에 불필요한 빌드 전용 대형 바이너리 제외
  // 이 파일들은 빌드 도구용이므로 프로덕션 서버 실행에 필요하지 않음
  outputFileTracingExcludes: {
    '*': [
      'node_modules/@rspack/**',
      'node_modules/@swc/**',
      'node_modules/esbuild/**',
      'node_modules/webpack/**',
      'node_modules/terser/**',
      'node_modules/rollup/**',
      'node_modules/@nx/**',
      'node_modules/nx/**',
    ],
  },

  // 모노레포 패키지 transpile 설정
  transpilePackages: ['@shopping-mall/shared'],

  // ============================================================
  // [OPT-7] next/image remotePatterns
  // 측정 대상: LCP (Largest Contentful Paint) — 이미지 최적화로 WebP 변환 + CDN 캐시
  // 측정 방법: Lighthouse > Performance > LCP / Network 탭 > 이미지 응답 Content-Type
  // 기대 효과: WebP 변환으로 이미지 30~50% 용량 절감, Vercel Edge 캐시로 반복 요청 가속
  // 주의: 이미지 URL 도메인이 여기 없으면 빌드 에러 → EC2 IP 변경 시 이 목록도 갱신 필요
  // ============================================================

  // 보안 헤더 설정 (CSP 포함)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.portone.io https://*.iamport.co", // Next.js 개발 서버 + 포트원 SDK
              "style-src 'self' 'unsafe-inline'", // emotion/styled-components용
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              `connect-src ${connectSrc}`, // API + HMR + 포트원
              "frame-src https://*.portone.io https://*.iamport.co https://*.kakaopay.com https://*.kakao.com", // 포트원 결제창 iframe + 카카오페이
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },

  // Webpack 설정: .js 확장자를 .ts로도 resolve + customConditions 추가
  webpack: (config, { isServer, nextRuntime }) => {
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
      '.jsx': ['.jsx', '.tsx'],
    };
    // 모노레포 소스 직접 참조를 위한 customConditions.
    // 런타임별 조건(browser/edge-light)을 함께 넣어야 @sentry/nextjs 등
    // 조건부 export 패키지가 올바른 빌드로 resolve된다.
    // (이게 없으면 클라이언트 번들이 node 빌드를 끌어와 node:async_hooks에서 깨짐)
    config.resolve.conditionNames = [
      '@shopping-mall/source',
      ...(!isServer ? ['browser'] : []),
      ...(nextRuntime === 'edge' ? ['edge-light'] : []),
      'import',
      'module',
      'require',
      'default',
    ];

    // 클라이언트 사이드에서 axios 브라우저 빌드 강제 사용
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        axios: require.resolve('axios/dist/browser/axios.cjs'),
      };

      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        http2: false,
        zlib: false,
      };
    }

    return config;
  },

  // ============================================================
  // [프록시 방식] — 현재 활성
  // /api/* 요청을 EC2 백엔드로 서버사이드 프록시
  // nginx+HTTPS 전환 시: 이 rewrites 블록 전체를 주석 처리 또는 제거
  // Vercel 환경변수 API_PROXY_TARGET 도 함께 제거
  // ============================================================
  async rewrites() {
  const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:4000/v1';
  // 업로드 이미지는 /v1 프리픽스 없이 서빙된다(backend main.ts express.static) — API 타깃에서 /v1만 뗀다.
  const uploadsTarget = apiTarget.replace(/\/v1\/?$/, '');
  return [
    {
      source: '/api/:path*',
      destination: `${apiTarget}/:path*`,
    },
    {
      source: '/uploads/:path*',
      destination: `${uploadsTarget}/uploads/:path*`,
    },
  ];
  },

  // 개발 환경에서 Hot Reload 개선
  ...(process.env.NODE_ENV === 'development' && {
    webpackDevMiddleware: config => {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      }
      return config
    },
  }),
};

const plugins = [
  // [OPT-1] Bundle Analyzer: ANALYZE=true 환경에서만 활성화
  withBundleAnalyzer,
  withNx,
];

// ============================================================
// Sentry: Nx 플러그인 합성 결과를 withSentryConfig로 한 번 더 감싼다.
// - 클라이언트/서버 에러를 Sentry로 전송 (DSN은 NEXT_PUBLIC_SENTRY_DSN)
// - 소스맵 업로드는 SENTRY_AUTH_TOKEN + org/project 가 있을 때만 동작(없으면 자동 스킵)
//   → Vercel에 SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN 설정 시 활성화
// ============================================================
module.exports = withSentryConfig(composePlugins(...plugins)(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI, // CI에서만 로그 출력
  widenClientFileUpload: true,
  disableLogger: true, // Sentry 로거 코드 제거로 번들 절감
  // 터널링: 브라우저 이벤트를 sentry.io가 아니라 같은 오리진(/monitoring)으로 보내
  // 광고차단기/추적방지의 차단을 우회한다. (운영에서도 이벤트 유실 방지)
  tunnelRoute: '/monitoring',
});
