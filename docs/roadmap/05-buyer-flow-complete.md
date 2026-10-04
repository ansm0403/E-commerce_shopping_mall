# 05. 구매자 흐름 완결 — 빈 화면 없애기 (실행 문서)

> **실행 문서(2026-10-03, 착수 전)**. 화면별 상세 설계는 이미 두 문서에 있다. 이 문서는 그것을 **다시 설계하지 않고**, 범위를 확정하고 · 두 문서의 충돌을 해소하고 · 2026-10-03 코드로 사실을 재확인하고 · 하나의 작업 순서와 DoD 로 묶는다.
>
> - 원본 설계 ① [02-2-buyer-mypage.md](./02-2-buyer-mypage.md) — 마이페이지 셸·프로필·위시리스트·내 문의·비밀번호·메뉴
> - 원본 설계 ② [01-2-seller-dashboard-inquiry.md](./01-2-seller-dashboard-inquiry.md) — 문의 3면(상품 상세 탭·내 문의·셀러 답변) + 백엔드 B-1·B-2
>
> **두 문서와 이 문서가 다르면 이 문서가 우선한다.** 구현이 끝나면 맨 아래 진행표를 채우고, 02-2·01-2 의 진행 상태와 CLAUDE.md §5 · 루트 README 의 stub 서술을 사실대로 바꾼다.
> 이전 문서: [04-ai-chat-ux.md](./04-ai-chat-ux.md)(AI 채팅 UX).

## 0. 한 문장 목표와 이유

**배포된 쇼핑몰을 클릭해 보는 사람이 구매자 동선(헤더 메뉴 → 마이페이지 → 각 하위 화면, 상품 상세 → 찜·문의)에서 빈 화면이나 죽은 버튼을 만나지 않는다.**

왜 지금인가.

- 채용 담당자는 코드보다 **배포 사이트를 먼저 클릭**한다. 지금은 헤더 "내 정보"가 아무 일도 하지 않고(`UserMenu.tsx` L47), `/my`·`/my/wishlist`·`/my/inquiries`·`/my/password` 가 3줄 stub 이다.
- 문의는 백엔드가 완성돼 있는데 **프론트가 전무**하다. 커머스 핵심 흐름 중 "구매자가 먼저 말을 거는" 방향이 통째로 없다.
- 04(AI 채팅)의 시연이 이 작업과 이어진다. 구매자가 문의를 남기고 셀러가 답하면, 관리자가 어시스턴트에 "미답변 문의 요약해줘"(`summarize_inquiries`)를 물을 때 **시드가 아닌 실제 사용 데이터**로 답한다(§11).
- 신규 기술 요소가 거의 없다(백엔드 대부분 완성). 그 대신 **폼 검증 · 권한별 UI 분기 · 캐시 무효화 · 낙관적 업데이트**처럼 프론트 기본기를 보여 주는 재료가 많다.

---

## 1. 범위 확정

| 항목 | 원본 | 포함 | 비고 |
|---|---|---|---|
| 마이페이지 셸(좌측 네비) + 프로필 홈 | 02-2 ① | ✅ | `/my` 인덱스 — §2 D1 |
| 위시리스트 | 02-2 ② | ✅ | + 찜 초기 상태 결함 수정(§3 F3, B-3) |
| 내 문의 | 02-2 ③ = 01-2 §3-5 | ✅ | 01-2 §3-5 화면 설계를 따른다 |
| 비밀번호 변경 | 02-2 ④ | ✅ | |
| 진입 경로 복구(UserMenu) | 02-2 ⑤ | ✅ | |
| `my/cart` 중복 stub 정리 | 02-2-B | ✅ | `/cart` 로 redirect |
| 상품 상세 "문의" 탭 + 작성 폼 | 01-2 §3-4 | ✅ | |
| 셀러 문의 답변 화면 | 01-2 §3-3 | ✅ | 답변이 있어야 왕복이 닫힌다. 위치는 §2 D2 |
| 백엔드 B-1(셀러 문의 status 필터 + 상품명) · B-2(공개 목록 선택적 인증) + e2e | 01-2 §5 | ✅ | + B-0·B-3·B-4(이 문서에서 추가, §4) |
| 로그인 튕김 버그 수정(새로고침 시 `/login` 으로 감) | `ex-a11y-bundle.md` §3(미수정으로 기록) | ✅ | §3 F5 · §2 D6 — 새 `/my` 화면이 같은 버그를 물려받지 않게 |
| `/seller` 인덱스 | 01-2 §6 ① 의 임시 조치 | ✅ (한 줄) | `redirect('/seller/products')` — 헤더 "셀러 센터"가 3줄 stub 으로 가는 것만 막는다 |
| 셀러 셸 이동(`(seller)` 그룹)·관리자 셸 공용화 | 01-2 D1·§6 ① | ❌ | 01-2 에 남긴다 |
| 셀러 대시보드 | 01-2 §3-2·§6 ② | ❌ | 01-2 에 남긴다 |
| 관리자 카테고리 stub | — | ❌ | 구매자 동선 밖 |
| 회원 탈퇴 · 주소록 · 프로필 이미지 | 02-2-C | ❌ | 02-2-C 의 이유 그대로 |

---

## 2. 충돌 해소와 추가 결정 (추천 1개 + 이유)

| # | 결정 | 이유 | 대체되는 원본 |
|---|---|---|---|
| **D1** | `/my` 는 **02-2 ① 그대로 — 마이페이지 셸(좌측 네비) + 프로필 홈** | 목표가 "구매자 동선의 빈 화면 제거"다. 리다이렉트 한 줄로는 "내 정보"를 눌러도 주문 목록이 나와 메뉴 이름과 화면이 어긋난다. 셸이 있어야 위시리스트·문의·비밀번호에 도달할 경로가 생긴다 | 01-2 **D7**(`/my` → `redirect('/my/orders')`) |
| **D2** | 셀러 문의 화면은 **지금 위치 `(main)/seller/inquiries`** 에 만든다. 셀러 레이아웃 상단 네비(`(main)/seller/layout.tsx`)에 "문의" 링크 추가. 나중에 01-2 ① 셸 이동 때 `git mv` 로 함께 옮긴다 | 셸 이동은 관리자 9화면 픽셀 회귀 확인이 딸린 별도 작업이다. 화면 파일은 그룹 이동 시 상대 import 깊이가 같아 그대로 옮겨진다(01-2 §8) | 01-2 §6 의 순서(① 셸 → ④ 셀러 문의) |
| **D3** | 새 query options 는 **`lib/react-query/`** 에 둔다: `inquiry-query-options.ts` · `wishlist-query-options.ts` · `user-query-options.ts` | 구매자 도메인(cart·order·review·products·category)이 전부 `lib/react-query/` 에 있다. `hooks/*-query-options.ts` 는 셀러·관리자 도메인 관례다. 문의는 구매자·셀러 양쪽이 쓰지만 키 계층(`['inquiries', …]`)을 공유해야 무효화가 한 파일에서 보인다 | 01-2 §4 · 02-2 ①②③ 의 `hooks/…-query-options.ts` |
| **D4** | **응답 DTO 의 `id`·`createdAt` 누락은 "확인 필요"가 아니라 확정 결함**으로 보고 B-0 에서 먼저 고친다(§3 F1) | 2026-10-03 코드로 확인했다. 문의 `id` 가 없으면 삭제·답변 API 를 부를 수 없다 — 화면 작업이 시작부터 막힌다 | 02-2 ①의 ⚠ · 01-2 §8 의 "e2e 1번에서 먼저 단언" |
| **D5** | 찜 하트 초기 상태를 서버에서 받는다: **B-3 `GET /wishlist/ids` → `number[]`**(BUYER). 상품 상세는 이 목록으로 하트를 그리고, 토글·위시리스트 화면의 제거는 같은 쿼리 키를 낙관적으로 갱신 | 지금 하트는 항상 빈 상태로 시작한다(§3 F3). 위시리스트 화면이 생기면 "목록엔 있는데 상세에선 빈 하트 → 누르면 해제"가 시연에 그대로 드러난다. 상품마다 단건 조회보다 id 목록 1회가 싸다. 지금 상품 카드에는 하트가 없지만, 나중에 붙일 때도 같은 쿼리를 쓰면 된다 | (원본에 없음 — 신규) |
| **D6** | 로그인 가드를 **공용 훅 `useRequireAuth()` 하나로 만든다.** `/auth/me` 응답을 기다린 뒤(`isLoading` 이 끝난 뒤)에만 비로그인 판정 → `/login?redirect=<현재 경로>`. `/my` 셸 레이아웃이 이 훅을 쓰고, **기존 6곳의 같은 판정**(F5)도 이 훅으로 바꾼다. `middleware.ts` matcher 는 이번에 건드리지 않는다 | 기존 화면들의 판정(`isHydrated && !isLoggedIn`)은 `/auth/me` 응답 전에 발동해 **새로고침하면 로그인으로 튕기는** 버그다(F5). 이 패턴을 그대로 따라 하면 새 마이페이지 화면 전부가 같은 버그를 물려받는다. 해법은 이미 문서에 있다("판정에 `isLoading` 을 함께 본다" — `ex-a11y-bundle.md` §3). 미들웨어에 `/my` 를 넣는 것은 01-2 D2(`/seller`)와 함께 하는 편이 회귀 확인이 한 번으로 끝난다. 백엔드 가드가 최종 판정이라 보안 공백은 없다 | — (원본은 가드 방식을 정하지 않음) |
| **D7** | 폼(문의 작성 · 프로필 수정 · 비밀번호 변경)은 **react-hook-form + zod**. 스키마의 길이 제한은 백엔드 DTO 와 같은 값(제목 2~200, 닉네임 2~20, 비밀번호 8자 이상 등)을 쓰고, 출처 DTO 파일을 주석에 단다 | 둘 다 이미 설치돼 있다. 프론트·백엔드 검증 규칙이 어긋나면 "프론트는 통과, 서버는 400"이 생긴다 | 02-2 ④ 의 `BaseForm.tsx` 재사용 — **착수 시 BaseForm 이 zod 와 맞는지 보고 결정**(맞으면 재사용) |

---

## 3. 현재 상태 재확인 (2026-10-03, 코드 확인)

### 3-1. 원본 문서의 사실 — 지금도 맞는가

| 원본 서술 | 2026-10-03 | 근거 |
|---|---|---|
| `my`·`my/wishlist`·`my/inquiries`·`my/password`·`my/cart` 3줄 stub, `my/layout.tsx` pass-through | ✅ 그대로 | `(main)/my/*` |
| UserMenu "내 정보" 죽은 항목, 위시리스트·문의 진입 경로 없음 | ✅ 그대로 | `UserMenu.tsx` L47 `onClick: () => void 0` |
| `GET/PATCH /users/me`, `PATCH /users/me/password`(감사 `PROFILE_UPDATED`·`PASSWORD_CHANGE`) | ✅ | `user.controller.ts` L17·L23·L33 |
| `GET /wishlist`(페이지네이션) · `POST /wishlist/toggle` · `DELETE /wishlist` = **전체 비우기** | ✅ | `wish-list.controller.ts` L27·L35·L44(`clearAll`), 컨트롤러 전체 `@Roles(BUYER)` |
| 문의 6개 엔드포인트, 공개 목록 가드 없음 → `@User('sub')` 항상 undefined | ✅ | `inquiry.controller.ts` L45-53 · L79-104 |
| `GET /seller/inquiries` 에 status 필터 없음 | ✅ | `inquiry.service.ts` L126 `where: { sellerId }` |
| answered 문의 삭제 → 400 | ✅ | `inquiry.service.ts` L109 |
| shared 문의 타입 | ✅ 있음 | `shared/src/lib/types/inquiry/inquiry.ts` |
| 상품 상세 탭 | 탭 5개(상세 설명·스펙·리뷰·판매자 정보·배송 정보), **"문의" 탭 없음** | `ProductTabs.tsx` L17-23 |
| `service/inquiry.ts` | ✅ 없음 | `frontend/src/service/` |
| 셀러 상단 네비 | 상품 관리·상품 등록·주문/배송·정산 — 문의 없음. `/seller` 인덱스는 stub | `(main)/seller/layout.tsx`, `(main)/seller/page.tsx` |

### 3-2. 새로 확인한 결함

| # | 결함 | 근거 | 영향 |
|---|---|---|---|
| **F1** | **`id`·`createdAt` 이 응답에서 빠진다 — DTO 3개.** `BaseModel`(`common/entity/base.entity.ts`)에는 `@Expose` 가 없고, `@Serialize` 는 `excludeExtraneousValues: true`(`serialize.interceptor.ts`)다. 세 DTO 모두 `BaseModel` 을 상속하면서 `id`·`createdAt` 을 재선언하지 않는다 | `InquiryResponseDto`(L12, `@Expose` 는 author 의 `id` 뿐) · `UserProfileResponseDto`(L9) · `WishlistItemResponseDto`(L24) | 문의: **삭제·답변에 쓸 id 가 없다**, 작성일 표시 불가. 프로필: id 없음(화면엔 불필요할 수 있음). 위시리스트: 항목 id·찜한 날짜 없음(`productId` 는 있어 토글은 가능). 메모리 `serialize_expose_basemodel` · `SettlementResponseDto` 와 같은 함정 |
| **F2** | `/seller` 인덱스가 stub 인데 헤더 "셀러 센터"·`SellerStatusCard` 가 그리로 보낸다 | `(main)/seller/page.tsx` · `SellerStatusCard.tsx` L106 | 승인 직후 셀러가 빈 화면을 만난다 |
| **F3** | **찜 하트가 항상 빈 상태로 시작한다.** `useState(false)`(`ProductInfo.tsx` L58)이고 서버에서 찜 여부를 받지 않는다. 토글 API 라서 이미 찜한 상품의 빈 하트를 누르면 **해제된다** | `ProductInfo.tsx` L58·L109-112, 상품 응답에 찜 여부 필드 없음 | 사용자가 "찜하기"를 눌렀는데 실제로는 찜이 풀리는 반대 동작 |
| **F4** | **데모 계정이 자기 프로필·비밀번호를 바꿀 수 있다.** `user.controller.ts` 는 `JwtAuthGuard` 만 걸려 있고(L13) `DemoAccountGuard` 가 없다(이 가드는 category·order·product·seller·settlement·ops 컨트롤러에만 있음). 그리고 "체험하기" 데모 로그인은 **환경변수의 비밀번호로 일반 로그인을 대신 해 주는 방식**이다(`auth.service.ts` L319-331 — `DEMO_ADMIN_EMAIL`·`DEMO_ADMIN_PASSWORD` 로 `this.login(...)`) | `user.controller.ts` L13·L23·L33, `auth/guards/demo-account.guard.ts`(`req.user.isDemo`), `auth.service.ts` L319-331 | 지금은 API 로만 가능하지만, ⑦ 화면이 생기면 방문자가 클릭 한 번으로 데모 비밀번호를 바꿀 수 있다. 그러면 DB 비밀번호와 환경변수가 어긋나 **"체험하기" 버튼이 모든 방문자에게 실패**한다(웹·RN 앱 데모 로그인 모두) |
| **F5** | **로그인 상태에서 새로고침하거나 주소로 직접 열면 `/login` 으로 튕긴다.** `AuthContext` 는 `isHydrated` 를 마운트 즉시 true 로 두고, `user` 는 `/auth/me` 응답 전까지 `undefined` 다. 페이지들은 `isHydrated && !isLoggedIn` 이면 바로 `router.push('/login')` 한다. `ex-a11y-bundle.md` §3 에 실측으로 기록됐지만 미수정 | 같은 판정 6곳: `cart/page.tsx` L25 · `checkout/page.tsx` L37 · `checkout/complete/CheckoutCompleteContent.tsx` L18 · `my/orders/page.tsx` L50 · `my/orders/[orderNumber]/page.tsx` L54 · `my/reviews/page.tsx` L28. `AuthContext` 는 `isLoading` 을 이미 노출한다(L12·L85) | 방문자가 `/my/wishlist` 에서 새로고침만 해도 로그인 화면이 나온다. 관리자 화면은 `AdminGuard` 가 응답을 기다려 해당 없음 |

---

## 4. 백엔드 변경 (01-2 §5 의 B-1·B-2 + 이 문서의 B-0·B-3·B-4)

| # | 변경 | 원본 |
|---|---|---|
| **B-0** | 세 DTO 에 `@Expose() id` · `@Expose() createdAt` 재선언(필요하면 `updatedAt`). 기존 수정 방식 그대로 — `SettlementResponseDto` 처럼 **`BaseModel` 상속을 끊고 기본 필드를 직접 선언**(`backend/CLAUDE.md` §직렬화 함정) | 신규(F1) |
| **B-1** | `GET /seller/inquiries?status=` + 응답에 `product{id,name}`(구매자 `getMyInquiries` 도 같은 relations) + shared `InquiryResponse.product?` → `nx build shared` | 01-2 §5 B-1 그대로 |
| **B-2** | `OptionalJwtAuthGuard` 를 공개 문의 목록에만 | 01-2 §5 B-2 그대로 |
| **B-3** | `GET /wishlist/ids` → `{ productIds: number[] }`(BUYER). 서비스는 `select: ['productId']` 로 가볍게 | 신규(F3, D5) |
| **B-4** | `PATCH /users/me` · `PATCH /users/me/password` 에 **`DemoAccountGuard`** | 신규(F4) |

**e2e**: 01-2 §5 의 `seller-inquiry.e2e.spec.ts` 6단계를 그대로 쓰고 아래 세 가지를 더한다.
- 1단계 응답에 **`id`·`createdAt` 이 있는지 먼저 단언**(B-0 회귀 방지).
- (`wishlist.e2e.spec.ts` 끝에) 데모 로그인(`POST /auth/demo-login`) 토큰으로 `PATCH /users/me/password`·`PATCH /users/me` → 403(B-4). ⚠ 데모 로그인은 `DEMO_LOGIN_ENABLED` 일 때만 — 로컬 `.env` 확인. **실제로 비밀번호가 바뀌는 성공 경로는 데모 계정으로 절대 시험하지 않는다**(F4 그대로 재현됨).
- `wishlist.e2e.spec.ts`(신규, 짧게): toggle 추가 → `GET /wishlist/ids` 에 포함 · `GET /wishlist` 항목에 `id`·`createdAt` · toggle 해제 → ids 에서 빠짐 · `DELETE /wishlist` 후 빈 배열.

로컬 실행 규칙은 메모리 `backend_e2e_harness`(떠 있는 4000 대상, `e2e-` 접두 계정, 로그인 레이트리밋)와 `backend_jest_local_run`(Node 22 우회) 그대로.

---

## 5. 프론트 데이터 계층

| 파일 | 내용 |
|---|---|
| `service/inquiry.ts`(신규) | 01-2 §4 의 함수 6개 그대로. 타입은 `@shopping-mall/shared` |
| `service/wishlist.ts`(확장) | `getWishlist({page,take})` · `getWishlistIds()` · `clearWishlist()` 추가(기존 `toggleWishlist` 유지) |
| `service/user.ts`(신규) | `getMyProfile()` · `updateMyProfile(dto)` · `changePassword(dto)` |
| `lib/react-query/inquiry-query-options.ts`(신규, D3) | 키: `['inquiries','product',productId,…]` · `['inquiries','my',…]` · `['inquiries','seller',status,…]`. 작성 → product·my 무효화 / 삭제 → my·product / 답변 → seller·product |
| `lib/react-query/wishlist-query-options.ts`(신규) | `['wishlist','ids']` · `['wishlist','list',page,take]`. 토글은 **ids 를 낙관적으로 갱신**(실패 시 되돌림) 후 list 무효화 |
| `lib/react-query/user-query-options.ts`(신규) | `['user','me']`. ⚠ `AuthContext` 의 `/auth/me` 쿼리와 별개다(그쪽은 인증 상태용). 프로필 수정 후 닉네임이 헤더에도 보이면 `/auth/me` 쿼리도 무효화 |
| `hooks/useWishlist.ts`(수정) | 토글 mutation 을 위 낙관적 갱신 방식으로. 기존 `onMutate` 의 비로그인 → `/login` 처리 유지 |

---

## 6. 통합 작업 순서 (커밋 단위 — 각 단계가 그 자체로 시연 가능)

| 순서 | 내용 | 원본 설계 | 확인 |
|---|---|---|---|
| ① 백엔드 | B-0 → B-1 → B-2 → B-3 → B-4 · shared 타입 · `nx build shared` · e2e 2개 · 단위 | 01-2 §5 + 이 문서 §4 | e2e 통과(4000 대상) · 기존 e2e 5개 무회귀 · 백엔드 tsc |
| ② 문의 데이터 계층 + 상품 상세 문의 탭 | `service/inquiry.ts` · query options · `InquirySection` + 작성 폼(D7) · 탭 추가 | 01-2 §3-4 | 구매자로 작성 → 탭에 즉시 · 비로그인은 로그인 링크 · 본인 비밀글은 풀리고 타인에겐 마스킹 |
| ③ 셀러 문의 답변 | `(main)/seller/inquiries` 탭·표·답변 모달 + 셀러 네비 "문의" + `/seller` redirect(F2) | 01-2 §3-3 · D2 | 미답변 → 답변 → 답변완료 탭 이동 · 관리자 감사 로그에 `INQUIRY_ANSWERED` |
| ④ 로그인 가드 + 마이페이지 셸 + 프로필 홈 | `useRequireAuth`(D6) → 기존 6곳 교체(F5) → `my/layout.tsx` 셸(좌측 네비, 모바일은 상단 가로 스크롤 탭) · `/my` 프로필 카드 + 인라인 수정 | 02-2 ① · D1 · D6 | **로그인 상태로 `/cart`·`/my/orders` 를 새로고침해도 그대로**(수정 전 재현 → 수정 후 확인) · 비로그인으로 `/my` 주소 진입 → 로그인 후 원래 경로로 복귀 · 프로필 수정 후 새로고침해도 유지 · 감사 로그 `PROFILE_UPDATED` |
| ⑤ 내 문의 | `/my/inquiries` | 01-2 §3-5 · 02-2 ③ | 셀러 답변 본문 표시 · waiting 만 삭제 버튼 |
| ⑥ 위시리스트 + 찜 초기 상태 | `/my/wishlist`(목록·페이지네이션·개별 제거=toggle·전체 비우기 확인 모달·장바구니 담기) + 상품 상세 하트를 `['wishlist','ids']` 로 | 02-2 ② · D5 | 상세에서 찜 → 목록에 즉시 · 목록에서 제거 → 상세 하트가 빈 상태 · **찜한 상품을 새로고침해도 하트가 채워져 있음**(F3) |
| ⑦ 비밀번호 변경 | `/my/password` | 02-2 ④ | 틀린 현재 비밀번호 → 서버 메시지 · 성공 후 감사 로그 `PASSWORD_CHANGE` · 데모 계정은 403 + 화면 안내(B-4) |
| ⑧ 진입 경로 + 정리 | UserMenu "내 정보" → `/my`, "위시리스트"·"내 문의" 추가 · `my/cart` → `/cart` redirect | 02-2 ⑤ · 02-2-B | 헤더에서 클릭만으로 전 화면 도달 · `(main)/my/` 아래 3줄 stub 0개 |
| ⑨ 프론트 테스트 | `useRequireAuth`(`/auth/me` 응답 전엔 이동하지 않음 · 응답 후 비로그인이면 redirect 포함 이동) · `InquiryForm`(RTL — 비로그인 안내 / 검증 실패 문구 / 제출 시 호출·초기화) · 찜 낙관적 갱신(실패 시 롤백) · zod 스키마(백엔드 DTO 경계값) | 01-2 §6 ⑧ 일부 | `yarn nx test frontend` |
| ⑩ 문서 | 이 문서 진행표 · 02-2·01-2 진행 표시 · CLAUDE.md §5(구매자 커머스 전 구간 서술, "⚠ 문의는 프론트 화면이 전무" 삭제, stub 목록) · 루트 README · 로드맵 README | — | 링크 검사 |

크기: ① 1일 · ②③ 1일 · ④ 1일 · ⑤⑥⑦ 1일 · ⑧⑨⑩ 반나절~1일 → **약 4~5일**. 02-2 의 볼륨 추정(~1,280 LOC)에 문의 3면과 백엔드를 더한 크기다.

---

## 7. 시연 대본 (구매자 → 셀러 → 관리자)

1. 구매자 B 로그인 → 상품 상세에서 하트(찜) → 헤더 "위시리스트" → 방금 찜한 상품이 있다. 상세로 돌아가 새로고침해도 하트가 채워져 있다.
2. 같은 상품 "문의" 탭 → "배송은 며칠 걸리나요?" 작성(비밀글 ✗) → 탭에 즉시 · 헤더 "내 문의"에 "답변 대기".
3. 셀러 S 로그인 → 헤더 "셀러 센터" → 상단 네비 "문의" → 미답변 탭에 B 의 문의 → 답변 등록.
4. B 의 "내 문의" / 상품 탭에 "판매자 답변" 표시. 답변된 문의에는 삭제 버튼이 없다.
5. 관리자 A → AI 어시스턴트 "아직 답변 안 한 고객 문의 요약해줘"(04 의 추천 칩) → 감사 로그에서 `INQUIRY_ANSWERED`(행위자 S).
6. B 가 "내 정보"에서 닉네임 수정 → 헤더 닉네임 반영 · "비밀번호 변경".

---

## 8. 위험과 함정 (미리 적어 두는 것)

- **B-0 은 응답 모양을 바꾼다**(필드 추가). 기존 소비자는 `id`·`createdAt` 을 못 받고 있었으므로 깨질 곳은 없어야 하지만, 운영 앱(RN)·관리자 화면 중 이 세 DTO 를 쓰는 곳이 있는지 착수 시 grep.
- **찜 낙관적 갱신의 경쟁**: 하트를 빠르게 여러 번 누르면 toggle 요청 순서가 꼬여 최종 상태가 어긋날 수 있다 → mutation 진행 중에는 버튼 비활성(현행 `isPending` 유지) + 성공 응답의 `action` 으로 최종 상태를 확정.
- **B-2 와 ② 의 순서**: B-2 없이 문의 탭을 먼저 만들면 "내가 쓴 비밀글이 잠겨 보인다"가 시연에 나온다 → ① 이 ② 보다 먼저(01-2 §8 과 같음).
- **페이지네이션 모드**: `page` 를 빼면 커서 모드라 `meta.total` 이 없다 → 목록 훅에서 `page: 1` 상수(01-2 §8).
- **데모 계정(F4)**: B-4 가 ⑦ 보다 반드시 먼저 운영에 나가야 한다. 화면에서는 `isDemo` 면 폼을 비활성 + "데모 계정은 변경할 수 없습니다" 안내(403 을 받고 나서 알리는 것보다 먼저 막는다). 데모 관리자의 `PATCH /users/me`(닉네임 수정)도 같은 이유로 막는다.
- **F5 수정은 결제 흐름(`cart`·`checkout`·`checkout/complete`)도 건드린다.** 판정 시점만 바뀌므로 동작은 같아야 하지만, 결제 직후 `checkout/complete` 진입(PortOne 리다이렉트)과 비로그인 장바구니 진입은 **수정 전/후 직접 한 번씩 확인**한다. `/auth/me` 가 401 이면 `user` 는 끝까지 없음 → 응답 후 로그인으로 가는 것이 정상.
- **시드 상품에는 셀러가 없다(F6, 2026-10-05 확인)**: 문의는 `product.sellerId` 가 있어야 작성된다. 시드 상품에서는 문의 탭이 "문의를 받을 수 없습니다" 안내만 보여 준다 → 시연은 셀러가 등록·승인받은 상품에서 한다.
- 셀러 시연 계정: 데모 관리자는 셀러가 아니다. 시드 셀러(또는 신청 → 승인 흐름으로 만든 계정)를 쓴다.
- 문서 규칙: 운영 배포 뒤 CLAUDE.md §5 에 옮기기 전까지 루트 README 에는 적지 않는다(시연 가능 범위 원칙).

---

## 9. 완료 기준 (DoD)

1. 헤더 사용자 메뉴 → `/my` → 좌측 네비로 프로필·주문·리뷰·위시리스트·문의·비밀번호·셀러 신청 전 화면에 클릭만으로 도달. **`(main)/my/` 아래 3줄 stub 0개**, `/seller` 인덱스도 빈 화면이 아니다. **로그인 상태에서 어느 구매자 화면을 새로고침해도 로그인으로 튕기지 않는다**(F5).
2. 찜: 상세 → 목록 즉시 반영 → 목록에서 제거·장바구니 담기·전체 비우기. **새로고침 후에도 상세 하트가 실제 상태와 일치**.
3. 문의 왕복: 상품 탭 작성 → 셀러 미답변 탭 → 답변 → 구매자 탭·내 문의에 답변 표시 → waiting 만 삭제 가능. 비밀글은 타인에게 마스킹, 본인에게 해제.
4. 프로필 수정·비밀번호 변경 동작, 감사 로그에 `PROFILE_UPDATED`·`PASSWORD_CHANGE`. 데모 계정은 변경이 막히고 안내가 보인다.
5. 테스트: e2e 2개(문의·위시리스트) 통과 + 기존 e2e 무회귀 · 프론트 테스트(⑨) · 양쪽 tsc · 새 화면 모바일 폭 확인.
6. 문서 갱신(§6 ⑩).

---

## 10. 진행표 (구현하며 채운다)

| 단계 | 상태 | 비고 |
|---|---|---|
| ① 백엔드 B-0~B-4 + e2e | ✅(로컬) | **착수 전 재확인(2026-10-05)**: §3 은 코드와 일치. 이 세 응답을 쓰는 프론트·RN 앱 코드는 `toggleWishlist` 뿐이라 B-0 로 깨질 소비자 없음(grep). **B-0**: DTO 3개가 `BaseModel` 상속을 끊고 `id`·`createdAt`·`updatedAt` 재선언. **B-1**: `SellerInquiryQueryDto`(`status?`, 없는 값은 400) + 셀러·내 문의에 `product{id,name}` + shared `InquiryResponse.product?`. **B-2**: `OptionalJwtAuthGuard` — ⚠ 01-2 §5 의 "`AuthGuard('jwt')` 상속" 은 쓸 수 없었다(이 프로젝트의 `JwtAuthGuard` 는 passport 가 아니라 `AuthService.verifyAccessToken` 을 부르는 자체 가드) → 같은 방식으로 구현, 토큰이 없거나 틀리면 401 대신 비로그인으로 통과. **B-3**: `GET /wishlist/ids` → `{ productIds }`. **B-4**: `PATCH /users/me`·`/users/me/password` 에 `DemoAccountGuard`. **e2e**: `seller-inquiry`(5건) · `wishlist`(5건) 신규 — 떠 있는 4000 대상 **7 스위트 56건 통과**(기존 5개 무회귀), 실행 후 e2e 잔여 계정·상품 0. ⚠ §4 와 다른 점: 데모 차단은 실제 데모 계정(`/auth/demo-login`)이 아니라 **`is_demo=true` 인 e2e 계정**으로 검증했다(가드가 빠지면 테스트가 F4 사고를 그대로 내므로, 기존 `seller-edge-cases` 와 같은 방식). 비밀번호 변경 요청은 현재 비밀번호를 일부러 틀리게 보낸다. **단위**: `inquiry.service.spec`(필터 분기 3건, 신규) · `optional-jwt-auth.guard.spec`(3건) · `wish-list.service.spec`(+2건) — 변경 모듈 8 스위트 24건 통과. **tsc**: 변경 폴더 오류 0(다른 파일의 기존 오류는 그대로 — 이번 변경과 무관). 로컬 응답 확인: `GET /inquiries/product/127` 에 `id`·`createdAt` 실림. 수정 전 응답은 따로 찍어 두지 않았다(F1 은 코드로 확인). 백엔드 eslint 는 로컬에서 돌리지 못했다(CI 에서 확인). 마이그레이션 없음. 실제 "체험하기" 경로도 로컬에서 확인: `POST /auth/demo-login` 토큰으로 `PATCH /users/me/password`(현재 비밀번호를 틀리게) → 403, 그 뒤 데모 로그인 정상. **사용자 확인(로컬, 2026-10-05)**: 찜 토글 회귀 없음 · 문의 응답에 `id`·`createdAt` 보임. (로컬 함정: 프론트를 3100 으로 띄우면 `.env` 의 `FRONTEND_URL=http://localhost:3000` 때문에 인증 메일 링크가 죽은 포트로 간다 → 백엔드를 `FRONTEND_URL=http://localhost:3100` 으로 실행.) **운영 미배포** — B-4 가 ⑦ 보다 먼저 나가야 한다(§8) |
| ② 상품 상세 문의 탭 | ✅(로컬) | `service/inquiry.ts`(6개) · `lib/react-query/inquiry-query-options.ts`(키에 로그인 여부 포함 — 로그인 전후 마스킹이 달라 캐시를 나눈다) · `hooks/useInquiry.ts`(작성·삭제·답변 + 무효화) · `lib/roles.ts hasRole` · `lib/validation/inquiry-schema.ts`(zod, DTO 경계값) · `components/inquiry/InquiryForm`·`InquiryItem` · `products/[id]/InquirySection` · 탭 추가. **D7**: `BaseForm` 이 zod resolver 와 맞아 재사용(성공 시 `key` 를 바꿔 초기화). 토스트 라이브러리가 없어 완료 문구는 폼 아래 `role="status"`. **⚠ 새로 확인한 사실(F6)**: **시드 상품은 전부 셀러가 없다**(로컬 게시 상품 336개 모두 `seller_id NULL`, 운영 `GET /products/127` 도 `sellerId: null`) → 서버가 문의 작성을 400("셀러 정보가 없는 상품입니다.")으로 거절한다. 화면은 `sellerId` 가 없으면 폼 대신 "판매자가 등록되지 않은 상품이라 문의를 받을 수 없습니다." 를 보여 준다. **§7 시연은 셀러가 등록한 상품에서만 된다** — 운영에 그런 상품이 있는지는 미확인(공개 목록 첫 100개에는 없었다). 처리 방향(시드 상품에 셀러 배정 등)은 미결정. **실제 화면 확인**(`scripts/buyer-flow/verify-inquiry-tab.mjs`, 로컬 `next dev` 3100, 로컬에 만든 셀러1 소유 확인용 상품 #521) **18/18**: 비로그인은 로그인 링크(`/login?redirect=%2Fproducts%2F521`)·폼 없음 · 셀러 없는 상품 안내 · 빈 제출 검증 문구 2개 · 등록 즉시 목록 반영·폼 초기화 · 본인 비밀글은 본문 보임(새로고침 뒤에도) · 비로그인에게는 "비밀 문의입니다." · 모바일 390px 가로 넘침 0 · axe 위반 0(처음 1건 — 문의 탭이 아니라 기존 `ProductInfo` 의 배송비 문구 대비 4.25, 5만원 미만 상품에서만 보이던 것 → `secondary-600`). 프론트 tsc 통과 · 변경 파일 eslint 에러 0. 운영 빌드(`next build`)로는 아직 확인하지 않았다. **사용자 확인(로컬, 2026-10-05) 6항목 통과**: 비로그인 로그인 링크 · 로그인 후 같은 상품으로 복귀 · 빈 제출 안내 문구 · 등록 즉시 목록 반영 · 로그아웃하면 비밀글이 "비밀 문의입니다." · 시드 상품의 문의 불가 안내 |
| ③ 셀러 문의 답변 | ⬜ | |
| ④ 로그인 가드 + 마이페이지 셸 + 프로필 | ⬜ | |
| ⑤ 내 문의 | ⬜ | |
| ⑥ 위시리스트 + 찜 초기 상태 | ⬜ | |
| ⑦ 비밀번호 변경 | ⬜ | |
| ⑧ 진입 경로 + 정리 | ⬜ | |
| ⑨ 프론트 테스트 | ⬜ | |
| ⑩ 문서 | ⬜ | |

---

## 11. 04 와의 연결 · 이력서에 쓸 프론트 포인트

**04 와의 연결**: 04 의 추천 질문 칩 중 "아직 답변 안 한 고객 문의 요약해줘"는 지금 시드 데이터로만 답한다. 05 가 끝나면 시연 중 방금 만든 문의가 요약에 들어간다 — "구매자 화면 → 셀러 화면 → 관리자 AI" 가 한 데이터로 이어지는 장면이다.

**프론트 포인트**(구현 후 실제로 한 것만 이력서에 옮긴다):
- **낙관적 업데이트와 롤백** — 찜 토글을 서버 응답 전에 반영하고 실패 시 되돌림, 상세·목록·카드가 같은 쿼리 키를 공유.
- **반대로 동작하던 버튼을 찾아 고침**(F3) — "초기 상태를 서버에서 받지 않는 토글"이 왜 위험한지.
- **새로고침 튕김 버그를 공용 훅으로 일괄 수정**(F5) — 인증 상태의 "모름(로딩)"과 "없음(비로그인)"을 구분해야 하는 이유. 6곳에 복사돼 있던 판정을 한 곳으로.
- **프론트·백엔드 검증 규칙 일치** — zod 스키마가 DTO 경계값을 따르고, 경계값 테스트로 고정.
- **권한·소유권에 따른 UI 분기** — 비로그인/구매자/셀러 본인 상품, 비밀글 본인 해제, answered 삭제 숨김.
- **캐시 무효화 설계** — 문의 작성·삭제·답변이 각각 어느 화면의 캐시를 무효화하는지 표 한 장.
- **응답 직렬화 결함 발견**(F1) — 화면을 붙이려다 API 응답에 `id` 가 없다는 것을 먼저 찾아낸 과정.
