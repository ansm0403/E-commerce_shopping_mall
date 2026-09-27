# 01-2. 셀러 센터 완성 — 셀러 셸(관리자 UI 공유) · 대시보드 · 상품 문의(구매자 → 셀러 → 관리자)

> **설계 문서(2026-09-28, 착수 전)**. 01-seller-core §1-B 의 후순위 두 항목(셀러 대시보드 · 셀러 문의 답변)을 이력서 전에 채우기 위한 계획이다.
> 아래 "현재 상태"는 전부 **이 날짜의 코드를 직접 읽고** 적은 것이며, 결정은 위임 원칙대로 **추천 1개 + 이유**로 적었다.
> 구현이 끝나면 이 문서 맨 아래 진행표를 채우고, 01-seller-core §1-B · CLAUDE.md §5 · 루트 README §3 의 stub 서술을 사실대로 바꾼다.

## 0. 한 문장 목표와 이유

**셀러가 로그인하면 관리자 콘솔과 같은 모양의 "셀러 센터"가 열리고, 첫 화면(대시보드)에서 판매 현황과 판매 중 상품을 보며, 구매자가 상품 상세에서 남긴 문의에 답변한다. 관리자는 그 문의를 AI 어시스턴트로 요약해 본다.**

왜 지금인가.

- 시연 대본의 **승인 직후 장면이 빈 화면**이다. 헤더 사용자 메뉴의 "셀러 센터"가 `/seller` 로 보내는데 그 파일이 3줄 stub 이다(`frontend/src/app/(main)/seller/page.tsx`).
- 상품 흐름(셀러 등록 → 관리자 승인 → 구매자 주문 → 배송 → 정산)은 완성돼 있지만 **구매자가 먼저 말을 거는 역방향 흐름이 없다.** 문의는 백엔드가 완성돼 있고(작성·상품별 조회·내 문의·삭제·셀러 목록·답변, 감사 로그 `INQUIRY_ANSWERED`, 어시스턴트 도구 `summarize_inquiries`), **프론트만 전무**하다 — 상품 상세 탭에 작성 폼이 없고 `my/inquiries`·`seller/inquiries` 가 stub, `service/inquiry.ts` 가 없다.
- 두 기능을 합치면 **구매자 → 셀러 → 관리자** 세 역할이 한 데이터(문의)를 순서대로 만지는 장면이 생긴다.

범위 밖(이 문서에서 하지 않는 것): 관리자 카테고리 stub, 셀러 스펙(JSONB) 입력 폼, 이미지 S3 전환, `my/wishlist`·`my/password` stub(단, `/my` 인덱스 리다이렉트 한 줄은 §6 ⑦에 포함).

---

## 1. 현재 상태 (2026-09-28, 코드 확인)

### 1-1. 셀러 화면과 셸

| 항목 | 파일 | 상태 |
|---|---|---|
| 셀러 라우트 위치 | `frontend/src/app/(main)/seller/{page,products,orders,settlements,inquiries}` | `(main)` 그룹 안 — 쇼핑몰 헤더·푸터 아래에 그려진다 |
| 셀러 공통 레이아웃 | `(main)/seller/layout.tsx` | `SellerGuard` + **텍스트 링크 4개**(상품 관리·상품 등록·주문/배송·정산)의 얇은 nav. 문의 링크 없음 |
| 셀러 가드 | `(main)/seller/components/SellerGuard.tsx` | `/auth/me` 로 seller 확인, 비-셀러는 `/my/seller-apply` 안내, 낡은 토큰은 `useSellerRoleSync` 로 refresh 1회 |
| 셀러 대시보드 | `(main)/seller/page.tsx` | **3줄 stub** |
| 셀러 문의 | `(main)/seller/inquiries/page.tsx` | **3줄 stub** |
| 관리자 셸 | `(admin)/layout.tsx` + `admin/components/AdminSidebar.tsx`(`NAV_ITEMS` 상수, md 이상 220px 사이드바 / md 미만 상단 바 + 가로 스크롤 칩) + `AdminGuard` + `DemoModeBanner` | 2026-09-28 반응형 완료. 항목·제목이 **하드코딩**돼 있어 그대로는 재사용 불가 |
| 라우트 보호 | `frontend/src/middleware.ts` | `matcher: ['/admin/:path*']` 만 refreshToken 쿠키 검사. `/seller` 는 없음 |
| 헤더 사용자 메뉴 | `components/header/topbar/UserMenu.tsx` | seller 면 "셀러 센터"(`/seller`), 아니면 "셀러 신청"(`/my/seller-apply`), admin 이면 "관리자 페이지" 추가. **역할 둘 다면 둘 다 보인다**(이미 요구사항 충족) |
| 마이페이지 | `(main)/my/*` | `orders`·`reviews`·`seller-apply` 실구현. `my`(인덱스)·`inquiries`·`wishlist`·`password`·`cart` 는 **3줄 stub**. `my/layout.tsx` 는 pass-through |

### 1-2. 대시보드에 쓸 수 있는 기존 API (백엔드 신규 없이 조합 가능)

| 필요한 수치 | 호출 | 근거 |
|---|---|---|
| 판매 중 상품 수 | `GET /products/my?page=1&take=1&approvalStatus=approved&status=published` → `meta.total` | `service/seller-product.ts fetchMyProducts`, `CommonService.paginate` 페이지 모드 meta 에 `total` |
| 승인 대기 상품 수 | 같은 호출, `approvalStatus=pending` | |
| 출고 대기 주문 수 | `GET /seller/orders?page=1&take=1&status=preparing` → `meta.total` | `SellerOrderFilters.tsx` 의 기본 탭 값이 `preparing` |
| 미답변 문의 수 | `GET /seller/inquiries?page=1&take=1&status=waiting` | **status 필터가 아직 없다** — §5 B-1 |
| 정산 요약 | `GET /seller/settlements/summary` → `totalSettlement`·`pendingCount`·`pendingAmount`·`confirmedCount`·`paidCount` | `settlement.service.ts` 54-65행 |
| 판매 중 상품 표 | `GET /products/my?page=1&take=10&approvalStatus=approved&status=published` | `SellerProduct` 타입(shared) |
| 최근 주문 | `GET /seller/orders?page=1&take=5&status=all`(전체 탭 값 확인) | `fetchSellerOrders` |

`page` 를 빼면 백엔드가 **커서 페이지네이션으로 분기**해 meta 모양이 달라진다(`count/hasNext/nextCursor`). 대시보드 호출은 전부 `page=1` 을 명시한다.

### 1-3. 문의 백엔드 계약 (완성, 그대로 쓴다)

| 메서드 | 경로 | 가드 | 동작 |
|---|---|---|---|
| POST | `/inquiries` | JWT + BUYER | `{productId,title(2~200),content,isSecret?}` → 상품의 `sellerId` 를 복사해 저장, `InquiryResponseDto`(user{id,nickName} 포함) |
| GET | `/inquiries/product/:productId` | **없음(공개)** | 페이지네이션. 비밀 문의는 본인이 아니면 제목 "비밀 문의입니다."·본문 ''·답변 null·닉네임 '***' 로 마스킹 |
| GET | `/inquiries/my` | JWT + BUYER | 내 문의 |
| DELETE | `/inquiries/:id` | JWT + BUYER | 본인 것만, **answered 면 400** |
| GET | `/seller/inquiries` | JWT + SELLER | 내 상품 문의 전체(필터 없음) |
| PATCH | `/seller/inquiries/:id/answer` | JWT + SELLER, `@Auditable(INQUIRY_ANSWERED)` | `{answer}` → status `answered`, `answeredAt` 기록. 남의 상품 403, 이미 답변 400 |

- 상태 enum `InquiryStatus = waiting | answered`(`inquiry.entity.ts`, shared 에도 동일).
- **shared 타입이 이미 있다**: `shared/src/lib/types/inquiry/inquiry.ts` — `Inquiry`·`InquiryResponse`(user 포함)·`CreateInquiryRequest`·`AnswerInquiryRequest`·`InquiryStatus`. 프론트는 이것을 import 한다(`answeredAt` 은 `string | null`).
- 시드: `backend/src/seed/inquiry.seed.service.ts` — 미답변 다수 + 답변완료 일부 + 비밀 소수. 로컬·운영 모두 데이터가 있다.
- 관리자 접점: 어시스턴트 도구 `summarize_inquiries`(`status: waiting` 필터, 비밀 문의는 메타만, PII 마스킹) + 감사 로그 화면의 `INQUIRY_ANSWERED`. **둘 다 변경 없음.**
- ⚠ **공개 목록에서 "본인 비밀글" 판정은 지금 동작하지 않는다.** `GET /inquiries/product/:id` 는 가드가 없고 전역 JWT 파싱도 없어(`APP_GUARD` 는 Throttler 뿐) `@User('sub')` 가 항상 undefined → `userId=null` → 작성자 본인도 상품 탭에서는 마스킹된 자기 글을 본다. §5 B-2 에서 다룬다.

---

## 2. 결정 (추천 1개 + 이유)

| # | 결정 | 이유 | 버린 안 |
|---|---|---|---|
| **D1** | **셀러 라우트를 새 그룹 `(seller)/seller/*` 로 옮기고, 관리자 셸을 공용 컴포넌트 `components/console/ConsoleShell` 로 뽑아 두 그룹이 같이 쓴다.** 셸 = `ConsoleSidebar`(props: `title`, `items`, `crossLink?`) + 배너 슬롯 + 가드 슬롯. `AdminSidebar` 는 `NAV_ITEMS` 를 넘기는 얇은 래퍼로 남긴다 | URL 은 그룹 이름을 타지 않아 `/seller/*` 그대로다(헤더 메뉴·seller-apply 링크·e2e 무변경). `(main)` 을 벗어나야 쇼핑몰 헤더·푸터 없이 관리자와 같은 "콘솔" 모양이 된다. 파일 깊이가 같아 상대 import 가 그대로 컴파일된다 | `(main)` 안에서 사이드바만 끼워 넣기 — 쇼핑몰 헤더 아래에 사이드바가 겹쳐 "관리자 UI 공유"가 되지 않는다 |
| **D2** | `middleware.ts` matcher 에 `/seller/:path*` 추가(쿠키 없으면 `/login?redirect=`) | 관리자와 같은 3중 방어(미들웨어 → 클라이언트 가드 → 백엔드 RolesGuard). `SellerGuard` 는 그대로 2단계 | — |
| **D3** | 헤더 메뉴는 **현행 유지**(seller → 셀러 센터, admin → 관리자 페이지, 둘 다면 둘 다). 대신 **셸 하단에 교차 링크**: 셀러 셸에는 admin 이면 "관리자 콘솔 →", 관리자 셸에는 seller 면 "셀러 센터 →"(`useAuth().user.roles` 로 판정, `UserMenu` 의 `hasRole` 을 유틸로 승격해 공유) | 두 역할을 가진 계정이 콘솔 사이를 오갈 때 헤더까지 돌아갈 필요가 없다 | 관리자 계정에서 "셀러 신청" 숨김 — 관리자가 셀러를 겸하는 시나리오가 없으니 그대로 둔다 |
| **D4** | 대시보드는 **기존 API 조합**(§1-2), 백엔드 신규 엔드포인트 0 | 이력서 전엔 화면이 목표. 집계 전용 엔드포인트는 호출 5개가 병목이 될 때 | `GET /seller/dashboard/summary` 신설 — 지금은 과설계 |
| **D5** | 백엔드 변경은 **2건만**: B-1 `GET /seller/inquiries?status=` 필터, B-2 공개 문의 목록의 선택적 JWT 파싱(§5) | B-1 없이는 미답변 탭·KPI 가 불가. B-2 없이는 "내가 쓴 비밀글이 상품 탭에서 마스킹"이라는 어색함이 시연에 그대로 보인다 | 프론트에서 전체를 받아 필터 — 페이지네이션과 충돌 |
| **D6** | 상품 상세에 **"문의" 탭** 추가(`ProductTabs.tsx` `tabs` 배열 + `ProductDetailClient.tsx` 분기). 목록은 공개, 작성 폼은 로그인 + BUYER 일 때만 | 리뷰 탭(`ReviewSection.tsx`)과 같은 자리·같은 패턴이라 사용자가 찾는다 | 별도 페이지 `/products/[id]/inquiries` — 진입 경로가 하나 더 필요 |
| **D7** | `/my/inquiries` 는 02-2 §③ 계획 그대로 구현하고, `/my`(인덱스)는 `redirect('/my/orders')` 한 줄 | 문의 왕복(작성 → 답변 확인)이 구매자 화면에서 닫혀야 한다. 인덱스 리다이렉트는 관리자 인덱스(`(admin)/admin/page.tsx`)와 같은 방식이고 stub 하나를 공짜로 줄인다 | 마이페이지 셸(좌측 네비) — 02-2 전체가 필요해 범위 밖 |
| **D8** | 답변은 **모달**(`SellerShipModal.tsx` 패턴), 답변 후 수정 없음(백엔드가 400) | 백엔드 계약을 UI 가 따른다. "답변 수정" API 는 없다 | 인라인 편집 |
| **D9** | 데모 계정 배너는 셀러 셸에도 같은 `DemoModeBanner` | 데모 관리자가 셀러 셸에 들어갈 일은 없지만 셸을 공유하면 공짜 | — |

---

## 3. 화면 설계

### 3-1. 셀러 셸 (D1)

```
(seller)/layout.tsx
└─ <ConsoleShell title="🏪 셀러 센터" items={SELLER_NAV} crossLink={isAdmin ? {href:'/admin/dashboard', label:'관리자 콘솔 →'} : undefined}>
     <SellerGuard>{children}</SellerGuard>
   </ConsoleShell>

SELLER_NAV = [
  { href: '/seller',              label: '대시보드' },   // exact 매칭 — isActive 가 startsWith 라 '/seller' 는 예외 처리
  { href: '/seller/products',     label: '상품 관리' },
  { href: '/seller/products/new', label: '상품 등록' },
  { href: '/seller/orders',       label: '주문/배송' },
  { href: '/seller/settlements',  label: '정산' },
  { href: '/seller/inquiries',    label: '문의' },
]
```

- `ConsoleSidebar` 는 `AdminSidebar` 의 `DesktopSidebar`/`MobileTopNav` 를 그대로 옮기고 `NAV_ITEMS`·제목만 props 로 받는다. 색·간격·반응형 분기(`hidden md:flex` / `md:hidden`)는 손대지 않는다 — 2026-09-28 에 검증된 모양이다.
- `isActive` 는 `pathname === href || pathname.startsWith(href + '/')` 인데 `/seller` 가 모든 하위와 겹친다 → 항목에 `exact?: true` 를 두거나 대시보드 href 만 완전 일치로 비교한다(`/admin` 은 인덱스가 리다이렉트라 이 문제가 없었다).
- 이동 대상: `(main)/seller/**` 전체(`components/SellerGuard.tsx` 포함) → `(seller)/seller/**`. 옛 `(main)/seller/layout.tsx` 의 텍스트 nav 는 삭제(셸이 대신한다).

### 3-2. 셀러 대시보드 `/seller` (D4)

위에서 아래로.

1. **KPI 카드 4장** — 판매 중 상품 · 승인 대기 상품 · 출고 대기 주문 · 미답변 문의. 각 카드는 해당 목록 화면으로 링크(승인 대기 → `/seller/products?approvalStatus=pending`, 출고 대기 → `/seller/orders`, 미답변 → `/seller/inquiries`). 값은 `meta.total`. 로딩은 스켈레톤, 실패는 카드 안에 "불러오지 못함".
2. **정산 요약 카드** — `totalSettlement`(누적 정산액) · `pendingAmount`(대기 금액, `pendingCount` 건) · 확정/지급 건수. `/seller/settlements` 로 링크. 금액 포맷은 `service/seller-order.ts formatAmount` 재사용.
3. **판매 중 상품 표(최근 10)** — 이름 · 가격 · 재고 · 상태 · 승인. 행 클릭 → `/seller/products/[id]/edit`. 0건이면 "판매 중인 상품이 없습니다 → 상품 등록" 링크. 표 스타일은 `(admin)/admin/components/table-ui.tsx`(가로 스크롤 포함) 재사용 — 셸을 공유하므로 `components/console/` 로 같이 옮긴다.
4. **최근 주문 5건** — 주문번호 · 상태 라벨(`orderStatusLabel`) · 금액 · 일시. 행 클릭 → `/seller/orders`.

데이터 훅: `hooks/seller-dashboard-query-options.ts` — 기존 `useMyProductsQuery`·주문·정산 쿼리 옵션을 조합하고 `staleTime 30s`, focus refetch 끔(관리자 대시보드 규칙과 같음). 쿼리 키는 기존 키를 그대로 써서 상품 토글·답변 뮤테이션의 invalidate 가 대시보드에도 닿게 한다.

### 3-3. 셀러 문의 `/seller/inquiries` (D8)

- 탭: **미답변(기본)** · 답변완료 · 전체 — URL `?status=waiting|answered|all`(`SellerOrderFilters` 와 같은 searchParams 방식).
- 표: 상품명(링크 `/products/[id]`) · 제목(비밀이면 🔒) · 작성자 닉네임 · 작성일 · 상태 배지. 페이지네이션은 셀러 상품 목록과 동일 컴포넌트.
- 행 클릭 → **답변 모달**: 문의 제목·본문·작성자·작성일 표시 + `textarea`(필수, 공백만이면 비활성) + [답변 등록]. 이미 답변된 행은 모달이 읽기 전용(답변 본문·`answeredAt`).
- 뮤테이션 성공 → `['seller','inquiries']`·`['seller','dashboard']` 무효화, 토스트 "답변이 등록되었습니다". 403/400 은 백엔드 메시지를 그대로 보여 준다.
- 상품명은 `InquiryResponse` 에 없다(`productId` 만). 표에서 상품명이 필요하면 **B-1 에서 `product.name` 을 함께 내려주는 것이 가장 싸다**(`relations: ['user','product']` + DTO 에 `product{ id, name }` `@Expose`). §5 B-1 에 포함.

### 3-4. 상품 상세 "문의" 탭 (D6)

- `ProductTabs.tsx` `tabs` 에 `{ id: 'inquiry', label: '문의' }` 추가, `ProductDetailClient.tsx` 에서 `activeTab === 'inquiry'` → `<InquirySection product={product} />`.
- `InquirySection`(client, `ReviewSection.tsx` 구조 복제): 목록 5건 + "더보기"(take 증가), 각 항목 = 제목 · 닉네임 · 작성일 · 상태 배지 · 본문 · 답변(있으면 "판매자 답변" 블록 + `answeredAt`). 비밀글은 🔒 + "비밀 문의입니다." 그대로.
- **작성 폼**(목록 위): 비로그인 → "문의를 남기려면 로그인" 링크(`/login?redirect=`). 로그인 + BUYER → 제목(2~200) · 내용 · [비밀글] 체크 · [등록]. 성공 → 목록 무효화 + 폼 초기화 + 토스트. 셀러 본인 상품이면 폼 대신 "내 상품입니다" 한 줄(선택).
- 목록 호출은 로그인 상태면 `authClient`, 아니면 `publicClient` — B-2 가 들어가면 Bearer 가 있을 때만 본인 비밀글이 풀린다.
- 상품 상세는 ISR/RSC 프리패치지만 문의는 리뷰처럼 **탭에서 클라이언트 조회**(캐시 분리, 상세 페이지 TTFB 무영향).

### 3-5. 내 문의 `/my/inquiries` (D7)

- `GET /inquiries/my` 목록: 상품 링크 · 제목 · 상태 배지 · 작성일 · 답변 접기/펼치기.
- 삭제 버튼은 `status === 'waiting'` 일 때만(answered 는 백엔드 400 — 버튼을 아예 숨긴다). 확인 모달 후 `DELETE`, 목록 무효화.
- 진입: `UserMenu` 에 "내 문의" 항목 추가(주문 목록 아래). `/my` 는 `redirect('/my/orders')`.

---

## 4. 프론트 데이터 계층

| 파일 | 내용 |
|---|---|
| `service/inquiry.ts`(신규) | `getProductInquiries(productId, {page,take}, {auth})` · `createInquiry(body)` · `getMyInquiries({page,take})` · `deleteInquiry(id)` · `getSellerInquiries({page,take,status})` · `answerInquiry(id, {answer})`. 타입은 전부 `@shopping-mall/shared` 의 `Inquiry*` |
| `hooks/inquiry-query-options.ts`(신규) | 키: `['inquiries','product',productId,page,take]` · `['inquiries','my',…]` · `['seller','inquiries',status,page,take]`. 뮤테이션 3개(작성·삭제·답변)와 invalidate 규칙 |
| `hooks/seller-dashboard-query-options.ts`(신규) | §3-2 조합 |
| `components/console/`(신규, 관리자에서 이동) | `ConsoleShell.tsx` · `ConsoleSidebar.tsx` · `table-ui.tsx` · `DemoModeBanner.tsx`. `(admin)/admin/components/` 에는 `AdminGuard.tsx` 와 얇은 `AdminSidebar.tsx`(래퍼)만 남긴다 |
| `lib/roles.ts`(신규) | `hasRole(user, 'seller')` — `UserMenu`·`ConsoleShell` 교차 링크가 공유. roles 가 `string[]` 과 `{name}[]` 두 모양으로 오는 현실을 여기서 흡수 |

---

## 5. 백엔드 변경 (최소 2건 + e2e 1개)

**B-1. `GET /seller/inquiries` 에 `status` 필터 + 상품명**
- `inquiry/dto/seller-inquiry-query.dto.ts`: `class SellerInquiryQueryDto extends BasePaginateDto { @IsOptional() @IsEnum(InquiryStatus) status?: InquiryStatus }`.
- `InquiryService.getSellerInquiries(userId, query)`: `where: { sellerId, ...(query.status ? { status: query.status } : {}) }`, `relations: ['user','product']`.
- `InquiryResponseDto` 에 `@Expose() @Type(() => InquiryProductDto) product?: { id; name }`. 상품 관계는 `ManyToOne('ProductEntity')` 가 이미 있다. 구매자 쪽 `getMyInquiries` 도 같은 relations 로 상품명을 준다(마이페이지 표에 필요).
- shared `InquiryResponse` 에 `product?: { id: number; name: string }` 추가 → `nx build shared`.

**B-2. 공개 문의 목록의 선택적 인증 (본인 비밀글 판정)**
- `auth/guards/optional-jwt-auth.guard.ts`: `AuthGuard('jwt')` 를 상속해 `handleRequest(err, user) { return user ?? null; }` — 토큰이 없거나 틀려도 통과시키되 있으면 `req.user` 를 채운다(약 15줄). `GET /inquiries/product/:productId` 에만 붙인다.
- 효과: 로그인한 작성자는 상품 탭에서 자기 비밀글 본문을 본다. 비로그인·타인은 지금과 동일.
- 만료 토큰으로 오면 `null` 로 처리되므로 프론트 `authClient` 의 401 refresh 경로를 타지 않는다 — 공개 목록에서는 그게 맞다(문의 목록 때문에 로그아웃되면 안 된다).

**e2e `backend-e2e/src/backend/seller-inquiry.e2e.spec.ts`**(기존 `support/login`·`resetLoginRateLimits`·`e2e-` 접두 계정 규칙 그대로)
1. 구매자 A 가 셀러 S 의 상품에 일반 문의 1건 + 비밀 문의 1건 작성 → 201, `sellerId` 가 S.
2. 비로그인 `GET /inquiries/product/:id` → 비밀글 마스킹(제목 "비밀 문의입니다.", 닉네임 '***'). A 의 토큰으로 같은 호출 → 본문 보임(B-2).
3. S 의 `GET /seller/inquiries?status=waiting&page=1&take=20` → 2건, `product.name` 포함. `status=answered` → 0건(B-1).
4. S 가 답변 → 200, `status answered`, `answeredAt` 존재. 다시 답변 → 400. 다른 셀러 T 가 답변 → 403.
5. A 의 `GET /inquiries/my` 에 답변 본문. answered 삭제 → 400, waiting 삭제 → 200.
6. 정리: 문의·상품·계정 삭제.

단위: `inquiry.service` 의 필터 분기와 `OptionalJwtAuthGuard.handleRequest` 각 1~2건. `ops` 스위트처럼 `jest/bin/jest.js` + 인라인 config 로 로컬 실행(메모리 `backend_jest_local_run`).

---

## 6. 작업 순서 (커밋 단위 — 각 단계가 그 자체로 시연 가능)

| 순서 | 내용 | 확인 |
|---|---|---|
| ① 셸 | `components/console/` 추출 → `(admin)/layout.tsx` 가 그것을 쓰도록 교체(관리자 화면 **픽셀 변화 0**) → `(main)/seller/**` 를 `(seller)/seller/**` 로 이동 + `(seller)/layout.tsx` → 미들웨어 `/seller/:path*` → 교차 링크 → `/seller` 는 임시로 `redirect('/seller/products')` | 관리자 9화면 육안 동일(데스크톱·모바일) · `/seller/*` 4화면 셸 안에서 동작 · 비로그인 `/seller` → 로그인 리다이렉트 · 프론트 tsc |
| ② 대시보드 | `seller-dashboard-query-options` + `/seller` 페이지(임시 리다이렉트 제거) | 시드 셀러로 KPI 4장·정산·상품 표·최근 주문이 실제 값 · 0건 상태 문구 |
| ③ 백엔드 | B-1 · B-2 · shared 타입 · `nx build shared` · e2e 신규 · 단위 | e2e 통과(떠 있는 4000 대상) · 기존 e2e 5개 무회귀 |
| ④ 셀러 문의 | `/seller/inquiries` 탭·표·답변 모달 | 시드의 미답변 문의에 답변 → 답변완료 탭으로 이동 · 감사 로그 화면에 `INQUIRY_ANSWERED` |
| ⑤ 상품 상세 문의 탭 | `InquirySection` + 작성 폼 | 구매자로 작성 → 탭 목록·셀러 미답변 탭 양쪽에 즉시 보임 · 비밀글 마스킹/본인 해제 |
| ⑥ 내 문의 | `/my/inquiries` + `UserMenu` 항목 + `/my` 리다이렉트 | 답변 본문 확인 · waiting 만 삭제 버튼 |
| ⑦ 문서 | 01-seller-core §1-B ✅ + 이 문서 진행표 · CLAUDE.md §4(라우트 그룹 `(seller)` 추가)·§5 stub 목록 · README §3 판매자·마이페이지·관리자 표(`/seller` 셸) · 로드맵 README | 링크 검사 스크립트 |
| ⑧ 프론트 테스트 3개(별도 합의) | 이 트랙에 얹기 좋은 후보: `InquiryForm`(RTL — 비로그인 안내 / 제출 시 `createInquiry` 호출·폼 초기화) · `lib/roles.ts hasRole`(두 모양) · `axios-http-client` 동시 401 큐 | `yarn nx test frontend --testPathPatterns=…` |

크기: ① 반나절 · ② 반나절 · ③ 반나절 · ④⑤⑥ 합쳐 1일 · ⑦⑧ 반나절 → **약 3일**. ①만으로도 "승인 직후 빈 화면" 문제는 사라진다(리다이렉트).

---

## 7. 시연 대본 (구매자 → 셀러 → 관리자)

1. 구매자 B 가 상품 상세 "문의" 탭에서 "배송은 며칠 걸리나요?"(비밀글 ✗) 작성 → 탭에 즉시 표시, `/my/inquiries` 에도 "답변 대기".
2. 셀러 S 로 로그인 → 헤더 "셀러 센터" → **대시보드**: 미답변 문의 1 · 출고 대기 N · 판매 중 상품 표. 카드 클릭 → `/seller/inquiries` 미답변 탭 → 답변 등록.
3. B 가 상품 탭 / 내 문의에서 "판매자 답변" 확인.
4. 관리자 A → AI 어시스턴트에 "이번 주 미답변 문의 요약해줘"(`summarize_inquiries`, 비밀글은 메타만) → 감사 로그에서 `INQUIRY_ANSWERED`(행위자 S) 확인.
5. (S 가 admin 도 겸하면) 셀러 셸 하단 "관리자 콘솔 →" 로 이동 — 한 계정 두 콘솔.

---

## 8. 위험과 함정 (미리 적어 두는 것)

- **라우트 그룹 이동은 `git mv`** 로 — 히스토리 유지. 이동 후 `(main)/seller` 폴더가 비어 있는지, `SellerGuard` 의 상대 import(`../../../../service/auth`) 깊이가 같은지 확인(같다: `(seller)/seller/components/` 도 4단계).
- `(main)` 밖으로 나오면 **PortOne SDK `<Script>`·쇼핑몰 `Header`·`Footer` 가 없다.** 셀러 화면은 결제를 하지 않으므로 문제 없지만, 셀러 화면에서 상품 상세로 가는 링크는 전체 페이지 이동이 된다(정상).
- `isActive` 의 `startsWith` 때문에 `/seller` 대시보드 항목이 항상 활성 — exact 처리(§3-1).
- 대시보드 5개 호출 중 하나가 403 이면(승인 직후 낡은 토큰) `SellerGuard` 의 `useSellerRoleSync` 가 먼저 refresh 하므로 대시보드 훅은 가드 **안쪽**에서만 돌게 한다(레이아웃 순서 유지).
- `page` 누락 → 커서 모드 → `meta.total` 없음. 훅에서 `page: 1` 상수.
- 공개 목록 B-2 없이 ⑤를 먼저 하면 "내가 쓴 비밀글이 잠겨 보인다"가 시연에 나온다 — ③이 ⑤보다 먼저.
- `InquiryResponseDto` 는 `BaseModel` 을 상속해 `@Expose` 로 `id/createdAt` 을 재선언하지 않았다(메모리 `serialize_expose_basemodel`: 이 프로젝트의 `@Serialize` 는 `excludeExtraneousValues`) — **응답에 `id`·`createdAt` 이 실제로 오는지 e2e 1번에서 먼저 단언**하고, 안 오면 `SettlementResponseDto` 때처럼 재선언한다.
- 데모 관리자(`DEMO_ADMIN_*`)는 셀러가 아니다. 시연용 셀러 계정은 시드의 셀러(또는 신청 → 승인 흐름으로 만든 계정)를 쓴다.
- 문서 규칙: 운영 배포 뒤 CLAUDE.md §5 에 "구현 완료"로 옮기기 전까지 README 에는 적지 않는다(시연 가능 범위 원칙).

---

## 9. 완료 기준 (DoD)

1. 셀러 계정 로그인 → 헤더 "셀러 센터" → 관리자와 같은 모양의 셸에서 대시보드(KPI 4·정산·판매 중 상품 표·최근 주문)가 실제 값으로 그려진다. 관리자 화면은 변화 없음(육안 + 반응형).
2. 구매자가 상품 상세 문의 탭에서 작성 → 셀러 문의 화면 미답변 탭에 보임 → 답변 → 구매자 탭·내 문의에 답변 표시. 비밀글은 타인에게 마스킹, 본인에게 해제.
3. 관리자 어시스턴트 "미답변 문의 요약" 과 감사 로그 `INQUIRY_ANSWERED` 로 세 번째 고리 확인(변경 없이).
4. `seller-inquiry.e2e.spec.ts` 통과 + 기존 e2e 5개 무회귀 + 프론트 tsc + 관리자·셀러 셸 모바일 폭 확인.
5. 문서 갱신(§6 ⑦) — stub 목록에서 `seller`·`seller/inquiries`·`my/inquiries`·`my` 가 빠진다.

## 10. 진행표 (구현하며 채운다)

| 단계 | 상태 | 비고 |
|---|---|---|
| ① 셸 | ⬜ | |
| ② 대시보드 | ⬜ | |
| ③ 백엔드 B-1·B-2·e2e | ⬜ | |
| ④ 셀러 문의 | ⬜ | |
| ⑤ 상품 상세 문의 탭 | ⬜ | |
| ⑥ 내 문의 | ⬜ | |
| ⑦ 문서 | ⬜ | |
| ⑧ 프론트 테스트 3개 | ⬜ | |
