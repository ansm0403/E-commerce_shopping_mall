# 프론트 (`frontend/src`) — 규칙·함정

> 프론트 파일을 읽을 때 자동 로드된다. 완료 기록·경위는 쓰지 않는다(→ `docs/roadmap/`).

- **라우트 그룹**: `(auth)`(로그인/회원가입/이메일인증) · `(main)`(상점·구매·`/my/*`) · `(seller)`(`/seller/*`) · `(admin)`(`/admin/*`). 셀러·관리자는 쇼핑몰 헤더·푸터가 없는 콘솔 셸(`components/console/`)을 같이 쓴다 — 셸을 고치면 `scripts/seller-console/admin-screenshots.mjs` 로 관리자 화면 전후를 바이트 비교한다. 콘솔의 넓은 표는 `tableScrollStyle` 래퍼로 감싼다(없으면 폰에서 오른쪽 열이 잘린다).
- **HTTP**: `lib/axios/axios-http-client.ts` 의 `publicClient`/`authClient`. authClient 는 Bearer 부착 + 401 시 동시성 안전 refresh. access 토큰은 rememberMe 에 따라 local/sessionStorage, refresh 는 httpOnly 쿠키 — 쿠키는 BFF `app/api/auth/{login,refresh,logout}/route.ts` 가 Vercel 도메인으로 재발급한다. API 에러 보고 `lib/axios/report-api-error.ts`.
- **프록시**: `next.config.js` rewrites `/api/:path* → ${API_PROXY_TARGET||http://localhost:4000/v1}/:path*` + `/uploads/:path*`(v1 을 뗀 타깃). nginx 도입 후에도 **유지** — Vercel 의 `API_PROXY_TARGET` 만 `https://api.ansmoon.dev/v1`. 파일 안의 "nginx 전환 시 rewrites 제거" 주석은 폐기된 설계(03-infra-nginx §10 12-4).
- **데이터**: TanStack Query(`providers/`, `lib/react-query/`, `hooks/*query-options`). 전역 인증 상태 `contexts/AuthContext.tsx`. 서버 컴포넌트 패칭은 `lib/server-api.ts`.
- **라우트 보호**: `middleware.ts` 는 `/admin/*`·`/seller/*` 만(refreshToken 쿠키 검사 → 없으면 로그인). 역할 검증은 `AdminGuard`·`SellerGuard` 가 `/auth/me` 로. 구매자 화면(`/my/*`·`cart`·`checkout`)은 `hooks/useRequireAuth` — 화면에 `isHydrated && !user` 판정을 새로 쓰지 않는다(새로고침 튕김 버그의 원인이었다).
- **폼**: `components/forms/BaseForm`(react-hook-form) + zod 스키마는 `lib/validation/` 에 두고 백엔드 DTO 의 경계값·출처 파일을 주석으로 단다. 성공 후 초기화는 `key` 를 바꿔 새로 만든다(BaseForm 이 reset 을 내주지 않는다).
- **테스트 대상 선택**: 로직이 있는 순수 함수·훅·서비스에 단위 테스트, 화면은 `scripts/buyer-flow/`·`scripts/ai-chat/` 의 Playwright 확인 스크립트(운영 빌드 `next build`+`next start` 대상 — `next dev` 는 세션이 길어지면 컴파일 지연으로 시간 초과). `lib/jwt.ts` 는 **서명 검증이 아니다** — UI 판단용(셀러 승인 뒤 낡은 토큰 감지 → refresh 1회).
- **레이어**: `service/`(도메인별 API 클라이언트) · `model/`(타입) · `components/` · `hooks/`(신규) · `hook/`(레거시 — `useAuthMutation`·`useProduct` 만) · `lib/charts/`(ECharts 빌더). 공용 타입은 `@shopping-mall/shared`.
- **FormData 업로드**는 `Content-Type` 헤더를 지운다(브라우저가 boundary 를 붙이게 — `service/seller-product.ts`).
- **Sentry**: 광고 차단기가 터널 `/monitoring?o=…` 까지 막는다 — event id 는 전송 증거가 아니다(`afterSendEvent` 로 확인, `(admin)/admin/ops-app`).
- **CI**: spec 하나만 추가해도 CI 에서 frontend `eslint .` 전체가 돈다 — PR 전에 로컬 eslint 에러 0 확인.
