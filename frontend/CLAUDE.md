# 프론트 (`frontend/src`) — 규칙·함정

> 프론트 파일을 읽을 때 자동 로드된다. 완료 기록·경위는 쓰지 않는다(→ `docs/roadmap/`).

- **라우트 그룹**: `(auth)`(로그인/회원가입/이메일인증) · `(main)`(상점·구매·`/my/*`·`/seller/*`) · `(admin)`(`/admin/*`).
- **HTTP**: `lib/axios/axios-http-client.ts` 의 `publicClient`/`authClient`. authClient 는 Bearer 부착 + 401 시 동시성 안전 refresh. access 토큰은 rememberMe 에 따라 local/sessionStorage, refresh 는 httpOnly 쿠키 — 쿠키는 BFF `app/api/auth/{login,refresh,logout}/route.ts` 가 Vercel 도메인으로 재발급한다. API 에러 보고 `lib/axios/report-api-error.ts`.
- **프록시**: `next.config.js` rewrites `/api/:path* → ${API_PROXY_TARGET||http://localhost:4000/v1}/:path*` + `/uploads/:path*`(v1 을 뗀 타깃). nginx 도입 후에도 **유지** — Vercel 의 `API_PROXY_TARGET` 만 `https://api.ansmoon.dev/v1`. 파일 안의 "nginx 전환 시 rewrites 제거" 주석은 폐기된 설계(03-infra-nginx §10 12-4).
- **데이터**: TanStack Query(`providers/`, `lib/react-query/`, `hooks/*query-options`). 전역 인증 상태 `contexts/AuthContext.tsx`. 서버 컴포넌트 패칭은 `lib/server-api.ts`.
- **라우트 보호**: `middleware.ts` 는 `/admin/*` 만(refreshToken 쿠키 검사 → 없으면 로그인). 역할 검증은 `AdminGuard`·`SellerGuard` 가 `/auth/me` 로. `lib/jwt.ts` 는 **서명 검증이 아니다** — UI 판단용(셀러 승인 뒤 낡은 토큰 감지 → refresh 1회).
- **레이어**: `service/`(도메인별 API 클라이언트) · `model/`(타입) · `components/` · `hooks/`(신규) · `hook/`(레거시 — `useAuthMutation`·`useProduct` 만) · `lib/charts/`(ECharts 빌더). 공용 타입은 `@shopping-mall/shared`.
- **FormData 업로드**는 `Content-Type` 헤더를 지운다(브라우저가 boundary 를 붙이게 — `service/seller-product.ts`).
- **Sentry**: 광고 차단기가 터널 `/monitoring?o=…` 까지 막는다 — event id 는 전송 증거가 아니다(`afterSendEvent` 로 확인, `(admin)/admin/ops-app`).
- **CI**: spec 하나만 추가해도 CI 에서 frontend `eslint .` 전체가 돈다 — PR 전에 로컬 eslint 에러 0 확인.
