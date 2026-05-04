<img width="40%" alt="Honeycam 2026-04-28 11-05-50" src="https://github.com/user-attachments/assets/3bb211a0-4ceb-4acb-91d0-706915c4bcd7" />
<img width="40%" alt="Honeycam 2026-04-28 11-09-15" src="https://github.com/user-attachments/assets/508c487d-4939-4526-bdd6-c85b1a47dab4" /><br>
<img width="40%" alt="Honeycam 2026-04-28 11-07-16" src="https://github.com/user-attachments/assets/c6eee591-91d9-4d11-839c-d396322f0bbb" />
<img width="40%" alt="Honeycam 2026-04-28 11-20-30" src="https://github.com/user-attachments/assets/25a6c47e-7640-47fc-a10c-6c457eda9d9c" /><br>
<img width="40%" alt="Honeycam 2026-04-28 11-14-00" src="https://github.com/user-attachments/assets/43deb2f6-752b-4bbd-b61c-0c5f212e1607" />
<img width="40%" alt="Honeycam 2026-04-28 11-14-58" src="https://github.com/user-attachments/assets/c4f24dc7-f492-4f79-b7e1-12c23e8981bd" />





# E-커머스 쇼핑몰

멀티 셀러 기반의 오픈마켓 쇼핑몰 풀스택 프로젝트입니다.

구매자, 판매자, 관리자 세 역할을 기반으로 상품 등록부터 주문, 결제(PortOne), 정산, 관리자 대시보드까지 이커머스의 전체 흐름을 구현하였습니다.

> **이 문서는 루트 하나로 통합된 README입니다.** 모노레포 구조이지만 포트폴리오 특성상 GitHub이 자동 렌더링하는 루트 README에 백엔드/프론트엔드를 모두 기술하는 방식을 선택하였습니다.

---

## 배포 현황

| 구분 | URL / 위치 | 비고 |
|------|-----------|------|
| **Frontend** | [https://shopping-mall-frontend-dusky.vercel.app](https://shopping-mall-frontend-dusky.vercel.app) | Vercel (자동 빌드) |
| **Backend** | AWS EC2 `t3.small` | Docker Hub 이미지 pull 방식 |
| **DB** | PostgreSQL (EC2 EBS 영구 볼륨) | `/mnt/postgres-data` 마운트 |
| **Cache** | Redis (Docker Compose 내부) | EC2 컨테이너 네트워크 격리 |

### 트래픽 흐름

```
[운영]
브라우저 ──HTTPS──▶ Vercel ──rewrites(/api/*)──▶ EC2:4000 (HTTP)
                   (same-origin)                  NestJS /v1/*

[로컬]
브라우저(:3000) ──직통──▶ localhost:4000/v1 (CORS 활성)
```

EC2에 nginx/HTTPS를 별도 구성하는 대신, `next.config.js`의 `rewrites()`를 통해 Vercel 서버가 EC2를 대신 호출하는 **서버사이드 프록시** 방식을 사용합니다. 브라우저는 Vercel 도메인에만 요청하므로 운영 환경에서 CORS가 사실상 발생하지 않습니다.

### EC2 인스턴스 선정 과정

처음 `t3.micro`(1GB RAM)로 시작했으나 NestJS 부팅 중 **OOM으로 컨테이너가 즉시 종료**되는 문제가 발생했습니다. `t3.small`(2GB RAM)로 업그레이드 후 서버 자체는 안정적으로 동작했지만, **EC2 내부에서 `docker build`를 실행하면 node_modules 설치 + Nx 빌드 과정에서 메모리를 초과**했습니다.

최종 해결책: **로컬에서 Docker 이미지를 빌드하고 Docker Hub에 push한 뒤 EC2에서 pull**하는 수동 파이프라인을 구성했습니다.

```bash
# 로컬
docker build -t ansmoon/shopping-mall-backend:latest .
docker push ansmoon/shopping-mall-backend:latest

# EC2
docker compose -f docker-compose.prod.yaml pull backend
docker compose -f docker-compose.prod.yaml up -d
```

---

## 개발자

| 이름 | 담당 |
|------|------|
| 안상문 | 백엔드 (NestJS) · 프론트엔드 (Next.js) · 인프라 (AWS EC2, Vercel, Docker) |

---

## 기술 스택

### Backend

![NestJS](https://img.shields.io/badge/nestjs-%23E0234E.svg?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Postgres](https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)
![TypeORM](https://img.shields.io/badge/TypeORM-FE0803.svg?style=for-the-badge&logo=typeorm&logoColor=white)
![Redis](https://img.shields.io/badge/redis-%23DD0031.svg?style=for-the-badge&logo=redis&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-black?style=for-the-badge&logo=JSON%20web%20tokens)

### Frontend

![Next JS](https://img.shields.io/badge/Next-black?style=for-the-badge&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)
![React Query](https://img.shields.io/badge/-React%20Query-FF4154?style=for-the-badge&logo=react%20query&logoColor=white)

### Infra & Config

![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-%23FF9900.svg?style=for-the-badge&logo=amazon-aws&logoColor=white)
![Vercel](https://img.shields.io/badge/vercel-%23000000.svg?style=for-the-badge&logo=vercel&logoColor=white)
![Yarn](https://img.shields.io/badge/yarn-%232C8EBB.svg?style=for-the-badge&logo=yarn&logoColor=white)
![Nx](https://img.shields.io/badge/nx-143055?style=for-the-badge&logo=nx&logoColor=white)

---

## 모노레포 구조

```
shopping_mall/                        ← Nx 21 + Yarn 4 Workspace
├── backend/                          # NestJS 11 (포트 4000, API prefix /v1)
│   └── src/
│       ├── auth/                     # JWT 인증, 세션, 이메일 인증
│       ├── user/                     # 유저 관리, 역할(BUYER/SELLER/ADMIN)
│       ├── product/                  # 상품 CRUD + 승인 워크플로우
│       ├── category/                 # 계층형 카테고리 + JSONB 스펙
│       ├── cart/ order/ payment/     # 결제 (PortOne V2)
│       ├── seller/ settlement/       # 판매자 전환, 정산
│       ├── review/ inquiry/ wish-list/
│       ├── audit/                    # 감사 로그 (@Auditable 데코레이터)
│       ├── admin/dashboard/          # ★ 관리자 대시보드 KPI API
│       ├── common/                   # 가드, 인터셉터, DTO, 유틸
│       ├── data/                     # 카테고리별 시드 데이터
│       └── intrastructure/           # 이메일(Nodemailer), Redis
├── frontend/                         # Next.js 15 App Router (포트 3000)
│   └── src/
│       ├── app/
│       │   ├── (auth)/               # 로그인, 회원가입, 이메일 인증
│       │   ├── (main)/               # 상품, 장바구니, 주문, 마이페이지, 판매자
│       │   ├── (admin)/              # ★ 관리자 화면 (SSR ADMIN 역할 검증)
│       │   └── api/auth/             # Route Handlers (login/refresh/logout 프록시)
│       ├── service/                  # axios 호출 함수 모음
│       ├── hooks/                    # TanStack Query 커스텀 훅
│       ├── lib/axios/                # publicClient / authClient (401 retry)
│       ├── lib/charts/               # 차트 데이터 변환 유틸
│       ├── components/               # 공통 UI 컴포넌트
│       ├── contexts/                 # AuthContext
│       ├── providers/                # ReactQueryProvider
│       └── middleware.ts             # /admin/* Edge 보호 (refreshToken 쿠키 검사)
├── shared/                           # 두 앱이 공유하는 패키지
├── Dockerfile                        # 멀티스테이지 백엔드 전용 (5단계)
├── docker-compose.local.yaml         # 로컬 개발용: Postgres + Redis만
├── docker-compose.prod.yaml          # EC2 운영용: Docker Hub pull
└── docs/                             # 설계 문서, 배포 이슈 기록
```

---

## 주요 기능

### 인증 & 세션

- JWT Access Token + Refresh Token (httpOnly 쿠키) 이중 토큰 방식
- 이메일 인증 기반 회원가입 (Nodemailer + Redis TTL)
- 다중 디바이스 세션 관리 및 개별/전체 세션 해제
- 역할 기반 접근 제어 (`BUYER` / `SELLER` / `ADMIN`)

### 상품 & 카테고리

- 판매자 상품 등록 → 관리자 승인/반려 워크플로우 (`PENDING → APPROVED / REJECTED`)
- 계층형 카테고리 (부모-자식) + 카테고리별 스펙 필드 (JSONB) — 6개 카테고리 (뷰티, 도서, 의류, 식품, 리빙, 신발)
- 태그 시스템, 다중 이미지 업로드, 재고 관리

### 장바구니 & 주문

- 장바구니 기반 주문 생성
- 주문 상태 머신: `PENDING_PAYMENT → PAID → PREPARING → SHIPPED → DELIVERED → COMPLETED`
- 멀티 셀러 배송 분리: 하나의 주문에 여러 판매자가 포함될 때 **판매자 단위로 Shipment 분리**
- 운송장 번호, 택배사 입력, 주문 취소, 구매 확정

### 결제 (PortOne V2)

- PortOne 결제 검증 및 금액 위변조 탐지
- Webhook 비동기 결제 상태 동기화 + 멱등성 처리
- 전체/부분 환불 처리

### 판매자 & 정산

- 구매자 → 판매자 전환 신청 → 관리자 승인/반려
- 주문 완료 시 자동 정산 내역 생성 (기본 수수료 10%)
- 정산 상태 관리: `PENDING → CONFIRMED → PAID`

### 리뷰 / 문의 / 찜

- 주문 완료 후 리뷰 작성 (이미지 첨부, 1~5점 평점)
- 상품 문의 및 판매자 답변 (비밀 문의 지원)
- 찜 목록 토글

### 관리자 대시보드 (신규)

백엔드 `admin/dashboard` API + 프론트엔드 `(admin)/` 라우트 그룹으로 구성된 관리자 전용 화면입니다.

| 차트 | 설명 | 캐시 TTL |
|------|------|---------|
| **KPI 카드** | 오늘 주문 수, 매출, 미배송 건수, 로그인 실패율 (전일 대비 delta %) | 1분 |
| **주문 트렌드** | 일별 주문/결제/취소 추이, 전 기간 비교 | 5분 |
| **보안 차트** | 일별 로그인 실패 수, 계정 잠금 수, 실패율 | 5분 |
| **결제 전환 펀넬** | 주문 생성 → 결제 → 준비 → 배송 → 구매 확정 단계별 전환율 | 10분 |

- Edge Middleware(`middleware.ts`)에서 refreshToken 쿠키 존재 여부 1차 확인
- SSR layout(`(admin)/layout.tsx`)에서 `/auth/me` 호출 후 `ADMIN` 역할 2차 검증

### 보안 & 감사 로그

- 61개 이상의 감사 액션으로 인증, 주문, 결제, 상품, 정산 전 영역 추적
- `AuditInterceptor` + `@Auditable()` 커스텀 데코레이터 — 비즈니스 로직 무변경 자동 로깅
- IP 주소, User-Agent, 성공/실패 기록
- Helmet 보안 헤더 + CSP, Rate Limiting (Throttler)

---

## 프론트엔드 아키텍처

### Next.js App Router 라우트 구조

```
app/
├── (auth)/          # 공개 — 로그인, 회원가입, 이메일 인증
├── (main)/          # 일반 사용자
│   ├── products/    # 상품 목록 / 상세
│   ├── cart/        # 장바구니
│   ├── checkout/    # 결제 + 완료
│   ├── my/          # 마이페이지 (주문, 리뷰, 문의, 찜, 비밀번호)
│   └── seller/      # 판매자 화면 (상품 관리, 주문, 정산, 문의)
├── (admin)/         # 관리자 전용 (ADMIN 역할 SSR 검증)
│   └── admin/
│       ├── dashboard/    # KPI + 차트 4종
│       ├── products/     # 상품 승인/반려
│       ├── orders/       # 주문 관리
│       ├── sellers/      # 판매자 신청 관리
│       ├── settlements/  # 정산 관리
│       ├── categories/   # 카테고리 관리
│       └── audit-logs/   # 감사 로그 조회
└── api/auth/        # Route Handlers — login/refresh/logout (쿠키 프록시)
```

### 상태 관리 & API 연동

```
서비스 계층 (service/*.ts)
  └── authClient / publicClient (lib/axios/axios-http-client.ts)
        ├── publicClient: 인증 불필요 요청
        └── authClient:   Authorization 헤더 자동 첨부
                          401 발생 → /auth/refresh 후 원 요청 재시도
                          동시 다발 401: isRefreshing 플래그 + Promise queue
                          (race-condition 방지)

커스텀 훅 (hooks/*.ts)
  └── TanStack Query useQuery / useMutation
        ├── queryKey 기반 캐시 자동 무효화
        └── 대시보드 차트: 차트별 staleTime 차등 (1분~10분)
```

### 인증 쿠키 흐름

1. 로그인 → Next.js Route Handler(`/api/auth/login`) 경유 → 백엔드 응답의 `Set-Cookie`(refreshToken)를 프론트 도메인 쿠키로 전달
2. 이후 axios 요청에 `withCredentials: true`로 쿠키 자동 동봉
3. accessToken 만료(401) → interceptor가 `/api/auth/refresh` 호출 → 새 accessToken으로 원 요청 재시도

---

## ERD

```
┌──────────┐    M:M    ┌──────────┐
│   User   │──────────▶│   Role   │
│          │           │(BUYER/   │
│          │           │ SELLER/  │
│          │           │ ADMIN)   │
└────┬─────┘           └──────────┘
     │
     ├── 1:1 ── Cart ── 1:M ── CartItem ── M:1 ── Product
     │
     ├── 1:1 ── Seller ── 1:M ── Product
     │                     1:M ── Settlement
     │                     1:M ── Shipment
     │
     ├── 1:M ── Order ── 1:M ── OrderItem ── M:1 ── Product
     │                    1:1 ── Payment          M:1 ── Seller
     │                    1:M ── Shipment
     │
     ├── 1:M ── Review   ── M:1 ── Product
     ├── 1:M ── Inquiry  ── M:1 ── Product / M:1 ── Seller
     ├── 1:M ── WishListItem ── M:1 ── Product
     └── 1:M ── RefreshToken

Product ── M:1 ── Category (self-referential: parent-child)
        ── M:M ── Tag
        ── 1:M ── ProductImage
```

---

## API 명세 요약

### 인증 (`/v1/auth`)

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| POST | `/register` | 회원가입 | Public |
| POST | `/login` | 로그인 | Public |
| GET | `/me` | 내 정보 조회 | User |
| POST | `/refresh` | 토큰 갱신 | Public |
| POST | `/logout` | 로그아웃 | User |
| POST | `/logout-all` | 전체 세션 해제 | User |
| GET | `/sessions` | 세션 목록 조회 | User |
| DELETE | `/sessions/:tokenId` | 세션 해제 | User |
| GET | `/verify-email` | 이메일 인증 | Public |

### 상품 (`/v1/products`)

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| GET | `/` | 상품 목록 (카테고리/키워드 필터, 페이지네이션) | Public |
| GET | `/:id` | 상품 상세 | Public |
| POST | `/` | 상품 등록 | Seller |
| PATCH | `/:id` | 상품 수정 | Seller |
| DELETE | `/:id` | 상품 삭제 | Seller |
| POST | `/:id/images` | 이미지 업로드 | Seller |

### 주문 & 결제 (`/v1/orders`, `/v1/payments`)

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| POST | `/orders` | 주문 생성 | Buyer |
| GET | `/orders` | 내 주문 목록 | Buyer |
| PATCH | `/orders/:id/cancel` | 주문 취소 | Buyer |
| PATCH | `/orders/:id/confirm` | 구매 확정 | Buyer |
| POST | `/payments/verify` | 결제 검증 | Buyer |
| POST | `/payments/:id/cancel` | 결제 취소 | Buyer |
| POST | `/payments/webhook` | PortOne Webhook | Public |

### 판매자 (`/v1/seller`)

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| POST | `/apply` | 판매자 신청 | Buyer |
| GET | `/orders` | 판매자 주문 목록 | Seller |
| PATCH | `/orders/:id/ship` | 배송 처리 | Seller |
| GET | `/settlements` | 정산 내역 | Seller |

### 관리자 (`/v1/admin`)

| Method | Endpoint | 설명 | 권한 |
|--------|----------|------|------|
| PATCH | `/products/:id/approve` | 상품 승인 | Admin |
| PATCH | `/products/:id/reject` | 상품 반려 | Admin |
| PATCH | `/seller/applications/:id/approve` | 판매자 승인 | Admin |
| PATCH | `/settlements/:id/confirm` | 정산 확인 | Admin |
| PATCH | `/settlements/:id/pay` | 정산 지급 | Admin |
| GET | `/audit-logs` | 감사 로그 조회 | Admin |
| GET | `/dashboard/kpi` | KPI 지표 | Admin |
| GET | `/dashboard/order-trend` | 주문 트렌드 | Admin |
| GET | `/dashboard/security` | 보안 이벤트 | Admin |
| GET | `/dashboard/funnel` | 결제 전환 펀넬 | Admin |

---

## 로컬 실행 방법

### 사전 준비

- Node.js 20 LTS
- Docker Desktop
- Corepack 활성화: `corepack enable && corepack prepare yarn@4.10.3 --activate`

### 1. 의존성 설치

```bash
yarn install
```

### 2. 환경 변수 설정

```bash
# backend/.env
PORT=4000
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=sangmoon
POSTGRES_PASSWORD=postgres
POSTGRES_DB=sangmoon
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your_secret
JWT_REFRESH_SECRET=your_refresh_secret
MAIL_HOST=smtp.naver.com
MAIL_PORT=587
MAIL_USER=your_naver_id@naver.com
MAIL_PASSWORD=your_password
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
PORTONE_API_SECRET=your_portone_v2_secret

# frontend/.env
NEXT_PUBLIC_API_URL=http://localhost:4000/v1
NEXT_PUBLIC_PORTONE_STORE_ID=your_store_id
NEXT_PUBLIC_PORTONE_CHANNEL_KEY=your_channel_key
```

### 3. 인프라 실행 (PostgreSQL + Redis)

```bash
docker compose -f docker-compose.local.yaml up -d
```

### 4. 앱 실행

```bash
# 백엔드 (별도 터미널)
yarn nx serve backend    # http://localhost:4000/v1

# 프론트엔드 (별도 터미널)
yarn nx serve frontend   # http://localhost:3000
```

### Nx 주요 명령

```bash
yarn nx build backend --prod   # 프로덕션 빌드
yarn nx test backend           # Jest 테스트
yarn nx lint backend           # ESLint
yarn nx run-many -t lint test  # 전체 lint + test
yarn nx reset                  # Nx 캐시 초기화
```

---

## 설계 결정 & 기술적 도전

### 결제 동시성 문제 해결

결제 완료(PortOne Webhook)와 주문 취소 요청이 동시에 도달하면 주문 상태가 불일치하는 **유령 결제** 문제가 발생했습니다. 트랜잭션 격리 수준 조정과 상태 체크 순서 변경(주문 상태 선확인 후 결제 검증)으로 해결했습니다.

### 감사 로그 시스템

이커머스의 민감한 동작(결제, 주문, 환불)을 비즈니스 로직 수정 없이 추적하기 위해, NestJS Interceptor와 `@Auditable()` 커스텀 데코레이터를 조합하여 **AOP 방식의 자동 로깅 구조**를 설계했습니다. 61개 이상의 액션 타입이 정의되어 있습니다.

### 멀티 셀러 배송 분리

하나의 주문에 여러 판매자 상품이 섞일 수 있기 때문에, 주문(Order) 단위가 아닌 **판매자(Seller) 단위로 Shipment 엔티티를 분리**했습니다. 각 판매자가 독립적으로 배송 처리를 할 수 있습니다.

### 프론트 401 재시도 Race Condition 방지

accessToken 만료 시 동시에 여러 요청이 401을 받으면 refresh 요청이 중복 발생합니다. `isRefreshing` 플래그와 Promise queue를 사용해 단일 refresh만 실행되고 이후 요청은 그 결과를 기다리도록 구현했습니다.

### Vercel 프록시를 통한 EC2 HTTPS 대체

EC2에 nginx + Let's Encrypt를 구성하는 대신, Next.js `rewrites()`를 통해 Vercel 서버가 EC2를 서버사이드에서 호출하는 방식을 선택했습니다. 브라우저는 Vercel 도메인에만 요청하므로 `Secure` 쿠키, CORS 이슈 없이 운영할 수 있습니다. 향후 API 전용 도메인 발급 시 nginx 방식으로 전환 예정이며 `next.config.js` 주석에 전환 코드를 보관하고 있습니다.

---

## 후기

실제 이커머스 서비스의 복잡한 비즈니스 로직을 처음부터 직접 설계하고 구현하는 과정이었습니다.

백엔드에서는 결제 동시성 문제와 트랜잭션 흐름을 관리하는 것이 가장 도전적이었고, 프론트엔드를 추가하면서는 JWT 쿠키 전달 경로, CORS, Vercel 프록시 구조 등 네트워크 계층을 직접 설계하고 트러블슈팅하는 경험을 쌓을 수 있었습니다.

단순 CRUD를 넘어 역할 기반 접근 제어, 감사 로그, 정산 시스템, 관리자 대시보드까지 이커머스 전체 흐름을 구현함으로써 백엔드와 프론트엔드 양쪽에서 실무에 가까운 감각을 기를 수 있었습니다.

추후 개선 예정: EC2 nginx + HTTPS 전환, 마이그레이션 도입, 테스트 코드 보강.
