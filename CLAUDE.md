# 쇼핑몰 모노레포 — 프로젝트 컨텍스트

> 매 세션 주입되는 "지속 컨텍스트". 상세 로드맵·실행 계획은 여기 두지 말고
> `docs/roadmap/` 별도 문서로 분리한다.

## 1. 개요 / 스택
- **풀스택 쇼핑몰**(약 30k LOC) 모노레포. 포트폴리오/실서비스 목적.
- **백엔드**: NestJS 11 + TypeORM + PostgreSQL(18) + Redis
- **프론트**: Next.js(App Router, React 19) + TanStack Query + axios + ECharts
- **모노레포**: Nx 21 + Yarn(berry). 공용 타입 패키지 `@shopping-mall/shared`
- **배포**: 프론트 **Vercel**, 백엔드 **AWS EC2**(Docker Compose: postgres+redis+backend).
  현재 **nginx 없이 Vercel rewrites 프록시**로 백엔드 우회.
- **관측성**: **Sentry** 에러추적(프론트 `@sentry/nextjs`/백 `@sentry/nestjs`, DSN 없으면 no-op) + **Slack 알림 3종**(CI→`#deployments`, Claude 훅→`#claude-hooks`, Sentry→`#sentry-errors`). 상세 `docs/roadmap/ex-sentry-slack.md`.

## 2. 모노레포 구조
- `backend/`     — NestJS API (`@shopping-mall/backend`)
- `frontend/`    — Next.js 앱 (`@shopping-mall/frontend`)
- `shared/`      — 프론트·백 공용 TS 타입/DTO 인터페이스 (`@shopping-mall/shared`, 빌드 후 `dist/` 소비)
- `backend-e2e/` — 백엔드 e2e 테스트
- `docs/`        — 설계·운영 문서 (데이터 흐름 문서는 §7 규칙 준수, 로드맵은 `docs/roadmap/`)
- 루트: `nx.json`, `docker-compose.{yaml,local,prod}.yaml`, `Dockerfile`(백엔드)·`Dockerfile.frontend`·`Dockerfile.dev`, `Makefile`

### 명령
- 가능하면 **Nx로 실행**: `yarn nx serve backend`, `yarn nx dev frontend`, `yarn nx build <project>`, `yarn nx affected`
- `shared` 타입 변경 시 소비 전 `nx build shared` 필요
- 로컬 인프라: `docker-compose.local.yaml`(postgres/redis). 편의 타깃은 `Makefile`.

## 3. 백엔드 컨벤션 (`backend/src`)
- **모듈러 모놀리식**. 기능별 폴더 = NestJS 모듈(`*.module/controller/service.ts` + `dto/` + `entity/`).
- 글로벌 prefix **`/v1`**, 포트 **4000**(`main.ts`). 전역 `ValidationPipe({transform:true})` + `ClassSerializerInterceptor`(`@Exclude()`로 민감필드 차단).
- **인증**: JWT(access 15m) + refresh(7d, 해시 저장 + Redis 검증/블랙리스트). 이메일 인증·비번 재설정·로그인 레이트리밋(Redis) 포함.
- **역할 3종** `Role = buyer | seller | admin`(`user/entity/role.entity.ts`). User↔Role 다대다.
- **가드/데코레이터**: `JwtAuthGuard`, `RolesGuard`, `DemoAccountGuard` / `@Roles()`, `@User()`, `@Auditable()`.
- **DB 스키마**: `synchronize: NODE_ENV!=='production'`. **마이그레이션 없음** — 엔티티 수정으로 스키마 관리(운영 반영 시 주의).
- 공통 엔티티 `BaseModel`(id/createdAt/updatedAt). 페이지네이션 page/cursor 둘 다 지원(`common/`).
- **인프라 모듈** `intrastructure/`(오타 그대로): `redis/`, `emailVerify/`(SMTP), `ai/`(LLM 클라이언트 — 프로바이더 비종속 `LlmClient`, 현재 Gemini `@google/genai`, 추후 Claude). 이벤트 `EventEmitterModule`, 레이트리밋 `ThrottlerModule`(전역 100req/60s), 감사로그 `audit/`.
- **결제**: PortOne(iamport) 연동 + 웹훅(`payment/`).
- **AI 어시스턴트**: `admin/assistant/`(관리자 자연어 질의 → tool use로 기존 서비스 호출, SSE 스트리밍). 상세 `docs/roadmap/ex-ai-assistant.md`.
- 모듈: auth, user, seller, category, product, review, cart, order, payment, settlement, inquiry, wish-list, audit, admin(+assistant), common, intrastructure(+ai), seed, data.

## 4. 프론트 컨벤션 (`frontend/src`)
- **App Router + 라우트 그룹**: `(auth)`(로그인/회원가입/이메일인증), `(main)`(상점·구매·`/my/*`·`/seller/*`), `(admin)`(`/admin/*`).
- **HTTP**: `lib/axios/axios-http-client.ts`의 `publicClient`/`authClient`. authClient는 Bearer 부착 + 401 시 동시성 안전 refresh.
  access 토큰은 rememberMe에 따라 local/sessionStorage, refresh는 httpOnly 쿠키.
- **API 프록시**: `next.config.js` rewrites `/api/:path* → ${API_PROXY_TARGET||http://localhost:4000/v1}/:path*`. (nginx 전환 시 이 블록 제거 가이드 주석 있음)
- **데이터**: TanStack Query(`providers/`, `lib/react-query/`, `hooks/*query-options`). 전역 인증상태 `contexts/AuthContext.tsx`.
- **라우트 보호**: `middleware.ts`가 `/admin/*`에 refreshToken 쿠키 검사 → 없으면 로그인 리다이렉트. 역할검증은 `(admin)/admin/components/AdminGuard`가 `/auth/me`로 확인.
- **레이어**: `service/`(도메인별 API 클라이언트), `model/`(타입), `components/`, `hooks/`(신규)·`hook/`(레거시 useAuthMutation), `lib/charts/`(ECharts 빌더). 공용 타입은 `@shopping-mall/shared`.

## 5. 현재 구현 상태 (큰 그림)
**되어 있음**
- 구매자 커머스 전 구간: 회원/인증 → 카테고리/상품/검색 → 장바구니 → 주문 → PortOne 결제 → 주문조회/취소/구매확정 → 리뷰/위시리스트/문의.
- 관리자 **대시보드**(KPI·주문추이·보안·퍼널 차트) — `(admin)/admin/dashboard` 실구현.
- 관리자 **감사 로그 조회** — `(admin)/admin/audit-logs` 실구현(트리아지 3버킷 요약 + 포렌식 검색: 필터·표·페이지네이션). 백엔드 `GET /v1/admin/audit-logs` 연결, 행위자 닉네임/이메일 보강. 상세 `docs/roadmap/ex-audit-log-admin.md`.
- 관리자 **상품 승인/반려** — `(admin)/admin/products` 실구현(승인상태 탭·목록·페이지네이션 + 승인/반려 모달). 백엔드 `GET /v1/admin/products`·`PATCH .../approve|reject` 연결. **승인=게시**: `approve()`가 DRAFT 상품을 PUBLISHED로 승격(재승인 시 셀러의 숨김 선택은 존중) + Redis 캐시 무효화로 즉시 상점 노출·주문 가능. 반려 상품은 셀러 수정=재제출로 PENDING 복귀(§1-A②에서 해소). 상세 `docs/roadmap/02-admin-core.md` §2-A②.
- 셀러 **상품 등록/관리** — `(main)/seller/products`(목록: 승인상태 탭·게시/숨김 토글·수정/삭제)·`products/new`·`products/[id]/edit`(반려 재제출 경로) 실구현 + `SellerGuard`(seller layout, 낡은 토큰 refresh 1회). 백엔드 신규: `PATCH /v1/products/:id/status`(게시/숨김/단종 — 재심사 미발동), `GET /v1/products/my/:id`, `/uploads` 정적 서빙(+Next rewrites — ⚠ diskStorage라 컨테이너 재배포 시 유실). 등록은 2단계(생성 후 이미지 업로드, FormData는 Content-Type 헤더 제거). 전 과정 HTTP e2e: `seller-product-lifecycle.e2e.spec.ts`(등록→승인=게시→노출→주문→토글→반려→재제출). 상세 `docs/roadmap/01-seller-core.md` §1-A②.
- 관리자 **셀러 승인/반려** — `(admin)/admin/sellers` 실구현(상태 탭·목록·페이지네이션 + 승인/반려 모달, 반려 사유 필수). 백엔드 `GET /v1/seller/applications`·`PATCH .../approve|reject` 연결. 승인은 seller.status 변경 + SELLER 역할 부여가 한 트랜잭션. 이때 `UserModel.password`에 `@Exclude()`를 추가해 `relations:['user']` 응답에서 해시가 새던 것을 차단(중첩 2단 직렬화로 검증). 상세 `docs/roadmap/02-admin-core.md` §2-A①.
- 셀러 **신청/상태 확인 프론트** — `(main)/my/seller-apply` 실구현(미신청/pending/approved/rejected 4분기, 반려 사유 표시 + 재신청). 승인됐는데 손에 든 토큰이 낡은 경우(인가는 토큰의 역할 기준) `/auth/refresh`를 1회 자동 트리거해 해소 — 토큰 판독은 `frontend/src/lib/jwt.ts`(서명 검증 아님, UI 판단용). 상세 `docs/roadmap/01-seller-core.md` §1-A①.
- 셀러 **백엔드 워크플로 완성**: 신청→pending→승인/반려(SellerEntity, 은행정보 @Exclude, 감사로그).
- 결제/정산/감사 백엔드 모듈 존재.
- **관측성/알림(계획 외 삽입)**: Sentry 에러추적(프론트/백) + Slack 알림 3종 연동 완료. 트러블슈팅 회고 `docs/roadmap/ex-sentry-slack.md`.
- **관리자 AI 어시스턴트(계획 외 삽입)**: `(admin)/admin/assistant` — 자연어로 사내 데이터 질의 → **tool use(function calling)** 로 기존 서비스 호출. 프로바이더 비종속(현재 Gemini 무료티어, 추후 Claude) + SSE 스트리밍 + 멀티턴(대화 DB 영속화). **도구 6종**: get_sales_summary·get_order_stats·query_audit_logs·get_product_info(정형) + summarize_reviews·summarize_inquiries(비정형 RAG, Phase 5a — 상품/카테고리(하위)·기간 필터). PII는 디스패처에서 마스킹/projection/scrubText 처리(도구 결과는 직렬화 인터셉터 미경유 → @Exclude 무력). **구매자 상품 리뷰 자동 요약(Phase 5c)**: 어시스턴트와 별개로 상품 상세에 AI 리뷰 요약을 캐시(`product_summaries` 테이블)+노출 — 리뷰 변경 이벤트로 stale 표시 + 다음 열람 시 SWR 백그라운드 재생성(`GET /v1/products/:id/review-summary`, public; throttle 10분 + 동시 1건 CAS 락, LLM 키 없으면 no-op). 상세 `docs/roadmap/ex-ai-assistant.md`. **프롬프트 캐싱·usage(Phase 6 a·b·c)**: system 정적/동적 분리 + usage 노출 + Gemini implicit 측정/explicit 스캐폴드(off). 무료티어는 explicit 캐싱 불가(캐시 storage 쿼터=0) → 진짜 $ 절감은 추후 Claude+`cache_control` 전환(env 한 줄). 측정 수치·검증 서사는 문서 §8-12. **평가(Phase 7 + A-1)**: 골든셋 20문항 + 규칙 러너 + LLM-judge로 도구 선택·응답 태도·충실성 자동 채점, 프롬프트 1줄 수정→재측정으로 eval 루프 완주(도구 선택 94.1→100%, judge 무회귀 — 서사 문서 §8-13~15). (Phase 0~4 + 5a + 5c + 6a·b·c + 7 + A-1 완료, 다음=Phase 6b)

**비어 있음 / 스켈레톤**
- **셀러 프론트** `(main)/seller/*` 중 stub: 대시보드/주문/정산/문의. (상품 목록·등록·수정은 실구현, 신청 화면 `my/seller-apply`도 실구현)
- **관리자 하위 페이지** stub: `orders`, `categories`, `settlements`. (dashboard·audit-logs·sellers·products는 실구현)
- **정산** 프론트 스켈레톤(백엔드만 존재).
- **인프라**: nginx 미도입(Vercel→EC2 프록시 우회 중).

## 6. 방향성 (요약 — 상세는 `docs/roadmap/`)
우선순위: **셀러 핵심기능 → 관리자 페이지 → 인프라(nginx)**.
1. 셀러: 상품 등록·정산 등 핵심부터(기존 백엔드 연계).
2. 관리자: 이미 잡힌 `(admin)/admin/*` 라우트에 **기존 백엔드 기능 연결**(주문·셀러승인·상품승인 우선, 카테고리는 후순위).
3. 인프라: nginx 도입으로 프록시 우회 대체(EC2 백엔드 앞단).

## 7. 문서 작성 규칙
기능별 데이터 흐름 문서를 작성할 때는 아래 규칙·템플릿을 따른다.
- 작성 규칙: @docs/etc/data-flow/DOC_GUIDE.md
- 작성 위치: @docs/etc/data-flow/...
