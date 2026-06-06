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

## 2. 모노레포 구조
- `backend/`     — NestJS API (`@shopping-mall/backend`)
- `frontend/`    — Next.js 앱 (`@shopping-mall/frontend`)
- `shared/`      — 프론트·백 공용 TS 타입/DTO 인터페이스 (`@shopping-mall/shared`, 빌드 후 `dist/` 소비)
- `backend-e2e/` — 백엔드 e2e 테스트
- `docs/`        — 설계·운영 문서 (데이터 흐름 문서는 §7 규칙 준수, 로드맵은 `docs/roadmap/`)
- 루트: `nx.json`, `docker-compose.{yaml,local,prod}.yaml`, `Dockerfile.{backend,frontend}`, `Makefile`

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
- **인프라 모듈** `intrastructure/`(오타 그대로): `redis/`, `emailVerify/`(SMTP). 이벤트 `EventEmitterModule`, 레이트리밋 `ThrottlerModule`(전역 100req/60s), 감사로그 `audit/`.
- **결제**: PortOne(iamport) 연동 + 웹훅(`payment/`).
- 모듈: auth, user, seller, category, product, review, cart, order, payment, settlement, inquiry, wish-list, audit, admin, common, intrastructure, seed, data.

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
- 셀러 **백엔드 워크플로 완성**: 신청→pending→승인/반려(SellerEntity, 은행정보 @Exclude, 감사로그).
- 결제/정산/감사 백엔드 모듈 존재.

**비어 있음 / 스켈레톤**
- **셀러 프론트** `(main)/seller/*` 전부 stub: 대시보드/상품/상품등록/주문/정산/문의.
- **관리자 하위 페이지** stub: `orders`, `products`(승인), `categories`, `sellers`(승인), `settlements`, `audit-logs`. (dashboard만 실구현)
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
