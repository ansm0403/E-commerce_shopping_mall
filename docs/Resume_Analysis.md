# Resume Analysis — 이력서 작성용 단일 기준 문서

> 본 문서는 README.md, My_Environment.md, My_projects.md, Frontend_optimization.md, My.md, Design_Dashboard.md, additinal_project.md를 단 1회 통합 분석한 결과이다.
> 이후 회사별 자기소개서·지원동기·입사 후 목표 작성은 **이 문서만을 근거**로 한다. 데이터를 다시 분석하지 않는다.
>
> 작성 기준일: 2026-04-30
> 작성자: 안상문 (tkdans312@gmail.com)

---

## [PROFILE SUMMARY]

### 나에 대한 핵심 소개
- **신입 웹 개발자 안상문**. 프론트엔드를 주축으로 학습한 뒤 NestJS·PostgreSQL·TypeORM 기반 백엔드 프로젝트를 거쳐 **Next.js + Nx 모노레포 풀스택** 환경까지 영역을 확장한 1인 풀스택 개발자.
- **AWS EC2 + Docker + Vercel** 조합으로 모노레포 어플리케이션의 빌드·배포·운영 파이프라인을 직접 구축한 경험.
- **Firebase / Supabase / Sanity / PostgreSQL / Redis** 등 다양한 데이터 플랫폼에서 직접 스키마 설계, 쿼리 작성, RestAPI 구성, 데이터 마이그레이션까지 수행.
- **사용자 경험과 성능 최적화**를 일관된 관심사로 두며, 모든 프로젝트에서 LCP·CLS·INP·번들 사이즈를 정량 지표로 개선해 왔음.
- **보안에도 신경**: 단순 프론트엔드 어플리케이션에서도 AES + RSA 암호화 적용, 풀스택 환경에서는 JWT 이중 토큰·httpOnly 쿠키·Helmet·CSP·Rate Limiting·감사 로그·역할 기반 접근 제어 설계.
- **블로그(Velog) 운영**: [https://velog.io/@tkdans312/posts](https://velog.io/@tkdans312/posts).

### 주요 강점
1. **풀스택 + 인프라 경험**: 단일 프로젝트에서 백엔드(NestJS), 프론트엔드(Next.js), 인프라(EC2/Docker/Vercel) 전 영역을 1인 책임으로 수행. 도메인 모델링부터 트래픽 흐름·CORS·HTTPS 대체 설계·CI 부재 환경의 수동 배포 파이프라인까지 직접 결정·구현.
2. **팀 리더 / 협업 경험**: 졸업 프로젝트(WebtoonWebService)에서 **3인 팀의 리더**를 맡아 전체 기획·UML 설계(유스케이스 → 클래스 → 시퀀스)·API 명세(Swagger) 주도. 백엔드(Java/Spring)와 크롤러(Python) 담당 팀원이 각각 다른 도메인을 학습한 상태에서, 공용 산출물(다이어그램·API 문서)을 먼저 만들어 **소통의 공통 기반**을 구축.
3. **정량적 성능 최적화 이력**: 모든 프로젝트에서 측정 → 가설 → 적용 → 재측정 사이클로 작업. (LCP -90%, 번들 -68%, Firestore 응답 -53%, CLS -91% 등 수치 기반 개선)
4. **트러블슈팅의 깊이**: 표면 증상이 아닌 근본 원인을 추적. 결제 Race Condition, JWT Token Rotation DoS, EC2 OOM, Vercel↔EC2 Set-Cookie 누락, KST 자정 경계 GROUP BY 어긋남 등 실무에 가까운 이슈를 직접 진단하고 해결. 협업 환경에서는 Spring `enum` ↔ 명세서 정수 불일치 같은 **명세-구현 간극**도 능동적으로 진단·정렬.
5. **설계 문서화 역량**: `Design_Dashboard.md`(설계→구현 청사진), `My_Environment.md`(환경 설명서), `Frontend_optimization.md`(최적화 기록), 졸업 프로젝트의 UML 3종(유스케이스/클래스/시퀀스) + Swagger 명세처럼 **다른 협업자/LLM이 읽고 즉시 이해할 수 있는 수준**의 기술 문서를 능동적으로 작성.
6. **빠른 학습/적응**: 임베디드 → 프론트엔드 → React → Next.js → Nx 모노레포 → NestJS → AWS/Docker로 이어지는 학습 경로를 단기간에 압축적으로 흡수. 팀 리더 역할 수행을 위해 **본인 영역(프론트) 외 백엔드 지식까지 자기 학습**으로 보충한 경험.

---

## [PROJECT OVERVIEW]

### 수행한 프로젝트 목록

| # | 프로젝트 | 역할 | 핵심 키워드 |
|---|---------|-----|------------|
| 1 | **E-커머스 쇼핑몰** (현재 메인 포트폴리오) | 1인 풀스택 + 인프라 | 멀티 셀러 / NestJS·Next.js / PortOne V2 / 관리자 대시보드 / EC2·Vercel |
| 2 | **계좌 어플리케이션 (토스형)** | 1인 풀스택 | Next.js / Firebase Listen / 트랜잭션 / AES+RSA |
| 3 | **JAPAN HOTEL RESERVATION** | 1인 풀스택 | React / Firebase / 예약 로직 / 캐러셀 LazyLoad |
| 4 | **WebtoonWebService** (졸업 프로젝트) | **3인 팀 리더** + 프론트엔드 | Next.js / SWR / Spring·JWT·Redis / Python 크롤링 / UML·Swagger 협업 |

### 각 프로젝트의 목적

1. **E-커머스 쇼핑몰**
   - 멀티 셀러 기반 오픈마켓을 모티브로, **구매자·판매자·관리자 3-role**의 전 흐름(상품 등록 → 승인 → 주문 → 결제 → 정산 → 관리자 대시보드)을 처음부터 직접 설계·구현.
   - 단순 CRUD가 아닌 **결제 동시성, 멀티 셀러 배송 분리, 정산, 감사 로그, 관리자 KPI 대시보드** 등 실무 이커머스의 복잡한 비즈니스 로직을 학습.
   - **AWS + Docker + Vercel + Nx 모노레포** 환경에서 운영 가능한 형태로 배포까지 완료.
   - 배포: [https://shopping-mall-frontend-dusky.vercel.app](https://shopping-mall-frontend-dusky.vercel.app).

2. **계좌 어플리케이션**
   - 친구가 금융계 종사자라는 계기로, 금융 도메인에서 마주칠 **트랜잭션·실시간 데이터 리슨(Listen)·잔액 동기화** 등의 패턴을 학습.
   - 모바일 어플리케이션 UX를 가정한 화면 구성.
   - 보안 학습: 계좌 생성 시 전달 정보를 **AES + RSA 이중 암호화**.

3. **JAPAN HOTEL RESERVATION**
   - 네이버 미용실 예약을 사용하다가 **예약 로직과 상태 머신**의 복잡도가 궁금해 직접 구현.
   - 일본 주요 지역 호텔 정보(별점·지도·사진), 댓글, 찜목록, 예약을 다루는 데이터 무거운 어플리케이션.
   - **이미지 다수·스크롤 깊이 깊은 페이지**의 성능 최적화 경험을 쌓는 것이 부수 목표였음.

4. **WebtoonWebService (졸업 프로젝트)**
   - 플랫폼 간 독립·경쟁으로 **흩어진 웹툰 정보를 한 곳에 모아 추천**해 주는 통합 서비스. 본인이 직접 아이디어를 구상하고 팀을 구성한 졸업 프로젝트.
   - **3인 팀의 리더**로서 전체 기획, UML 다이어그램(유스케이스/클래스/시퀀스) 작성, Swagger API 명세 정렬, 프론트엔드 구현을 담당. 백엔드(Java/Spring/JWT/Redis/MySQL) 1명, 크롤러(Python) 1명과 협업.
   - 부수 목표: **단일 프론트엔드 어플리케이션 안에서의 측정→스플리팅→재측정 사이클**을 끝까지 돌려보는 것 (LCP 2.1s → 0.21s).
   - 배포: [https://webtoon-web-service-renew.vercel.app/](https://webtoon-web-service-renew.vercel.app/).

---

## [TECH STACK]

### 전체적으로 사용한 기술

#### Frontend
- **Framework**: Next.js 15 (App Router, RSC/CC 분리), React 19
- **Language**: TypeScript, JavaScript
- **State / Data**: TanStack Query 5, SWR (졸업 프로젝트), Redux, Context API
- **Styling**: TailwindCSS, Styled Components
- **Animation / UX**: GSAP, Skeleton UI, useDeferredValue / useTransition
- **Validation**: Zod
- **Visualization**: ECharts (Funnel/Treemap 지원)

#### Backend
- **Framework**: NestJS 11 (메인), Spring (졸업 프로젝트 협업 — 명세서 정렬 수준의 이해)
- **ORM / DB**: TypeORM 0.3.27, PostgreSQL 18, MySQL (졸업 프로젝트), Prisma (학습용)
- **Cache / Session**: Redis (ioredis, NestJS / Spring 양쪽 환경에서 사용), AOF 영속화
- **Auth**: JWT (Access + Refresh, httpOnly 쿠키), 이메일 인증 (Nodemailer + Redis TTL), 다중 세션
- **Security**: Helmet 8, CSP, @nestjs/throttler (Rate Limiting), 감사 로그 (`@Auditable` 데코레이터 + Interceptor)
- **결제 연동**: PortOne V2 (Webhook 멱등 처리, 환불)
- **데이터 수집**: Python 크롤링 결과 연동 경험 (졸업 프로젝트)

#### 데이터/플랫폼 (학습 경험 포함)
- Firebase (Realtime Listen 포함), Supabase, Sanity (스키마/쿼리), Prisma

#### Infra & DevOps
- **Container**: Docker (멀티스테이지 5단계, non-root 유저, 헬스체크용 curl 포함), Docker Compose (`local`/`prod` 분리)
- **Cloud**: AWS EC2 (`t3.small`, Elastic IP, EBS `/mnt/postgres-data` 영속 마운트)
- **CDN/Hosting**: Vercel (자동 빌드 + `rewrites()` 서버사이드 프록시)
- **Monorepo Tooling**: Nx 21.6.3, Yarn 4.10.3 (corepack), Webpack 5
- **Bundle 분석/최적화**: `@next/bundle-analyzer`, `next/image`, ISR, preconnect/dns-prefetch
- **CI 부재**: 로컬 빌드 → Docker Hub push → EC2 pull 수동 파이프라인 직접 운영

#### 협업/도구
- Git, GitHub, VS Code, Velog 블로그
- Claude / ChatGPT / Gemini를 활용한 페어 프로그래밍 / 설계 검증
- **UML 모델링**: 유스케이스 / 클래스 / 시퀀스 다이어그램으로 팀원 간 공통 모델 합의 (졸업 프로젝트 리더로서)
- **API 명세 협업**: Swagger 기반 API 문서로 프론트-백 인터페이스 합의 → 명세-구현 어긋남(예: enum gender ↔ Spring 정수) 진단 및 정렬

### 기술 선택 기준

- **NestJS + TypeORM**: 의존성 주입과 모듈 경계가 명확해 도메인이 많은 이커머스 (`auth/user/product/order/payment/seller/settlement/review/inquiry/audit/admin`)에서 모듈 책임 분리에 유리. TypeORM은 entity-driven 설계와 친화적이고, 단순 CRUD는 ORM이, 집계/대시보드는 raw SQL로 분리해 가독성을 확보.
- **PostgreSQL + Redis**: PostgreSQL은 JSONB(카테고리 스펙) + 관계형 무결성을 동시에 만족. Redis는 세션/캐시(이메일 인증 TTL, 대시보드 차트별 차등 TTL).
- **Next.js 15 App Router (RSC + CC)**: 상품 상세 페이지를 RSC로 전환 + `prefetchQuery` + ISR을 결합해 LCP/TTFB를 동시에 개선할 수 있는 유일한 후보였음. 클라이언트 인터랙션이 필요한 부분만 CC로 분리.
- **TanStack Query**: 차트별로 staleTime을 차등(1분~30분)해 네트워크 요청 폭발을 막고, queryKey를 URL 쿼리와 1:1 매핑해 SSR prefetch와 CC hydration이 자연스럽게 이어짐.
- **ECharts**: Funnel/Treemap을 동시에 지원하는 후보가 사실상 ECharts뿐이라 단일 라이브러리로 통일 (recharts/chart.js 배제).
- **Vercel rewrites + EC2 (HTTP)**: 도메인·certbot·nginx 운영 비용을 줄이기 위해 **Vercel을 서버사이드 HTTPS 프록시**로 사용. 브라우저는 항상 same-origin Vercel만 호출 → 운영 환경에서 CORS/Secure 쿠키 이슈 회피. 향후 nginx + HTTPS 전환 코드를 `next.config.js` 주석으로 보관.
- **Nx + Yarn 4 + 모노레포**: 백엔드/프론트/공유 패키지의 빌드 캐시·affected 빌드·tsconfig project references를 Nx가 일관되게 관리. CI 부재 환경에서도 로컬 빌드 시간 단축에 기여.
- **Docker 수동 파이프라인**: t3.small에서 `docker build`가 OOM나는 제약을 만나, 로컬 빌드 → Docker Hub push → EC2 pull로 우회. 비용 제약 안에서 합리적 트레이드오프.
- **BFF 패턴 (Next.js Route Handlers)**: Vercel rewrites가 EC2의 Set-Cookie를 환경에 따라 누락하는 문제 → 인증 3개 엔드포인트(login/refresh/logout)만 Next.js API Route로 직접 처리.

---

## [KEY FEATURES]

### 1. E-커머스 쇼핑몰

#### 인증 & 세션
- JWT Access + Refresh (httpOnly 쿠키) **이중 토큰**.
- Nodemailer + Redis TTL 기반 **이메일 인증 회원가입**.
- 다중 디바이스 세션 목록 / 개별 / 전체 해제.
- Role(BUYER/SELLER/ADMIN) 기반 접근 제어 + 미들웨어/Layout/RolesGuard **3중 검증**.

#### 상품 & 카테고리
- 판매자 등록 → 관리자 승인 워크플로우 (`PENDING → APPROVED / REJECTED`).
- 계층형 카테고리 + JSONB 스펙 필드 (뷰티/도서/의류/식품/리빙/신발 6개 루트).
- 태그 시스템, 다중 이미지 업로드, 재고 관리.

#### 장바구니 & 주문
- 장바구니 기반 주문 생성 + 상태 머신: `PENDING_PAYMENT → PAID → PREPARING → SHIPPED → DELIVERED → COMPLETED`.
- **멀티 셀러 배송 분리**: 한 주문에 여러 판매자가 있을 때 판매자 단위로 Shipment 분리. 각 판매자 독립 배송 처리.
- 운송장 번호/택배사 입력, 주문 취소, 구매 확정.

#### 결제 (PortOne V2)
- 결제 검증 + 금액 위변조 탐지.
- Webhook 비동기 결제 상태 동기화 + **멱등성 처리**.
- 전체/부분 환불.

#### 판매자 & 정산
- 구매자 → 판매자 전환 신청 → 관리자 승인.
- 주문 완료 시 자동 정산 내역 생성 (기본 수수료 10%).
- 정산 상태: `PENDING → CONFIRMED → PAID`.

#### 리뷰 / 문의 / 찜
- 주문 완료 후 리뷰(이미지+1~5점), 비밀 문의, 찜 토글.

#### 관리자 대시보드 (5개 차트)
- **KPI 카드 4개**: 오늘 주문/매출/미배송/로그인 실패율 + 전일 대비 deltaPercent (TTL 60초).
- **일별 주문 트렌드 꺾은선**: ordered/paid/cancelled + 전기 비교 점선 (TTL 5분).
- **보안 차트 (이중 Y축)**: FAILED_LOGIN/ACCOUNT_LOCKED 막대 + 실패율 line + 10% markLine 임계 (TTL 5분).
- **결제 전환 펀넬**: created → paid → shipped → delivered → completed 5단계 + cancelled 사이드 (TTL 10분).
- **카테고리 매출 트리맵**: 박스 크기=매출, 색=delta% (TTL 30분).

#### 보안 & 감사 로그
- 61개+ 액션 (`AuditAction` enum) + `@Auditable()` 데코레이터 + `AuditInterceptor`로 **AOP 자동 로깅**.
- IP/User-Agent/성공-실패 기록, IP 추적.
- Helmet CSP / Rate Limiting / 비즈니스 로직 무변경.

### 2. 계좌 어플리케이션
- 계좌/카드 신청, 거래내역 확인, 입출금/이체(트랜잭션), 분석, 신용점수.
- Firebase Listen 기반 잔액 실시간 갱신.
- AES + RSA 암호화로 계좌 생성 정보 보호.
- 모바일 친화 UI.

### 3. JAPAN HOTEL RESERVATION
- 호텔 정보 (별점·지도·사진), 댓글, 찜목록, 예약.
- LazyLoadImage 기반 캐러셀 이미지 지연 로딩.
- intersection Observer + react-query `enabled` 토글로 뷰포트 진입 시점 fetch.

### 4. WebtoonWebService (졸업 프로젝트)
- **공정한 통합 랭킹**: `(웹툰 조회수 / 해당 플랫폼의 전체 조회수)` 비율로 환산하여 인기 플랫폼 편향을 제거한 크로스-플랫폼 랭킹.
- **장르별 / 요일별 / 신작(런칭 3개월 이내) 분류**: 이름 검색 외에도 장르·요일 단독으로 탐색 가능.
- **웹툰 코멘트**: 본편을 보기 전에 다른 사용자의 평을 미리 확인.
- **Python 크롤링 → Spring/MySQL 적재 → Next.js/SWR 소비**의 3-tier 데이터 파이프라인을 팀원과 분담 구현.
- **JWT + Redis 기반 인증** (Spring 측 팀원 구현, 본인은 프론트 측 토큰 흐름 통합).

---

## [MY CONTRIBUTIONS]

### 프로젝트별 역할

| 프로젝트 | 인원 | 내 역할 |
|---------|-----|--------|
| E-커머스 쇼핑몰 | **1인** | 백엔드 (NestJS) + 프론트엔드 (Next.js) + 인프라 (AWS EC2 / Vercel / Docker / Nx 모노레포) **전 영역 100%** |
| 계좌 어플리케이션 | 1인 | 프론트엔드 + 백엔드 (Firebase) |
| JAPAN HOTEL | 1인 | 프론트엔드 + 백엔드 (Firebase) |
| WebtoonWebService (졸업) | **3인 (리더)** | **팀 리더 / 전체 기획·UML 설계·Swagger 명세 정렬·프론트엔드(Next.js·SWR) 전담**. 백엔드(Spring/Redis/JWT/MySQL) 1명, 크롤링(Python) 1명과 협업 |

### 기여도 (정량/정성)

#### E-커머스 (정성)
- **도메인 모델링부터 배포까지 모두 단독 수행**: ERD 설계, 모듈 분리, 인증 흐름 설계, BFF 패턴 도입, EC2 인스턴스 선정 및 운영 구조 결정.
- **설계 청사진을 먼저 문서화한 뒤 구현하는 워크플로우**를 자체적으로 정착 (`Design_Dashboard.md` 등). Phase 단위 체크리스트로 진척 관리.
- **트러블슈팅 회고 문서화**: `deploy-issues.md`, `Modify-proxy.md` 등에 결정 근거와 대안을 모두 기록.

#### E-커머스 (정량 — 코드/구조 규모)
- 백엔드 도메인 모듈 **15개 이상** (`auth/user/product/category/cart/order/payment/seller/settlement/review/inquiry/wish-list/audit/admin/dashboard/common/intrastructure` 등).
- 감사 로그 액션 타입 **61개 이상** 정의·구현.
- 관리자 대시보드 차트 **KPI 4개 + 4개 차트** = 5개 영역.
- 멀티스테이지 Dockerfile 5단계, docker-compose 파일 3종 (`local`/`yaml`/`prod`).
- 백엔드 API 엔드포인트: 인증 9개 + 상품 6개 + 주문/결제 7개 + 판매자 4개 + 관리자 10개 = **36개+**.

#### E-커머스 (정량 — 프론트엔드 성능 개선)

| 지표 | Before | After | 개선율 | 기법 |
|------|--------|-------|-------|------|
| LCP (상품 상세) | 3.2s ~ 3.8s | 1.8s ~ 2.2s | **약 -40%** | RSC/CC 경계 재설계 + prefetchQuery |
| FCP (상품 목록) | 1.8s ~ 1.9s | 0.9s ~ 1.2s | **약 -45%** | SSR prefetchQuery + ISR |
| TTFB (상품 목록) | 300ms ~ 500ms | 30ms ~ 70ms | **약 -85%** | Vercel Edge 캐시 HIT |
| INP (카테고리 탭) | 250ms ~ 400ms | 80ms ~ 120ms | **약 -60%** | useTransition + useDeferredValue |
| 외부 CDN 지연 | — | **100~300ms 절감** | — | preconnect (PortOne CDN) |

- **RSC/CC 경계 재설계 (상품 상세)**: `page.tsx` 최상단 `'use client'`로 인한 클라이언트 마운트 후 2-step fetch waterfall 제거. async RSC + `prefetchQuery`로 전환해 초기 HTML에 데이터 포함 → 마운트 즉시 캐시 HIT 렌더링, SEO 동시 개선.
- **SSR prefetchQuery + ISR (상품 목록)**: URL `searchParams`를 서버에서 파싱해 첫 페이지를 서버에서 선적재. Vercel Edge 캐시 HIT 시 TTFB < 50ms 목표 (`x-vercel-cache` 응답 헤더로 실시간 확인).
- **useTransition + useDeferredValue (INP)**: 카테고리 탭 클릭 시 전체 그리드 동기 재렌더로 버튼 반응이 지연되던 문제를 해결. 탭 활성 스타일은 즉각 반영, 그리드 교체는 낮은 우선순위로 분리. `isPending` → 그리드 `opacity: 60%`로 CLS 없는 전환 시각화.
- **next/image 마이그레이션**: 원본 JPEG 직접 전송 → WebP 자동 변환 + 반응형 `srcset`. 첫 4개 카드에 `priority={true}`로 `<link rel="preload">` 자동 삽입.
- **preconnect (PortOne CDN)**: `layout.tsx`에 `<link rel="preconnect">`를 배치해 결제 SDK CDN의 DNS Lookup + TCP + TLS 핸드셰이크를 선행 처리, 100~300ms 절감.

#### 계좌 어플리케이션 (정량 성과)
- **메인 페이지 LCP 4.2s → 2.4s** (개선율 약 **-43%**) — RSC 포기 후 CC 분리 + 코드 스플리팅.
- **page.tsx 용량 7.2MB → 2.1MB** (개선율 약 **-71%**).
- **트랜잭션 10개 fetch 응답 280ms → 132ms** (개선율 약 **-53%**) — Firebase 참조 → 데이터 복제 (NoSQL 권장 패턴) 전환.
- **CLS 0.32 → 0.03** (개선율 약 **-91%**) — Skeleton UI 도입.
- AES + RSA 이중 암호화 적용.

#### JAPAN HOTEL (정량 성과)
- **번들 4.7MB → 1.5MB** (개선율 약 **-68%**) — 추천/인기 호텔 + react-icons 스플리팅.
- **번들 다운로드 1초 → 0.3초** (개선율 약 **-70%**).
- **LCP 2.1s → 1.81s → 1.48s** (캐러셀 LazyLoadImage + 번들 스플리팅 누적, 약 **-30%**).
- 호텔 상세 페이지 LCP **1.90 → 1.74 → 1.60s** (intersection Observer + 추가 컴포넌트 스플리팅).

#### WebtoonWebService (정성 — 협업/리더십)
- **3인 팀의 리더**로 본인이 직접 아이디어를 발의하고 팀을 구성. 백엔드(Java/Spring)와 모바일 출신 팀원의 도메인 격차를 메우기 위해 **본인이 백·프론트 양 영역을 선제적으로 학습**한 뒤 협업 가능한 공통 어휘를 확보.
- **유스케이스 → 클래스 → 시퀀스 다이어그램** 순으로 단계적으로 산출물을 정렬해, 추상적 아이디어를 팀원 모두가 합의 가능한 형태로 구체화.
- **Swagger 기반 API 명세**를 협업 인터페이스로 채택해 백엔드 팀원과 비동기 소통 가능. 명세-구현 어긋남(예: 명세상 `enum gender`가 Spring 측에서 정수로 직렬화되어 프론트 파싱이 깨지는 이슈, Spring CrossOrigin 설정 누락)을 본인이 추적·정렬.

#### WebtoonWebService (정량 성과)
- **메인 페이지 LCP 2.1s → 0.21s** (개선율 약 **-90%**) — `layout.tsx` 동적 임포트, 모바일 navbar 스플리팅, react-icons `searchIcon` 스플리팅.
- **CLS → 0.08** — 페이지네이션 우선 렌더 → 웹툰 카드/디테일 스켈레톤 UI 도입.
- **첫 페이지 프리페치**: DOMContentLoaded **422 → 356ms**, Load **506 → 403ms**.
- **검색 입력 디바운스 + SWR key 디바운스 state**: 입력마다 발생하던 서버 요청을 합산해 불필요한 네트워크 비용 제거.

---

## [TECHNICAL CHALLENGES]

### 1. 결제 동시성 (Race Condition)
- **문제**: PortOne 결제 완료 Webhook과 사용자의 주문 취소 요청이 동시에 도달하면 주문 상태가 불일치하는 **유령 결제** 발생.
- **해결**: 트랜잭션 격리 수준 조정 + 상태 체크 순서 변경(주문 상태 선확인 → 결제 검증). Webhook 멱등성 키 도입.

### 2. JWT Token Rotation DoS (관리자 대시보드 설계 중 발견)
- **문제**: Server Component에서 `/v1/auth/me`를 호출하니, Server Component가 `cookies().set()`을 못 해 백엔드가 회전한 새 refreshToken을 브라우저 쿠키에 반영 불가. 다음 요청은 무효화된 이전 토큰을 사용 → reuse detection → `revokeAllUserTokens` → 모든 세션 강제 로그아웃 → 로그인 루프.
- **해결**: 검증 로직을 Client Component(`AdminGuard.tsx`)로 이동. axios 인터셉터의 401 핸들러가 BFF `/api/auth/refresh`를 호출하면 브라우저가 Set-Cookie를 자동 처리하도록 위임. **"Server Component에서 token rotation 엔드포인트를 절대 호출하지 말 것"**이라는 원칙을 문서로 정착.

### 3. EC2 인스턴스 선정 / OOM
- **문제**: 처음 `t3.micro`(1GB RAM)에서 NestJS 부팅 자체가 OOM으로 실패. `t3.small`로 업그레이드 후에도 EC2 내부 `docker build` 단계에서 node_modules 설치 + Nx 빌드가 2GB RAM 초과.
- **해결**: **로컬 빌드 → Docker Hub push → EC2 pull**의 수동 파이프라인 구성. CI/CD가 없는 비용 제약을 받아들이고, 운영 가능한 형태로 우회. 빌드 비용을 데스크탑으로 옮기는 명시적 트레이드오프.

### 4. CORS — 단일 origin 한계
- **문제**: `origin: process.env.FRONTEND_URL`로 단일 origin만 허용하던 설정이, 로컬 개발(`localhost:3000`)과 운영(`Vercel URL`) 양쪽에서 동시에 동작하지 못함. 운영 URL을 `.env`에 넣은 순간 로컬에서 차단.
- **해결**: `CORS_ORIGINS` 환경변수를 새로 도입해 **콤마 구분 멀티 origin** 콜백 함수로 변경. `FRONTEND_URL`은 이메일 링크 생성용으로 단일 책임 분리.

### 5. axios 401 재시도 Race Condition
- **문제**: accessToken 만료 시 동시에 여러 요청이 401 → 다중 refresh 호출 발생 → 토큰 회전 충돌.
- **해결**: `isRefreshing` 플래그 + Promise queue로 **단일 refresh만 실행, 나머지 요청은 결과 대기 후 재시도**. 동시 다발 요청에서도 한 번만 갱신.

### 6. Vercel ↔ EC2 Set-Cookie 누락 (BFF 도입)
- **문제**: `next.config.js` `rewrites()`로 EC2를 호출할 때, EC2가 보낸 `Set-Cookie`가 Vercel Edge를 통과하면서 **도메인 변환·SameSite·Secure 처리**가 환경에 따라 누락. refreshToken이 브라우저에 저장 안 되거나 다음 요청에 동봉되지 않음.
- **해결**: 인증 관련 3개 엔드포인트(`login`/`logout`/`refresh`)만 **Next.js API Route(BFF)**로 직접 처리. EC2 응답의 Set-Cookie를 파싱해 Vercel 도메인 기준으로 다시 Set-Cookie. axios baseURL은 `/api` 그대로 유지 (Next.js API Route가 `rewrites()`보다 우선).

### 7. EC2 HTTPS 부재 환경 보안 확보
- **문제**: EC2에 nginx + Let's Encrypt를 구성할 시간 비용이 큼. 그러나 브라우저는 mixed content / Secure 쿠키를 위해 HTTPS가 필수.
- **해결**: **Vercel 서버사이드 프록시**(`rewrites()`)로 브라우저는 항상 same-origin HTTPS Vercel만 호출. Vercel→EC2 구간만 HTTP 평문이 남으므로 한계를 명시한 트레이드오프로 문서화. `next.config.js`에 nginx+HTTPS 전환 코드를 주석으로 보관해 즉시 전환 가능한 상태로 유지.

### 8. KST 자정 경계 / 타임존 GROUP BY
- **문제**: 대시보드의 일별 집계 SQL을 UTC 기준 GROUP BY로 작성 시 한국 자정과 9시간 어긋남 → "어제 데이터가 오늘 날짜로 잡히는" 버그.
- **해결**: 모든 일별 GROUP BY에 `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'` **이중 캐스트** 명시. KST 변환 헬퍼 `toKstRange(startDate, endDate)`로 반열림 구간 `[start, end+1)` 통일. seed 데이터도 KST 09~23시 기준으로 생성하도록 `randomKstTime` 헬퍼 작성.

### 9. PostgreSQL camelCase / numeric 응답 타입 함정
- **문제**: TypeORM 엔티티가 camelCase 컬럼이라 SQL에서 쌍따옴표 누락 시 `createdat`로 소문자화되어 컬럼 미발견 에러. 또 `SUM`/`COUNT`/`numeric` 결과가 driver별로 string으로 반환되어 JS 비교 연산 시 NaN 발생.
- **해결**: SQL에서는 항상 `"createdAt"` 쌍따옴표 명시 + `::text` 캐스트, 서비스 레이어에서 `Number()`로 일괄 변환. 빈 날짜는 `fillEmptyDates()` 헬퍼로 0 채움. 분모 0 처리도 서비스 레이어 단일 지점에서 (failureRate 계산 등).

### 10. 카테고리 매출 트리맵의 데이터 한계
- **문제**: `order_items`에 카테고리 스냅샷이 없어 현재 `products.category_id`로 JOIN. 주문 후 카테고리가 변경되면 과거 매출이 새 카테고리로 잡힘.
- **해결 (현재)**: 한계를 명시적으로 문서화. v1은 leaf 카테고리 그대로 트리맵 렌더, root 매핑 SQL은 `categories.path` 기반 v2로 분리.
- **해결 (향후)**: `order_items.category_id_snapshot` 컬럼 추가 예정.

### 11. Frontend 성능 최적화 (E-커머스, 8개 OPT 트랙)
- **OPT-1 Bundle Analyzer**: 측정 가시화.
- **OPT-2 RSC/CC 경계 재설계 (상품 상세)**: `'use client'` page.tsx 전체가 CC였던 구조를 RSC + `prefetchQuery` + `HydrationBoundary`로 전환 → 클라이언트 마운트 후 추가 fetch waterfall 제거.
- **OPT-3 ISR (`revalidate: 300`)**: TTFB 단축. 캐시 HIT 시 < 50ms.
- **OPT-4 SSR prefetchQuery (상품 목록)**: searchParams 서버 파싱 + HydrationBoundary로 첫 화면에 실제 그리드 표시.
- **OPT-5 useDeferredValue + useTransition**: 카테고리/정렬 인터랙션의 INP 개선. `isPending`을 그리드 opacity에 반영해 CLS 없이 로딩 시각화.
- **OPT-6 staleTime 차등 전략**: 카테고리 5분, 목록 1분, 상세 5분, 장바구니 5분(낙관적 업데이트), 주문 30초.
- **OPT-7 next/image 마이그레이션**: WebP 자동 변환, srcset, preload 힌트, EC2 HTTP 도메인 대응 `remotePatterns` 설정.
- **OPT-8 preconnect**: PortOne CDN(`cdn.portone.io`) DNS+TCP+TLS 미리 맺기.

### 12. 계좌 — Firebase 참조 → 복제 마이그레이션
- **문제**: 사용자 컬렉션 하위 트랜잭션을 ID 참조로 저장 → 10개 fetch 시 추가 raw fetch 다수 필요. NoSQL은 데이터 복제가 권장 패턴.
- **해결**: 참조를 데이터 복제로 전환. 응답 280ms → 132ms.

### 13. 계좌 — 메인 페이지 LCP
- **문제**: 홈에 기능 집중 + Next.js SSR 서버 컴포넌트 → 7.2MB.
- **해결**: SSR 이점을 의도적으로 포기하고 모든 컴포넌트를 CC로 분리 + 코드 스플리팅. LCP 4.2 → 2.4초.

### 14. JAPAN HOTEL — 캐러셀 / 번들
- **문제**: 캐러셀 20개 호텔을 모두 미리 로드. 번들 4.7MB.
- **해결**: LazyLoadImage + intersection Observer + react-icons 등 무거운 의존성 스플리팅. 번들 1.5MB, LCP 1.48s.

### 15. WebtoonWebService — 도메인 격차가 큰 3인 팀의 협업 합의
- **문제**: 팀원 한 명은 백엔드만, 다른 한 명은 모바일 앱만 학습한 상태. 본인은 임베디드 → 프론트로 전향한 직후라 **3명 모두 웹 풀스택 공통 경험이 부재**. 추상적 아이디어를 코드로 옮기기 전에 **합의된 모델**이 없으면 각자 다른 시스템을 만들 위험.
- **해결**:
  1. 리더로서 **본인이 백·프론트 양 영역을 먼저 학습**해 팀원과 같은 어휘로 대화 가능한 상태 확보.
  2. **유스케이스 다이어그램**을 가장 먼저 작성해 비기술 관점에서 합의(누가, 무엇을, 어떤 흐름으로) → **클래스 다이어그램**으로 데이터 모델 합의 → **시퀀스 다이어그램**으로 호출 순서·의존 합의. 단계적으로 추상도를 낮춤.
  3. 합의된 다이어그램을 기반으로 각자 자기 영역에 착수 → **재합의 비용 최소화**.
- **배움**: 협업에서 가장 큰 비용은 코드를 다시 짜는 것이 아니라 **모델이 어긋나는 것**임을 체감. 이후 1인 프로젝트(E-커머스)에서도 `Design_Dashboard.md` 같은 설계 청사진을 먼저 만드는 습관으로 이어짐.

### 16. WebtoonWebService — Spring 명세 ↔ 프론트 파싱 어긋남
- **문제**: API 명세에 `gender`를 enum (예: `MALE`/`FEMALE`)으로 정의했으나, Spring 측에서 enum이 ordinal 정수로 직렬화되어 프론트 파싱 단계에서 의도한 문자열과 어긋남. 그 외 Spring 코드 내 CORS(CrossOrigin) 설정 누락도 발견.
- **해결**:
  1. Swagger 응답 스키마와 실제 응답을 양쪽에서 비교해 **명세-구현 간극을 빠르게 격리**.
  2. 백엔드 팀원과 **enum 직렬화 규칙(name 문자열 사용)**을 합의하고 명세를 단일 소스로 업데이트.
  3. CrossOrigin 설정은 Spring 측에서 어노테이션 단위로 적용하도록 페어로 검토.
- **배움**: API 명세는 “단일 진실 원천(SSOT)” 역할을 못 하면 무용지물 — **명세를 합의 → 양쪽이 명세를 따르는지 검증**하는 사이클이 필수. 이 경험이 이후 NestJS 프로젝트에서 DTO + Zod로 입력/출력 양쪽을 명시하는 습관으로 연결.

### 17. WebtoonWebService — 첫 화면 LCP / CLS / 검색 비용 (정량 최적화)
- **LCP 2.1s → 0.21s**: DevTools Performance 탭으로 `layout.tsx` 다운로드 비중을 식별 → 모바일 navbar(메뉴 클릭 전엔 미사용) 동적 임포트 + `react-icons`의 `searchIcon`만 별도 스플리팅. (예상치 못한 단일 아이콘이 번들 비대화의 주범이었던 점이 핵심 학습)
- **CLS → 0.08**: 페이지네이션 컴포넌트가 리스트보다 먼저 렌더되어 발생하던 점프를 웹툰 카드/디테일 스켈레톤 UI로 흡수.
- **프리페치**: 1번째 페이지는 진입 시 무조건 보게 되므로 사전 prefetch → DOMContentLoaded 422 → 356ms, Load 506 → 403ms.
- **검색 디바운스**: 입력마다 발생하던 fetch를 디바운스로 묶고, **SWR key를 디바운스된 state로 사용**해 state 변경에 따른 리렌더가 발생해도 SWR 키가 동일하면 재요청이 일어나지 않도록 정렬 (디바운스만으로는 리렌더 → 재요청을 못 막는다는 오해를 직접 검증·해소).

---

## [IMPACT]

### 프로젝트 성과

#### E-커머스 (정성적 성과)
- **단순 CRUD를 넘어선 실무 수준 비즈니스 로직** 1인 구현: 멀티 셀러 / 결제 / 정산 / 감사 / 관리자 대시보드.
- **AWS EC2 + Docker + Vercel + Nx 모노레포** 환경에서 **실제 운영 가능한 배포** 달성. 비용 제약(t3.small) 안에서 합리적 우회 파이프라인 구축.
- **설계 → 구현 청사진 문서화 워크플로우** 정착 (`Design_Dashboard.md`, `My_Environment.md`, `Frontend_optimization.md`). 다음 컨텍스트(다른 사람 또는 LLM)가 바로 이어서 작업할 수 있는 수준.

#### 계좌 어플리케이션 (정량 성과)
| 지표 | Before | After | 개선율 |
|------|--------|-------|-------|
| LCP | 4.2s | 2.4s | **-43%** |
| 페이지 용량 | 7.2MB | 2.1MB | **-71%** |
| Firestore 응답 (10개 fetch) | 280ms | 132ms | **-53%** |
| CLS | 0.32 | 0.03 | **-91%** |

#### JAPAN HOTEL (정량 성과)
| 지표 | Before | After | 개선율 |
|------|--------|-------|-------|
| 번들 크기 | 4.7MB | 1.5MB | **-68%** |
| 번들 다운로드 시간 | 1.0s | 0.3s | **-70%** |
| LCP (홈) | 2.1s | 1.48s | **-30%** |
| LCP (상세) | 1.90s | 1.60s | **-16%** |

#### WebtoonWebService (정성적 성과 — 협업/리더십)
- 본인이 직접 아이디어를 발의해 **3인 팀을 구성하고 졸업 작품으로 완주**시킨 경험.
- 도메인 격차가 큰 팀에서 **공통 산출물(UML 3종 + Swagger)을 합의의 매체**로 활용해 작업을 병렬화.
- 명세-구현 어긋남(enum 직렬화, CORS 설정)을 능동적으로 진단해 **백엔드 팀원과 수평적으로 합의·정렬**한 경험.

#### WebtoonWebService (정량 성과)
| 지표 | Before | After | 개선율 |
|------|--------|-------|-------|
| LCP (홈) | 2.1s | 0.21s | **-90%** |
| CLS | (페이지네이션 점프) | 0.08 | — |
| DOMContentLoaded (목록 1p) | 422ms | 356ms | **-16%** |
| Load (목록 1p) | 506ms | 403ms | **-20%** |

### 개선 및 성장

1. **백엔드 도메인 설계 역량 확보**: 인증·상품·주문·결제·정산·감사 로그·관리자 등 다중 도메인의 모듈 경계와 의존성 흐름을 직접 결정. "왜 audit 모듈도 order 모듈도 아닌 별도 admin 모듈인가" 같은 양방향 의존 끊기 결정 경험.
2. **인프라/배포 한계 안에서의 실용주의**: t3.small 메모리 제약, HTTPS 미구성, CI 부재 환경에서 **Vercel 프록시 / 수동 파이프라인 / BFF**라는 구체적 우회 설계로 동작하는 시스템을 만든 경험.
3. **트러블슈팅의 깊이**: 표면 증상(401 무한 루프)이 아닌 근본 원인(Server Component가 cookies().set() 불가 → token reuse detection)을 추적하고 **재발 방지 원칙을 문서화**.
4. **데이터 정합성 감각**: KST 타임존 경계, camelCase 컬럼 따옴표, numeric driver 차이, 분모 0 / 결손 날짜 / 멱등 시드 마커 등 데이터 레이어의 디테일을 직접 부딪히며 학습.
5. **성능 최적화 사이클 체화**: 모든 프로젝트에서 측정 → 가설 → 적용 → 재측정. 단순 `<img>` → `next/image`가 아닌, RSC 경계 재설계·SSR prefetch·useDeferredValue 등 **계층별 최적화 도구 선택 기준** 확보.
6. **문서화/협업 자산**: 후속 작업자(미래의 본인 또는 동료/LLM)에게 컨텍스트를 1회 안에 전달할 수 있는 형태로 환경/설계/회고 문서를 자체적으로 작성하는 습관.
7. **풀스택 + 인프라의 끝까지 가본 경험**: 백엔드만 또는 프론트엔드만이 아니라, **트래픽이 브라우저에서 출발해 EC2 PostgreSQL까지 도달하는 전 경로**를 직접 설계·디버깅한 경험. 한 도메인의 결정이 다른 도메인에 미치는 영향을 체감.
8. **팀 리더 / 협업 합의의 비용 감각** (졸업 프로젝트): 도메인 격차가 큰 팀에서 **공통 모델을 먼저 합의(UML → Swagger)**한 뒤 병렬 작업하는 방식의 가치를 체감. 코드 작성보다 **합의되지 않은 모델을 다시 맞추는 비용**이 훨씬 크다는 사실을 1차 경험. 이 학습이 1인 프로젝트(E-커머스)에서도 `Design_Dashboard.md` 같은 설계 청사진을 먼저 만드는 워크플로우로 이어짐.
9. **다른 영역 선제 학습으로 협업 격차 메우기**: 리더로서 본인 영역(프론트) 외의 백엔드 지식을 자기 학습으로 보충해 **팀원과 같은 어휘로 대화**할 수 있는 상태를 만드는 것의 중요성을 학습. 입사 후에도 자기 영역에 갇히지 않고 인접 영역을 학습해 협업 마찰을 줄이는 태도로 이어질 자산.

---

## [AI 활용 역량]

> E-커머스 쇼핑몰(메인 포트폴리오) 개발 과정에서의 AI 도구 활용 방식을 구체적으로 기록한다.

- **Claude Code를 개발 파트너로 활용**: NestJS를 처음 사용하는 상황에서 도메인 규모까지 컸기 때문에, **초기 모듈 구조 생성·boilerplate 작성에 Claude Code를 적극 활용**했다. 생성된 코드를 그대로 사용하지 않고 구조와 동작 원리를 직접 리뷰·이해하는 것을 원칙으로 삼았다.

- **설계 검증 도구로서의 질문 활용**: 코드 설계 단계에서 "왜 이 구조를 선택했는가", "대안 설계(예: 단일 auth 모듈 vs. user·auth 분리, interceptor vs. guard 적용 기준)와의 트레이드오프는 무엇인가"를 AI에게 질문하며 설계 의도를 능동적으로 파악했다. AI가 제안한 구조를 그대로 수용한 것이 아니라, 이유를 이해한 뒤 채택 여부를 스스로 결정했다.

- **프롬프트 품질의 반복적 개선**: 원하는 결과를 정확하게 얻기 위해 컨텍스트를 어떻게 구성할지, 어떤 제약 조건을 명시할지를 지속적으로 다듬었다. `Design_Dashboard.md`·`My_Environment.md` 같은 환경/설계 문서를 "다른 작업자(또는 LLM)가 즉시 투입될 수 있는 수준"으로 작성하는 습관은 이 과정에서 형성되었다.

- **프론트엔드·백엔드의 활용 온도 차**: 프론트엔드(Next.js·TanStack Query 등)는 기존 익숙 스택이라 생성 코드의 검토·수정이 빠르게 이루어졌다. 반면 NestJS·TypeORM 등 처음 다루는 영역은 생성 코드를 이해하는 데 더 많은 시간을 투자했고, 이 과정이 실질적인 백엔드 학습 경로가 되었다.

- **AI 활용 원칙 — 생산성 확보와 코드 소유권 유지의 양립**: AI 도구 사용의 목적을 "코드를 받아 붙여넣는 것"이 아닌 **"설계 결정의 근거를 빠르게 검증하고, 모르는 영역의 진입 장벽을 낮추는 것"**으로 정립했다. AI가 생성한 코드는 항상 본인이 리뷰·이해·수정 후 커밋하는 흐름을 유지했다.

- **AI를 지식 캡처 도구로 활용 — 문서화 강제**: 중요한 설계 결정을 AI와 대화로 검증한 뒤, 또는 큰 트러블슈팅을 AI와 함께 해결한 뒤 **그 내용을 `docs/` 아래에 문서로 정리하도록 AI에게 직접 요청**했다. 대화는 휘발되지만 문서는 남는다는 판단 하에, AI와의 세션을 단순히 "결과를 받는 것"으로 끝내지 않고 **재사용 가능한 컨텍스트 자산**으로 변환하는 워크플로우를 의식적으로 설계했다. 이 방식은 26번째 줄의 "설계 문서화 역량"(직접 작성)과 다른 결: AI를 지식 정리의 파트너로 써서 문서화 비용을 낮추면서도 기록을 남기는 것.

---

## [부록 A] 추가 보유 자산 (이력서/자기소개서에서 활용 가능)

- **블로그 운영 (Velog)**: 학습/트러블슈팅 기록을 외부 공개. [https://velog.io/@tkdans312/posts](https://velog.io/@tkdans312/posts).
- **GitHub 활동**: `ansm0403` (TopLangs/Stats/ActivityGraph 노출).
- **AI 도구 활용**: Claude Code를 중심으로 설계 검증·코드 리뷰·문서화에 활용. 구체적인 활용 방식은 `[AI 활용 역량]` 섹션 참조.
- **팀 협업 경험 (졸업 프로젝트)**: 3인 팀 리더, 전체 기획 / UML 3종 다이어그램 / Swagger 명세 정렬 / 프론트엔드 구현. 배포: [https://webtoon-web-service-renew.vercel.app/](https://webtoon-web-service-renew.vercel.app/).

## [부록 B] 추후 개선 예정 (자기소개서 "입사 후 목표"용 소재)

- EC2 nginx + Let's Encrypt HTTPS 전환 (전 구간 암호화).
- TypeORM 마이그레이션 도입 (현재 `synchronize: true` dev only).
- 단위/통합 테스트 코드 보강.
- 일별 사전 집계 테이블(`audit_daily_stats`) + Cron 도입으로 대시보드 90일 집계 비용 절감.
- `order_items.category_id_snapshot` 컬럼 추가로 카테고리 매출 정합성 보장.
- Redis 인증/ACL 적용 및 fallback 처리.
- CI/CD 자동화 (GitHub Actions → Docker Hub → EC2).

---

*이 문서는 "Resume Analysis 단일 기준 문서"로, 회사별 자기소개서·지원동기·입사 후 목표 작성 시 본 문서의 항목만을 근거로 한다. 데이터 재분석은 수행하지 않는다.*
