# MVP 체크리스트

> **작성일:** 2026-05-27
> **작성 방식:** 이미 구현된 코드를 역공학으로 분석하여 추론
> **대상 범위:** 백엔드(NestJS, ~15k줄) + 프론트엔드(Next.js, ~10k줄) 통합
> **합성 방법:** 백엔드/프론트엔드를 두 개의 정찰 에이전트로 병렬 분석한 결과를 기능 단위로 매칭

---

## 범례

| 마크 | 의미 |
|------|------|
| `[x]` | **완료** — 백엔드 API + 프론트엔드 UI 모두 연결되어 동작 |
| `[~]` | **부분 구현** — 한쪽만 구현되었거나 UI가 스텁(placeholder) 상태 |
| `[ ]` | **미구현** — 양쪽 모두 없음 (또는 코드에서 확인 안 됨) |
| `BE` / `FE` | 각각 백엔드 / 프론트엔드 |

---

## 1. 인증 & 세션 관리

### 회원가입 & 이메일 인증
- [x] **이메일/비밀번호 회원가입**
  - BE: `POST /auth/register` → [auth.controller.ts](backend/src/auth/auth.controller.ts)
  - FE: [RegisterForm.tsx](frontend/src/components/forms/RegisterForm.tsx) — Zod 검증(비밀번호 복잡도, 전화번호 형식)
- [x] **이메일 인증 토큰 발송 & 검증**
  - BE: `GET /auth/verify-email`, `POST /auth/resend-verification` (Nodemailer SMTP)
  - FE: `/verify-email`, `/check-email` 페이지
- [x] **이메일/닉네임 중복 확인 API**
  - BE: `GET /auth/check-email`, `GET /auth/check-nickname`
  - FE: ⚠ 호출 위치 미확인 — 회원가입 폼에서 실시간 중복 체크 연결 검토 필요

### 로그인 & 토큰
- [x] **이메일/비밀번호 로그인 + Remember Me**
  - BE: `POST /auth/login`
  - FE: [LoginForm.tsx](frontend/src/components/forms/LoginForm.tsx)
- [x] **데모 계정 로그인** (포트폴리오 데모용)
  - BE: `POST /auth/demo-login`
  - FE: LoginForm 데모 버튼
- [x] **JWT + RefreshToken 회전(RTR)**
  - BE: AccessToken 15분, RefreshToken httpOnly 쿠키, RTR 구현
  - FE: [axios-http-client.ts](frontend/src/lib/axios/axios-http-client.ts) 인터셉터 — 401 자동 갱신(최대 3회)
- [x] **로그아웃 (현재 세션)**
  - BE: `POST /auth/logout`
  - FE: AuthContext.logout()
- [x] **현재 사용자 정보 조회**
  - BE: `GET /auth/me`
  - FE: AuthContext의 `getMe()` (BroadcastChannel로 탭 간 동기화)

### 다중 세션 관리 — **백엔드만 구현**
- [~] **활성 세션 목록 조회** — BE: `GET /auth/sessions` ✅ / FE: ❌ 호출 없음
- [~] **특정 세션 취소** — BE: `DELETE /auth/sessions/:tokenId` ✅ / FE: ❌
- [~] **모든 디바이스 로그아웃** — BE: `POST /auth/logout-all` ✅ / FE: ❌
- 👉 **권장:** "내 세션 관리" 페이지를 `/my` 하위에 추가하면 BE 자원 100% 활용 가능

---

## 2. 사용자 프로필

- [x] **프로필 조회** — BE: `GET /v1/users/me` / FE: AuthContext에서 사용
- [~] **프로필 수정 (닉네임/주소 등)** — BE: `PATCH /v1/users/me` ✅ / FE: `/my` 페이지 스텁
- [x] **비밀번호 변경** — BE: `PATCH /v1/users/me/password` / FE: `/my/password`

---

## 3. 상품 (구매자 관점)

- [x] **상품 목록 조회 (페이지네이션/검색/필터/정렬)**
  - BE: `GET /products` (APPROVED+PUBLISHED만, Throttle 60/min)
  - FE: `/products` (SSR prefetch + HydrationBoundary, staleTime 60s)
- [x] **상품 상세 조회**
  - BE: `GET /products/:id`
  - FE: `/products/[id]` (ISR 5분 + 온디맨드 갱신 tags)
- [x] **카테고리별 / 키워드 검색**
  - BE: 쿼리 파라미터(`categoryId`, `keyword`, `sortBy`)
  - FE: ProductsClient에서 필터 UI

### 다중 카테고리 도메인 모델
- [x] **카테고리별 특화 엔티티** — BeautyEntity, ClothingEntity, FoodEntity, BookEntity, LivingProductEntity, ShoesEntity (BE)

---

## 4. 카테고리

- [x] **계층형 카테고리 트리 조회** — BE: `GET /categories` (Throttle 120/min) / FE: Banner, CategoryTabSection
- [x] **슬러그 기반 단건 조회** — BE: `GET /categories/:slug` / FE: 사용 위치 확인 필요

---

## 5. 장바구니

- [x] **장바구니 조회** — BE: `GET /cart` / FE: `/cart`, `/checkout`
- [x] **상품 추가 (기존은 수량 증가)** — BE: `POST /cart/items` / FE: `useAddToCart`
- [x] **수량 수정** — BE: `PATCH /cart/items/:itemId` / FE: `useUpdateCartItem`
- [x] **항목 삭제** — BE: `DELETE /cart/items/:itemId` / FE: `useRemoveCartItem`
- [x] **장바구니 비우기** — BE: `DELETE /cart` / FE: `useClearCart`

---

## 6. 주문 (구매자 관점)

- [x] **주문 생성** — BE: `POST /orders` (PENDING_PAYMENT 상태로 생성) / FE: `/checkout`
- [x] **내 주문 목록 (상태 필터/페이지네이션)** — BE: `GET /orders` / FE: `/my/orders`
- [x] **주문 상세 조회** — BE: `GET /orders/:orderNumber` / FE: `/my/orders/[orderNumber]`
- [x] **주문 취소** (PENDING_PAYMENT만) — BE: `PATCH /orders/:orderNumber/cancel` / FE: `useCancelOrder`
- [x] **구매 확정** (배송 완료 후) — BE: `PATCH /orders/:orderNumber/confirm` / FE: `useConfirmOrder`

---

## 7. 결제

- [x] **PortOne V2 결제 검증** — BE: `POST /payments/verify` / FE: `/checkout` 결제 검증 흐름
- [x] **환불 신청** — BE: `POST /payments/:orderNumber/cancel` / FE: `useCancelPayment`
- [x] **결제 웹훅** — BE: `POST /payments/webhook` (SkipThrottle, 감사 로그 자동 기록)
- [x] **주문 완료 안내 페이지** — FE: `/checkout/complete`

---

## 8. 위시리스트

- [x] **위시리스트 추가/제거 (토글)** — BE: `POST /v1/wishlist/toggle` / FE: `useWishlistToggle`
- [~] **위시리스트 조회** — BE: `GET /v1/wishlist` ✅ / FE: `/my/wishlist` 페이지 존재(스텁 가능성)
- [~] **위시리스트 전체 삭제** — BE: `DELETE /v1/wishlist` ✅ / FE: 호출 위치 미확인

---

## 9. 리뷰

- [~] **리뷰 작성** (1주문 1리뷰, 평점 1-5, 이미지 첨부) — BE: `POST /v1/reviews` ✅ / FE: 작성 UI 호출 위치 미확인
- [~] **상품별 리뷰 조회** — BE: `GET /v1/reviews/product/:productId` ✅ / FE: 상품 상세에서 호출 여부 미확인
- [~] **내 리뷰 목록** — BE: `GET /v1/reviews/my` ✅ / FE: `/my/reviews` (스텁 가능성)
- [~] **리뷰 수정/삭제** — BE: `PATCH /v1/reviews/:id`, `DELETE /v1/reviews/:id` ✅ / FE: 미확인
- 👉 **권장:** 상품 상세 페이지에 리뷰 섹션, `/my/reviews`에 작성/수정 UI 연결이 가장 큰 갭

---

## 10. 상품 문의

- [~] **문의 생성** — BE: `POST /v1/inquiries` ✅ / FE: 작성 UI 미확인
- [~] **상품별 문의 공개 조회** (비공개 문의는 마스킹) — BE: `GET /v1/inquiries/product/:productId` ✅ / FE: 상품 상세 연결 미확인
- [~] **내 문의 목록** — BE: `GET /v1/inquiries/my` ✅ / FE: `/my/inquiries` (스텁 가능성)
- [~] **문의 삭제** — BE: `DELETE /v1/inquiries/:id` ✅ / FE: 미확인

---

## 11. 셀러 신청 (BUYER → SELLER)

- [~] **셀러 신청 제출** — BE: `POST /seller/apply` ✅ / FE: `/my/seller-apply` 페이지 존재(스텁 가능성)
- [~] **신청 현황 조회** — BE: `GET /seller/me` ✅ / FE: 미확인

---

## 12. 셀러 운영 기능 — **백엔드 완성 / 프론트엔드 전부 스텁**

### 셀러 상품 관리
- [~] **내 상품 목록 조회** — BE: `GET /products/my` ✅ / FE: `/seller/products` 스텁
- [~] **상품 등록** — BE: `POST /products` ✅ / FE: `/seller/products/new` 스텁
- [~] **상품 수정/삭제** — BE: `PATCH/DELETE /products/:id` ✅ / FE: 미구현
- [~] **상품 이미지 업로드** (5MB, Multer) — BE: `POST /products/:id/images` ✅ / FE: 미구현

### 셀러 주문/배송 관리
- [~] **셀러 주문 목록** — BE: `GET /seller/orders` ✅ / FE: `/seller/orders` 스텁
- [~] **배송 처리** (운송장 등록) — BE: `PATCH /seller/orders/:orderNumber/ship` ✅ / FE: 스텁

### 셀러 고객 문의 대응
- [~] **상품별 문의 조회** — BE: `GET /v1/seller/inquiries` ✅ / FE: `/seller/inquiries` 스텁
- [~] **문의 답변** — BE: `PATCH /v1/seller/inquiries/:id/answer` ✅ / FE: 스텁

### 셀러 정산 조회
- [~] **정산 내역 조회** — BE: `GET /v1/seller/settlements` ✅ / FE: `/seller/settlements` 스텁
- [~] **정산 요약** (수수료 10%, 실수령액) — BE: `GET /v1/seller/settlements/summary` ✅ / FE: 스텁

---

## 13. 관리자 기능 — **백엔드 완성 / 프론트엔드는 대시보드만 구현**

### 관리자 대시보드 (구현 완료)
- [x] **KPI** (총매출, 주문수, 활성 사용자, 신규 사용자) — BE: `GET /admin/dashboard/kpi` / FE: `KpiCards` (staleTime 60s)
- [x] **주문 트렌드** (일일 매출, 전기 비교) — BE: `GET /admin/dashboard/order-trend` / FE: 차트
- [x] **보안 지표** (실패 로그인 등) — BE: `GET /admin/dashboard/security` / FE: 차트
- [x] **결제 펀넬** (5단계 전환율) — BE: `GET /admin/dashboard/funnel` / FE: 차트

### 관리자 상품 관리
- [~] **모든 상품 조회 (대기 포함)** — BE: `GET /admin/products` ✅ / FE: `/admin/products` 스텁
- [~] **상품 승인** — BE: `PATCH /admin/products/:id/approve` ✅ / FE: 스텁
- [~] **상품 거절** (reason 필수) — BE: `PATCH /admin/products/:id/reject` ✅ / FE: 스텁

### 관리자 카테고리 관리
- [~] **카테고리 CRUD** — BE: `POST/PATCH/DELETE /admin/categories` ✅ / FE: `/admin/categories` 스텁
- [~] **카테고리 표시/숨김** — BE: `PATCH /admin/categories/:id/visibility` ✅ / FE: 스텁

### 관리자 주문 관리
- [~] **모든 주문 조회** — BE: `GET /admin/orders` ✅ / FE: `/admin/orders` 스텁
- [~] **주문 상세** — BE: `GET /admin/orders/:orderNumber` ✅ / FE: `/admin/orders/[orderNumber]` 스텁
- [~] **배송 완료 처리** — BE: `PATCH /admin/orders/:orderNumber/deliver` ✅ / FE: 스텁

### 관리자 셀러 관리
- [~] **셀러 신청 목록** — BE: `GET /seller/applications` ✅ / FE: `/admin/sellers` 스텁
- [~] **셀러 승인/거절** — BE: `PATCH /seller/applications/:id/approve|reject` ✅ / FE: 스텁

### 관리자 정산 관리
- [~] **모든 정산 조회** — BE: `GET /v1/admin/settlements` ✅ / FE: `/admin/settlements` 스텁
- [~] **정산 확정** — BE: `PATCH /v1/admin/settlements/:id/confirm` ✅ / FE: 스텁
- [~] **정산 지급 완료** — BE: `PATCH /v1/admin/settlements/:id/pay` ✅ / FE: 스텁

### 관리자 결제 강제 환불
- [~] **강제 환불** — BE: `POST /admin/payments/:orderNumber/cancel` ✅ / FE: 스텁

### 감사 로그 조회
- [~] **감사 로그 조회** (사용자별/액션별 필터) — BE: `GET /v1/admin/audit-logs` ✅ / FE: `/admin/audit-logs` 스텁

---

## 14. 횡단 관심사 (Cross-cutting Concerns)

### 보안
- [x] **RBAC** — ADMIN / SELLER / BUYER (user_roles 조인 테이블)
- [x] **JwtAuthGuard + RolesGuard**
- [x] **DemoAccountGuard** — 데모 계정의 위험한 액션 차단
- [x] **Rate Limiting** — 전역 100/min, 엔드포인트별 override (`@Throttle`, `@SkipThrottle`)
- [x] **Helmet** (HTTP 보안 헤더)
- [x] **httpOnly 쿠키 + withCredentials**
- [x] **bcrypt 비밀번호 해싱**

### 감사 로깅
- [x] **AuditInterceptor** — 70+ AuditAction 자동 기록
- [x] **@Auditable 데코레이터** — 요청 본문 특정 필드 캡처
- [x] **시스템 감사 로그** — CRON_ORDER_EXPIRED, CRON_SHIPMENT_AUTO_DELIVERED, CRON_ORDER_AUTO_COMPLETED

### 이벤트 기반 아키텍처
- [x] **EventEmitter** — ProductEventListener, ReviewEventListener, OrderEventListener, SettlementEventListener

### 예약 작업 (Cron)
- [x] **@nestjs/schedule** 등록 — 미결제 주문 만료, 배송 자동 완료, 주문 자동 확정 (구체 일정 코드 확인 필요)

### 인프라
- [x] **PostgreSQL + TypeORM** (마이그레이션 체계 확인 필요)
- [x] **Redis (ioredis)** — 글로벌 모듈로 등록 (구체적 용도 확인 필요: 세션/캐시/블랙리스트 추정)
- [x] **Nodemailer SMTP**
- [x] **Multer 파일 업로드** (./uploads 로컬)
- [x] **Docker** (Dockerfile.backend, Dockerfile.frontend, docker-compose.yaml)

### 프론트엔드 횡단
- [x] **TanStack React Query v5** — SSR Hydration, staleTime/구조화된 쿼리키
- [x] **React Context 인증 상태** (BroadcastChannel 탭 동기화)
- [x] **axios 인터셉터** (401 자동 갱신, 최대 3회 재시도)
- [x] **Next.js 미들웨어** (`/admin/*` 진입 시 refreshToken 체크)
- [x] **AdminGuard** (역할 검증)
- [x] **Tailwind + Emotion** (자체 디자인 시스템 — shadcn 미사용)
- [x] **SSR Prefetch** (상품 목록/상세) + **ISR** (상품 상세 5분)

### 테스트
- [~] **백엔드 단위/통합 테스트** — auth, user, product, category, review, wish-list, audit 등 21개 스펙 파일 (커버리지 측정은 별도)
- [ ] **프론트엔드 테스트** — 정찰 결과에서 명시적 확인 안 됨

---

## 종합 평가

### 구현 완성도 한눈에 보기

| 영역 | BE | FE | 상태 |
|------|----|----|------|
| 인증/계정 | ✅ | ✅ | **완료** (다중 세션 UI만 미구현) |
| 상품 구매 플로우 (가입→상품→장바구니→주문→결제) | ✅ | ✅ | **완료** |
| 리뷰 / 위시리스트 / 문의 | ✅ | ⚠ | **부분** — UI 연결 갭 多 |
| 셀러 운영 (상품/주문/문의/정산) | ✅ | ❌ | **백엔드만** — FE 전부 스텁 |
| 관리자 대시보드 (KPI/트렌드/펀넬) | ✅ | ✅ | **완료** |
| 관리자 운영 (상품 승인/카테고리/주문/셀러/정산) | ✅ | ❌ | **백엔드만** — FE 전부 스텁 |
| 보안/감사/이벤트/Cron | ✅ | — | **완료** |

### 우선순위 보완 권장 (MVP 마무리 관점)

1. **🔴 높음 — 핵심 사용자 경험 갭**
   - **리뷰 작성/조회 UI**: 백엔드는 완성, 상품 상세와 `/my/reviews`에서 연결 누락
   - **상품 문의 UI**: 동일 — 상품 상세에 Q&A 섹션, `/my/inquiries`에서 작성 UI 연결
   - **프로필 수정 페이지**: `/my` 스텁 → 닉네임/주소 변경 UI

2. **🟡 중간 — 셀러 측 최소 운영 가능성**
   - **셀러 상품 등록 폼**: `/seller/products/new` 스텁 → 백엔드 `POST /products` 호출 연결
   - **셀러 주문/배송 처리**: 운송장 입력 UI

3. **🟢 낮음 — 관리자 측 (현재 대시보드로 모니터링은 가능)**
   - **상품 승인 UI**: `/admin/products` 스텁 → 대기 목록 + 승인/거절 버튼
   - **셀러 승인 UI**: `/admin/sellers` 스텁

4. **🔵 부가 — 백엔드 자원 100% 활용**
   - **세션 관리 UI** (`/my/sessions`): 다중 디바이스 로그아웃 기능
   - **이메일/닉네임 실시간 중복 체크**: 회원가입 UX 향상

### 강점

- **백엔드는 상용 수준의 완성도** — RBAC, RTR, 감사 로그, 이벤트, Cron, Rate Limiting, 결제 PG 연동, 정산 계산까지 모두 갖춤
- **구매자 측 골든 패스(가입~결제~배송 추적)는 풀스택으로 동작**
- **관리자 대시보드의 데이터 시각화 완성** — 포트폴리오 어필 포인트

---

## 인벤토리 추론 시 불확실했던 영역

1. **Redis 구체적 용도** — ioredis 모듈 등록은 확인했으나 실제 저장소(세션/토큰 블랙리스트/캐시) 사용 위치는 서비스 코드 추가 스캔 필요
2. **Cron 작업 일정** — `@nestjs/schedule` 등록은 확인, 구체적 트리거 시점(`@Cron('...')`) 미확인
3. **프론트엔드 일부 페이지** — `/my/wishlist`, `/my/reviews`, `/my/inquiries`의 실제 구현 vs 스텁 여부는 페이지 내부 코드 확인 필요
4. **상품 상세 페이지 구성** — ProductDetailClient의 리뷰/문의/장바구니 추가 UI 실제 구현 범위 미확인
