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

### ② 셀러 상품 등록 / 내 상품 관리  (승인된 셀러) — ✅ 구현 완료 (2026-07-28)

> ✅ **게시 블로커 해소 — "승인=게시 + 셀러 토글" 혼합안(a+b)으로 결정** (2026-07-28)
>
> 문제는 "API 어디에도 `status`를 PUBLISHED로 만드는 경로가 없다"였다(아래 이력 참고). 결정한 설계:
> 1. **승인 = 게시**: `approve()`가 `status`가 `DRAFT`일 때만 `PUBLISHED`로 승격 — 재승인(수정 재심사) 시
>    셀러가 골라둔 HIDDEN/DISCONTINUED를 관리자가 덮어쓰지 않는다.
> 2. **셀러 토글**: 신규 `PATCH /products/:id/status`(SELLER)가 `published|hidden|discontinued`만 받는다
>    (`UpdateProductStatusDto` @IsIn — DRAFT·SOLD_OUT은 시스템 관리 상태라 수동 지정 불가).
>    **approvalStatus는 건드리지 않아 재심사를 발동하지 않는다** — 내용 수정(PATCH :id)의 EC1과 분리한 이유.
>    `published`로 올리는 건 `approvalStatus=APPROVED`일 때만(400).
> 3. **반려 부활**: `update()`의 EC1을 넓혀 **REJECTED도 수정 시 PENDING 복귀 + rejectionReason 초기화**
>    — 셀러 신청의 반려→재신청과 대칭. 관리자가 반려를 직접 뒤집는 경로는 여전히 없다(셀러 재제출만).
> 4. 수정 재심사 중(status=published, approvalStatus=pending)에는 목록·주문 필터의 approvalStatus 조건
>    때문에 자동으로 상점에서 내려가고, 재승인되면 그대로 복귀한다.
>
> 전 과정은 `backend-e2e/src/backend/seller-product-lifecycle.e2e.spec.ts`가 고정한다:
> 등록→미노출·장바구니 차단→승인=게시→노출→**실제 주문 생성**→숨김/재게시(재심사 미발동)→반려→수정 재제출→재승인.
> (기존 admin-product-approval 스펙도 "승인 시 published" 단언 추가로 갱신)
>
> <details><summary>블로커 원인 이력 (2026-07-28 확인, 해소됨)</summary>
>
> 1. `create()`가 상품을 `status: DRAFT` 로 저장
> 2. 공개 목록 `findAll`은 `approvalStatus=APPROVED` AND `status=PUBLISHED` 만 통과
> 3. 주문 생성도 `status !== PUBLISHED` 면 거부
> 4. `approve()`는 `approvalStatus`·`approvedAt`·`rejectionReason`만 변경
> 5. `CreateProductDto`/`UpdateProductDto`에 `status` 필드 없음
> → 시드 상품이 보였던 건 시드가 DB에 직접 `published`로 넣기 때문이었다.
> </details>
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
- **구현 메모 (2026-07-28)**
  - **백엔드 추가분**: 위 게시 경로 3종 외에 `GET /products/my/:id`(수정 화면용 단건 — 공개 `findOne`은
    미승인·HIDDEN을 404로 숨기므로 별도 경로가 필요했다).
  - **업로드 이미지 정적 서빙이 없었다**: `addImage`가 URL을 `/uploads/…`로 저장하는데 서빙 코드가 전무.
    `main.ts`에 `express.static('/uploads')` 추가(글로벌 prefix `v1` 미적용) + `next.config.js` rewrites에
    `/uploads/:path*` 프록시 추가(API 타깃에서 `/v1`만 뗀 주소로). ⚠ **diskStorage라 컨테이너 재배포 시
    파일 유실** — S3 등 외부 스토리지 전환 전까지의 한계로 기록해 둔다.
  - **등록은 2단계 API**: `POST /products` 성공 후 그 id로 `POST /products/:id/images`(장당 순차 업로드,
    첫 장이 대표). 이미지 단계 실패는 "등록 실패"가 아니라 "이미지만 추가 못 함"으로 안내(`ImageUploadError`).
  - **FormData 함정**: axios 인스턴스가 `Content-Type: application/json`을 고정하므로 업로드 요청에서만
    `headers: { 'Content-Type': undefined }`로 지워 브라우저가 multipart boundary를 붙이게 한다.
  - **SellerGuard 신설**: `(main)/seller/layout.tsx`에 부착(기존엔 가드 없음). AdminGuard를 본떴고,
    승인 직후 낡은 토큰은 `useSellerRoleSync`(§7-2와 동일 큐)로 refresh 1회 자동 해소. 비-셀러는
    `/my/seller-apply`로 안내.
  - **shared 추가**: `product/seller-product.ts`(`SellerProduct`·`CreateProductRequest`·
    `UpdateProductStatusRequest`·`SELLER_SETTABLE_STATUSES` 등).
  - 수정 화면(`[id]/edit`)이 반려 상품의 **재제출 경로**다 — 반려 사유 배너 + "저장하면 재심사" 안내.
  - 관리자 표 스타일(`table-ui.tsx`)·페이지네이션을 셀러 목록에서도 재사용(복제 금지 규칙).

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
