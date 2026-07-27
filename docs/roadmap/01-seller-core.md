# Phase 1 — 셀러 핵심 기능

> 목표: 한 사용자가 **셀러로 신청 → 승인 후 상품 등록 → 들어온 주문을 배송 처리 → 정산 내역 확인**까지
> 프론트에서 끝까지 시연 가능하게 만든다. 백엔드는 대부분 완성돼 있으므로 **프론트 연결 중심**.

라우트 위치: `frontend/src/app/(main)/seller/*` (전부 현재 stub). 역할: `SELLER`.

---

## 1-A. 필수 (시연 핵심)

### ① 셀러 신청 / 승인 상태 확인  ← 플로우 진입점 — ✅ 구현 완료 (2026-07-27)
- **연계 백엔드 (이미 존재)**
  | 메서드/경로 | 역할 | 파일 |
  |---|---|---|
  | `POST /seller/apply` | BUYER | `backend/src/seller/seller.controller.ts:31` |
  | `GET /seller/me` | BUYER·SELLER | `seller.controller.ts:38` |
  - 신청 폼 필드 = `backend/src/seller/dto/apply-seller.dto.ts`(상호·사업자번호·대표자·사업장주소·연락처·은행정보 등). 은행정보는 응답에서 `@Exclude`.
  - 신청 후 상태: `pending` → 관리자 승인 시 `approved`(+ SELLER 권한 부여) / `rejected`(사유). 승인은 Phase 2-A①에서 처리.
- **변경 대상 (프론트)**
  - `service/seller.ts` (신규): `applySeller(dto)`, `getMySellerInfo()`
  - `hooks/seller-query-options.ts` (신규): 내 셀러 상태 조회
  - `(main)/my/seller-apply/page.tsx` (현재 stub→신청 폼 + 신청완료/심사중/반려 상태 표시)
- **산출물**: 일반 사용자가 셀러 신청 → 본인 신청 상태(pending/approved/rejected)를 확인. 승인 전까지 셀러 메뉴는 잠금/안내.
- **구현 메모**
  - shared 타입은 Step 1에서 만든 것(`ApplySellerRequest`·`SellerApplication`·`SellerStatus`)을 그대로 재사용 — **shared·백엔드 무변경**.
  - 화면 4분기: 미신청 / pending / approved / rejected. `GET /seller/me`는 신청 이력이 없으면 **404**를 주는데 이건 에러가 아니라 "아직 신청 안 함"이므로 훅에서 `null`로 바꿔 정상 상태로 다룬다(404를 에러로 두면 화면이 실패 뷰로 빠진다).
  - **§7-2(토큰 staleness) 해소**: `status=approved`인데 토큰 payload에 `seller`가 없으면 `/auth/refresh`를 **1회만** 자동 트리거(`useSellerRoleSync`). 신규 `lib/jwt.ts`가 액세스 토큰을 base64url 디코드해 `roles`를 읽는다 — **서명 검증이 아니라 "내 토큰이 낡았나"를 UI가 알기 위한 용도**이며 인가는 여전히 백엔드 몫. 갱신 큐는 axios 인터셉터의 `refreshAccessToken`을 export해 공유하므로 401 재발급과 경합하지 않는다. 실패 시 재시도 없이 재로그인을 안내한다(refresh 토큰까지 만료된 상황에서 루프가 최악이라).
  - 선택 필드(`contactEmail`·`contactPhone`)는 빈 문자열이면 **전송 직전에 키를 제거**한다 — 백엔드가 `@IsOptional() @IsEmail()`이라 빈 문자열을 보내면 400.
  - 반려 → 재신청 시 이전 신청 내용을 프리필하되 **은행 3필드는 응답에 없어(@Exclude) 재입력**받는다. 백엔드 `apply()`가 REJECTED 행을 PENDING으로 되돌리며 사유를 지운다.
  - 진입 링크가 코드베이스에 아예 없어서 헤더 `UserMenu`에 항목 추가(역할에 따라 "셀러 신청"/"셀러 센터").

### ② 셀러 상품 등록 / 내 상품 관리  (승인된 셀러)

> ⛔ **착수 전 해소해야 할 블로커 — 셀러가 등록한 상품은 승인해도 상점에 뜨지 않고 주문도 안 된다** (2026-07-28 확인)
>
> 1. `create()`가 상품을 **`status: DRAFT`** 로 저장한다 — `product.service.ts:203-222`
> 2. 공개 목록 `findAll`은 `approvalStatus=APPROVED` **AND `status=PUBLISHED`** 만 통과 — `product.service.ts:114-117`
> 3. 주문 생성도 `status !== PUBLISHED` 면 거부 — `order.service.ts:132-137`
> 4. 그런데 `approve()`는 `approvalStatus`·`approvedAt`·`rejectionReason`만 바꾸고 **`status`는 건드리지 않는다** — `product.service.ts:374-397`
> 5. `CreateProductDto`에 **`status` 필드가 없고**, `UpdateProductDto = PartialType(CreateProductDto)` 라 수정 경로에도 없다
>
> → **API 어디에도 `status`를 PUBLISHED로 만들 방법이 없다.** 시드 상품이 상점에 보이는 건 시드가 DB에 직접
> `published`로 넣기 때문이다(현재 분포: published 336 / sold_out 13, 전부 approved).
> 상세 조회(`findOne`)는 HIDDEN·DISCONTINUED만 막으므로 **DRAFT 상품도 상세 페이지에는 보인다** — 목록에만 안 뜨고 주문만 안 되는, 더 헷갈리는 형태다.
>
> **선택지**: (a) `approve()`가 `status`도 PUBLISHED로 올린다("승인=게시", 최소 변경) /
> (b) `Create·UpdateProductDto`에 `status` 추가해 셀러가 게시·숨김을 직접 제어(실서비스에 가까움) /
> (c) `create()` 기본값을 PUBLISHED로(승인 전엔 어차피 안 보이므로 안전하나 DRAFT 개념이 죽음).
> 어느 쪽이든 **"셀러 등록 → 관리자 승인 → 공개 목록 노출 → 주문 생성"이 통과하는지 e2e로 확인**할 것.
>
> 함께 판단할 것: **반려된 상품을 되살릴 수 없는 문제**(02-admin-core §2-A② 하단 참고).
> 현재 동작은 `backend-e2e/src/backend/admin-product-approval.e2e.spec.ts`에 고정돼 있으니 고칠 경우 그 테스트도 함께 수정한다.
- **연계 백엔드 (이미 존재)**
  | 메서드/경로 | 역할 | 파일 |
  |---|---|---|
  | `POST /products` | SELLER | `backend/src/product/product.controller.ts:72` |
  | `GET /products/my` | SELLER | `product.controller.ts:57` |
  | `PATCH /products/:id` | SELLER | `product.controller.ts:81` |
  | `DELETE /products/:id` | SELLER | `product.controller.ts:94` |
  | `POST /products/:id/images` | SELLER | `product.controller.ts:129` |
  - 등록 폼 필드 = `create-product.dto.ts`(name·description·price·brand 필수 / stockQuantity·categoryId·salesType·discountRate·isEvent 선택). 카테고리별 specs는 후순위.
- **변경 대상 (프론트)**
  - `service/seller-product.ts` (신규): create/list/update/delete/uploadImage 함수
  - `hooks/seller-product-query-options.ts` (신규)
  - `(main)/seller/products/new/page.tsx` (stub→폼)
  - `(main)/seller/products/page.tsx` (stub→내 상품 목록/수정·삭제)
- **산출물**: 셀러가 상품을 등록하고, 목록에서 재고/가격 수정·삭제, 이미지 업로드 가능.

### ③ 셀러 주문 / 배송 처리
- **연계 백엔드 (이미 존재)**
  | 메서드/경로 | 역할 | 파일 |
  |---|---|---|
  | `GET /seller/orders` | SELLER | `backend/src/order/order.controller.ts:74` |
  | `PATCH /seller/orders/:orderNumber/ship` | SELLER | `order.controller.ts:80` |
- **변경 대상 (프론트)**
  - `service/seller-order.ts` (신규)
  - `hooks/seller-order-query-options.ts` (신규)
  - `(main)/seller/orders/page.tsx` (stub→주문 목록 + 송장/배송처리 액션)
- **산출물**: 셀러가 자신에게 들어온 주문을 보고 `ship` 처리(주문 상태 전이) 가능.

### ④ 셀러 정산 조회
- **선결**: README의 ⚠ **정산 이중 prefix 버그** 먼저 수정(`settlement.controller.ts`).
- **연계 백엔드 (이미 존재)**
  | 메서드/경로 | 역할 | 파일 |
  |---|---|---|
  | `GET /seller/settlements` | SELLER | `backend/src/settlement/settlement.controller.ts:30` |
  | `GET /seller/settlements/summary` | SELLER | `settlement.controller.ts:39` |
- **변경 대상 (프론트)**
  - `service/settlement.ts` (신규), `hooks/settlement-query-options.ts` (신규)
  - `(main)/seller/settlements/page.tsx` (stub→정산 내역/요약)
- **산출물**: 셀러가 정산 요약(누적/대기/지급액)과 기간별 내역을 조회.

---

## 1-B. 후순위
- **셀러 대시보드** `(main)/seller/page.tsx`: ②~④ 데이터를 요약(판매량·미배송·정산 요약). 위 화면 완료 후 집계 뷰로.
- **셀러 문의 답변** `(main)/seller/inquiries/page.tsx`: ❓ `inquiry/` 컨트롤러에 셀러 답변 엔드포인트 존재 여부 확인 후 진행.

## 완료 기준 (DoD)
- 일반 사용자가: 셀러 신청 → (관리자 승인 후, Phase 2-A①) SELLER 권한 획득 → 상품 등록 → `/products/my`에 노출 → (테스트 주문 발생 후) `/seller/orders`에서 배송처리 → `/seller/settlements`에서 내역 확인까지 끊김 없이 동작.
- 모든 신규 호출은 SELLER 외 역할에서 차단(백엔드 가드 + 프론트 가드).
