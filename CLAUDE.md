# 쇼핑몰 모노레포 — 프로젝트 컨텍스트

> 매 세션 주입되는 지속 컨텍스트 — **규칙·위치·함정만** 적는다. 경과·수치·커밋/PR·날짜 서사는 여기 쓰지 않는다
> (완료 기록 → `docs/roadmap/` 해당 문서, 운영 앱 → `docs/learning/ops-companion/`).
> 영역별 규칙은 하위 `CLAUDE.md`(`backend/` · `frontend/` · `ops-companion/` · `docs/etc/data-flow/`) — 그 폴더 파일을 **Read/Edit/Write 도구로** 다룰 때만 자동 로드된다.
> 그래서 **소스 파일 내용은 Bash `cat`/`head`/`sed` 가 아니라 Read 도구로 읽는다**(Bash 로 읽으면 하위 규칙이 붙지 않는다). 검색(Grep/Glob)은 그대로 써도 된다.

## 1. 개요 / 스택
- 풀스택 쇼핑몰 모노레포(포트폴리오/실서비스). **Nx 21 + Yarn(berry)**, 공용 타입 `@shopping-mall/shared`.
- 백엔드 NestJS 11 + TypeORM + PostgreSQL 18 + Redis · 프론트 Next.js(App Router, React 19) + TanStack Query + axios + ECharts · 운영 앱 Expo SDK 57(RN).
- 배포: 프론트 **Vercel**, 백엔드 **AWS EC2** Docker Compose(postgres+redis+backend+nginx+certbot). 공개 진입점 `https://api.ansmoon.dev`(nginx 443 → backend 4000 내부 전용). 브라우저는 Vercel rewrites(`/api/*`) same-origin 프록시, RN 앱은 nginx 직접. 상세 `docs/roadmap/03-infra-nginx.md`(+runbook).
- 관측성: Sentry(프론트/백/앱, DSN 없으면 no-op) + Slack 2종(CI→`#deployments`, Claude 훅→`#claude-hooks`). Sentry→Slack 통합은 없다(Team 플랜 전용) — 장애 알림 통로는 RN 운영 앱 푸시뿐. 상세 `docs/roadmap/ex-observability-map.md`.

## 2. 구조 / 명령
- `backend/` · `frontend/` · `shared/`(빌드 후 `dist/` 소비 — 타입 변경 시 소비 전 `nx build shared`) · `backend-e2e/` · `ops-companion/`(워크스페이스엔 있지만 **Nx 타깃 아님** — `cd ops-companion && yarn start`) · `nginx/` · `docs/`.
- 가능하면 Nx 로: `yarn nx serve backend` · `yarn nx dev frontend` · `yarn nx build <project>` · `yarn nx affected`.
- compose: `docker-compose.local.yaml`(postgres/redis 만 — 로컬 개발) · `docker-compose.yaml`(backend 로컬 빌드) · `docker-compose.prod.yaml`(운영). ⚠ `Makefile` 의 dev 타깃은 없는 `docker-compose.dev.yaml`·frontend 서비스를 참조한다(낡음).

## 3. 백엔드 → 상세 `backend/CLAUDE.md`
모듈러 모놀리식(기능 폴더 = Nest 모듈), 글로벌 prefix `/v1`, 포트 4000. 역할 `buyer | seller | admin`. DB 스키마는 **TypeORM 마이그레이션으로만**(synchronize off).

## 4. 프론트 → 상세 `frontend/CLAUDE.md`
App Router 라우트 그룹 `(auth)` · `(main)`(상점·구매·`/my/*`) · `(seller)`(`/seller/*`) · `(admin)`(`/admin/*`) — 뒤의 둘은 쇼핑몰 헤더 없이 공용 콘솔 셸(`components/console/`). HTTP 는 `publicClient`/`authClient`, 데이터는 TanStack Query.

## 5. 현재 구현 상태
> 한 줄 + 상세 문서 링크 형식만. 새 완료 항목도 이 형식으로 추가하고 경위는 링크된 문서에 쓴다.

**실구현**
- 구매자 커머스: 회원/인증 → 카테고리/상품/검색 → 장바구니 → 주문 → PortOne 결제(+웹훅) → 주문조회/취소/구매확정 → 리뷰(+AI 리뷰 요약).
- 구매자 마이페이지·찜·문의: `/my` 셸(프로필·주문·리뷰·위시리스트·내 문의·비밀번호) · 찜(하트 초기 상태 + 낙관적 갱신) · 상품 문의 왕복(구매자 작성 → 셀러 답변) · 비밀번호 변경 시 전 세션 폐기 → `docs/roadmap/05-buyer-flow-complete.md`
- 셀러: 신청/상태 확인(`my/seller-apply`) · 콘솔 셸 + 대시보드(`/seller`) · 상품 등록/수정/게시 토글 · 주문/배송 · 정산 · 문의 답변(`seller/inquiries`) → `docs/roadmap/01-seller-core.md`, 셸·대시보드는 `01-2-seller-dashboard-inquiry.md`, 문의는 `05-buyer-flow-complete.md`
- 관리자: 대시보드 · 감사 로그 · 셀러 승인 · 상품 승인(=게시) · 주문 · 정산 확정/지급 · 운영 앱 소개(`ops-app`) → `02-admin-core.md`, `ex-audit-log-admin.md`
- 관리자 AI 어시스턴트(tool use 6종·SSE·멀티턴·eval 루프, 다음 = Phase 6b) → `docs/roadmap/ex-ai-assistant.md` · 채팅 화면 UX(도구 진행 표시·마크다운·명시적 중지·401 갱신·스크린리더, 전/후 측정) → `04-ai-chat-ux.md`
- RN 운영 앱 Ops Companion: Phase 0~8 운영 배포 + 외부 공개(preview APK·데모 계정·EAS Update·웹 체험판) → `ops-companion/README.md`, `docs/learning/ops-companion/`, 설계 `docs/roadmap/ops-companion-design.md` §9

**stub / 미완**
- 관리자 `categories`
- 자기 상품 구매·리뷰 차단 없음(자전거래) → `docs/roadmap/README.md` "이력서 뒤 후보" 12
- 인프라 잔여: `03-infra-nginx.md` §10(손님 IP 복원 4b · `next.config.js` 낡은 주석 정정)

## 6. 방향성
원래 우선순위(셀러 → 관리자 → nginx)는 완료. 다음 후보는 `docs/roadmap/README.md` 맨 끝 "이력서 뒤 후보" 표. 새 기능은 **시연 가능한 범위까지만** 문서에 적는다.

## 7. 문서 작성 규칙
기능별 데이터 흐름 문서(`docs/etc/data-flow/NN-기능명/`)를 작성할 때는 **먼저 `docs/etc/data-flow/DOC_GUIDE.md` 를 읽고** 그 규칙·템플릿을 따른다. (매 세션 로드를 피하려고 `@` import 하지 않는다 — 해당 폴더의 `CLAUDE.md` 가 필요할 때만 불러온다.)

## 8. 기능별 진입점 (이름만으론 못 찾는 곳)
- 웹 인증: `service/auth.ts` 의 `/auth/login` → baseURL `/api` → `app/api/auth/{login,refresh,logout}/route.ts`(Next BFF — refresh 쿠키를 Vercel 도메인으로 재발급). 나머지 `/api/*`(demo-login·me 포함)는 `next.config.js` rewrites 로 직행. 로그인/회원가입 훅은 레거시 `frontend/src/hook/`(단수).
- 토큰 상태: `service/auth-storage.ts`·`service/auth-channel.ts`(탭 간 동기화) + `contexts/AuthContext.tsx` + `lib/axios/axios-http-client.ts`(401 갱신). `middleware.ts` 는 `/admin`·`/seller` 만 보호. RSC 패칭은 axios 가 아니라 `lib/server-api.ts`.
- 콘솔 셸(관리자·셀러 공용): `components/console/` — `ConsoleShell`(틀) · `ConsoleSidebar`(메뉴, 현재 항목은 `nav.ts activeNavHref`) · `table-ui`(표 스타일·페이지네이션). 그룹별로는 항목만 정한다: `(admin)/admin/components/AdminSidebar` · `(seller)/seller/components/SellerSidebar` + `nav-items.ts`. 셀러 대시보드 = `hooks/seller-dashboard-query-options.ts`(목록 API 의 `meta.total` 조합) + `(seller)/seller/components/dashboard/` + 그래프 `lib/charts/seller-sales.ts`(일별 매출·상품별 TOP 5 — 최근 주문 100건을 화면에서 묶는다, 집계 API 없음)·`seller-order-status.ts`(상태 분포 — 상태별 `meta.total`). 확인 스크립트 `scripts/seller-console/`(관리자 화면 바이트 비교 포함).
- 로그인 필요 화면: `hooks/useRequireAuth.ts`(`/auth/me` 응답 뒤에만 `/login?redirect=`) — `/my/*` 는 `my/layout.tsx` 가, `cart`·`checkout` 은 각 화면이 부른다. 세션 일괄 폐기: `auth.service.ts revokeAllSessions`(refresh 전부 + Redis `sessions-revoked-at:<userId>` 이전 발급 access 거절) ← `user.service.ts changePassword`.
- 문의·찜(프론트): `service/{inquiry,wishlist,user}.ts` + `lib/react-query/{inquiry,wishlist,user}-query-options.ts` + `hooks/{useInquiry,useWishlist,useUser}.ts` · 폼 검증 `lib/validation/`(백엔드 DTO 와 같은 경계값) · 역할 판정 `lib/roles.ts` · 화면 확인 스크립트 `scripts/buyer-flow/`.
- 모바일 토큰: `backend/src/auth/auth.controller.ts` `X-Client: mobile` 분기 ↔ 앱 `ops-companion/src/lib/{config,api,token-storage}.ts`.
- 결제 후처리: `payment.service.ts` 가 `order.paid` emit → `order/listeners/order-event.listener.ts`(상태·Shipment·캐시). 웹훅 = `payment/webhook-signature.ts` + `portone-webhook-verifier.ts` + `nginx/default.conf` 발신 IP 제한.
- 이벤트 → 리스너: `order.created|paid|cancelled` → `order/listeners` · `order.completed` → `settlement/listeners`(정산 생성) · `review.*` → `review/listeners`(평점·AI 요약 stale·캐시) · `product.*` → `product/listeners`. `order.shipped|delivered`·`shipment.shipped` 는 리스너 없음.
- 상품 캐시(`products:detail:<id>`, `products:list:*`) 무효화는 4곳: `product.service.ts` + product/order/review 리스너.
- 어시스턴트 채팅(프론트): `app/(admin)/admin/assistant/` — `hooks/useAssistantStream` + `lib/`(순수 함수: `chat-message`·`delta-batcher`·`announcement`) + `service/admin-assistant.ts`(fetch 스트림·401 재시도·`stream/cancel`) + `service/assistant-sse.ts`(파서). 와이어 타입은 `shared/src/lib/types/assistant/`. 측정·검증 스크립트 `scripts/ai-chat/`.
- LLM(`intrastructure/ai/` 의 `LLM_CLIENT`) 사용처: `admin/assistant/`(도구 `assistant-tools.ts`, 디스패처 `assistant.service.ts executeTool`) · `ops/ops-analysis.service.ts` · `product/product-summary.service.ts`(리뷰 요약이 review 가 아니라 product 에).
- 업로드: `product.controller.ts`(multer) → `main.ts` `express.static('/uploads')`(v1 밖) → `next.config.js` rewrites. Sentry 초기화: `backend/src/instrument.ts` · `frontend/src/instrumentation(-client).ts` + `sentry.*.config.ts` · `ops-companion/src/lib/sentry.ts`.

## 9. 전역 함정 (영역별 함정은 하위 CLAUDE.md)
- 백엔드는 `@shopping-mall/shared` 를 **값으로 import 금지** — `import type` + `typeof` 만(Nx webpack 이 외부화하는데 운영 이미지에 링크가 없어 `Cannot find module`). 예 `backend/src/ops/visitor-test.ts`.
- 옛 로컬 백엔드가 4000 을 쥐고 있으면 새 번들이 `EADDRINUSE`, e2e 는 옛 응답을 받는다 — `netstat -ano | grep :4000` 의 PID 시작 시각 확인.
- 병렬 Bash 는 cwd 를 공유한다 — 한쪽의 `cd` 때문에 `yarn add` 가 엉뚱한 `package.json` 에 들어간다.
- Vercel 프록시(rewrites)는 **브라우저의 연결 끊김을 백엔드로 전달하지 않는다**(nginx 에는 정상 완료로 찍힌다) — 스트림을 서버에서 멈추려면 `res.on('close')` 가 아니라 명시적 요청으로(`POST /admin/assistant/stream/cancel`). 로컬에서는 전파돼서 운영에서만 드러난다.
- 머지 직후 2~3분은 Vercel 운영이 옛 버전이다 — 운영 확인은 배포 완료(GitHub Deployments `success`) 뒤 강력 새로고침으로.
- **프론트는 머지 즉시 운영에 나가지만 백엔드는 수동 배포다** — 백엔드 변경이 딸린 PR 은 순서를 정하고 머지한다(새 API 를 쓰는 프론트면 백엔드 먼저). 이미 머지된 브랜치에 푸시한 커밋은 PR 에 들어가지 않는다.
- 시드 상품은 전부 판매자가 없다(`sellerId: null`) — 문의 작성은 400, 셀러 화면 시연은 셀러가 등록·승인받은 상품으로. 시드 셀러는 `seller` 역할뿐일 수 있다(실제 승인 흐름은 `buyer`+`seller`).
- 인증 상태는 "모름·있음·없음" 셋이다 — `/auth/me` 응답 전(`isLoading`)이나 다른 탭의 토큰을 기다리는 동안을 "없음"으로 읽으면 로그인한 사용자가 로그인 화면으로 튕긴다(`useRequireAuth`·`AuthContext isAwaitingTabToken`).
- CSP(`frontend/next.config.js`)에 없는 출처는 브라우저가 조용히 막는다 — 업로드 미리보기(`blob:`)가 엑스박스였던 원인. 새 종류의 이미지·연결을 붙이면 CSP 부터 본다.
