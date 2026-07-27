# Phase 2 — 관리자 페이지 핵심 기능

> 목표: 이미 라우트만 잡혀 있는 `(admin)/admin/*` stub들을 **기존 백엔드 기능에 연결**한다.
> 대시보드는 완성돼 있으므로, 그 패턴(`service/admin-dashboard.ts`, `hooks/useDashboardQuery.ts`)을 그대로 답습한다.

라우트 위치: `frontend/src/app/(admin)/admin/*`. 보호: `middleware.ts`(refreshToken 쿠키) + `AdminGuard`(role=ADMIN). 역할: `ADMIN`.

---

## 2-A. 필수 (운영 핵심)

### ① 셀러 신청 승인/반려 — ✅ 구현 완료 (2026-07-27)
- **연계 백엔드 (이미 존재)**
  | 메서드/경로 | 파일 |
  |---|---|
  | `GET /seller/applications` | `backend/src/seller/seller.controller.ts:45` |
  | `PATCH /seller/applications/:id/approve` | `seller.controller.ts:52` |
  | `PATCH /seller/applications/:id/reject` | `seller.controller.ts:61` |
  - 승인/반려는 `DemoAccountGuard` 적용(데모계정 차단). 반려는 사유(`reason`) 필요.
- **변경 대상 (프론트)**: `service/admin-seller.ts`(신규), `hooks/admin-seller-query-options.ts`(신규), `(admin)/admin/sellers/page.tsx`(stub→신청 목록 + 승인/반려 모달).
- **산출물**: 관리자가 pending 신청을 보고 승인(→SELLER 권한 부여)·반려(사유 입력) 처리.
- **구현 메모**
  - 신규 shared 타입: `shared/src/lib/types/seller/`(`SellerStatus`·`SellerApplication`·`SellerApplicationWithUser`·`ApplySellerRequest` — 마지막 것은 Phase 1 신청 폼에서 재사용), `types/pagination.ts`(`PageMeta`/`PaginatedResponse<T>` — 백엔드 `CommonService.pagePaginate` 반환과 1:1).
  - **보안 수정**: `getApplications()`가 `relations:['user']`로 유저를 통째로 실어 응답에 **bcrypt 해시가 노출**되고 있었다(`/auth/me`는 전용 DTO를 써서 새지 않았을 뿐). `UserModel.password`에 `@Exclude()` 한 줄 추가로 차단. 직렬화에만 작용해 `bcrypt.compare(dto.password, user.password)` 같은 엔티티 직접 접근은 무영향. `{data:[Seller{user}], meta}` 2단 중첩에서도 password·은행정보가 모두 제거되는 것을 `instanceToPlain`으로 확인.
  - URL이 진실 원천: `status` 미지정 = `pending`(들어오자마자 "처리할 것"이 보이게), 전체 조회는 `status=all`로 명시. 탭 변경 시 `page` 리셋.
  - `page` 파라미터를 반드시 보낸다 — 빼면 백엔드가 커서 페이지네이션으로 분기한다(`CommonService.paginate`).
  - pending이 아닌 행은 액션 버튼을 감춘다(백엔드 400과 이중 방어). 승인/반려의 `DemoAccountGuard` 403은 모달 안에 인라인으로 표시.
  - 승인 성공 ≠ 신청자가 즉시 셀러 기능 사용 가능. 인가는 토큰의 역할 기준이라 기존 액세스 토큰은 여전히 buyer — 모달 안내문에 명시했고, 실제 해소는 Phase 1 §A①(토큰 staleness 처리)에서 한다.

### ② 상품 승인/반려 — ✅ 구현 완료 (2026-07-28)
- **연계 백엔드 (이미 존재)**
  | 메서드/경로 | 파일 |
  |---|---|
  | `GET /admin/products` | `backend/src/product/product.controller.ts:160` |
  | `PATCH /admin/products/:id/approve` | `product.controller.ts:166` |
  | `PATCH /admin/products/:id/reject` | `product.controller.ts:174` |
- **변경 대상 (프론트)**: `service/admin-product.ts`(신규), `hooks/admin-product-query-options.ts`(신규), `(admin)/admin/products/page.tsx`(stub→승인 대기 목록 + 승인/반려).
- **산출물**: 셀러가 등록한 상품의 `approvalStatus`(pending→approved/rejected)를 관리자가 전환.
- **구현 메모**
  - shared 신규 `product/admin-product.ts` — `ApprovalStatus`·`SalesType`(같은 폴더 `ProductStatus`의 `as const` 스타일 준수), `AdminProduct`(ProductResponseDto와 1:1), `AdminProductQuery`, `RejectProductRequest`.
  - **실제 응답을 찍어보고 타입 3건을 교정했다** (서버에 직접 요청해 확인):
    · `price`가 **문자열**로 온다(`"1760000.00"`) — TypeORM decimal이 문자열을 주고 `@Serialize`의 `plainToInstance`는 값을 변환하지 않는다. 타입을 `number | string`으로 두고 `formatPrice`가 양쪽을 받는다.
    · `tags`는 **목록 응답에 실려 오지 않는다** — `findAllAdmin`의 relations가 `['images','category','seller']`뿐이라 `excludeExtraneousValues`가 지운다. optional로 선언.
    · 이미지 필드는 `sortOrder`이지 기존 공개용 `ProductImage`의 `displayOrder`가 아니다 → `AdminProductImage`를 별도로 뒀다.
  - ⚠ `findAllAdmin`은 `categoryId·status·approvalStatus·sellerId`만 필터로 쓴다. `ProductQueryDto`에 `keyword`/`tags`가 있어도 admin 경로에서는 **무시**되므로 검색창을 만들지 않았다(동작하지 않는 입력을 두지 않는다).
  - 시드 상품은 `sellerId=null`이라 표에 "셀러 없음"으로 표시된다(`products.seller_id` nullable).
  - 표 스타일이 감사로그→셀러→상품으로 세 번 복제될 참이라 `(admin)/admin/components/table-ui.tsx`로 스타일·`AdminPagination`만 추출하고 셀러 화면도 옮겼다. 컬럼 구성이 화면마다 크게 달라 표 컴포넌트 자체는 일반화하지 않았다. (audit-logs는 metadata 펼치기 등 자기 사정이 있어 그대로 뒀다)
  - **e2e 추가**: `backend-e2e/src/backend/admin-product-approval.e2e.spec.ts` — buyer 403 / 데모 관리자 조회 200·승인 403 / 비데모 ADMIN 승인 200 + `approvedAt` 기록 / 중복 승인 400 / 반려 사유 필수 400 / `approvalStatus` 필터 실효성. 두 e2e 스펙이 계정을 공유하면 병렬 실행 시 서로의 데이터를 지우므로 **스펙별 이름공간**(`makeEmails(suite)`)으로 독립시켰다(`runInBand` 없이도 통과 확인).

> ✅ **해소됨 (2026-07-28, §1-A② 작업에서) — 반려된 상품을 셀러가 재제출할 수 있다.**
> `update()`의 EC1을 넓혀 **REJECTED도 수정 시 PENDING 복귀 + rejectionReason 초기화**로 바꿨다(셀러 신청의
> 반려→재신청과 대칭). 관리자가 반려를 직접 뒤집는 경로는 여전히 없다 — 되살리는 길은 셀러의 수정=재제출뿐.
> 아울러 **승인=게시**가 되면서 `approve()`가 DRAFT 상품을 PUBLISHED로 승격한다(승인 즉시 상점 노출·주문 가능).
> 왕복 검증: `backend-e2e/src/backend/seller-product-lifecycle.e2e.spec.ts`. 상세는 `01-seller-core.md` §1-A②.

### ③ 전체 주문 관리 — ✅ 구현 완료 (2026-07-28)
- **연계 백엔드 (이미 존재)**
  | 메서드/경로 | 파일 |
  |---|---|
  | `GET /admin/orders` | `backend/src/order/order.controller.ts:99` |
  | `GET /admin/orders/:orderNumber` | `order.controller.ts:105` |
  | `PATCH /admin/orders/:orderNumber/deliver` | `order.controller.ts:111` |
- **변경 대상 (프론트)**: `service/admin-order.ts`(신규), `hooks/admin-order-query-options.ts`(신규), `(admin)/admin/orders/page.tsx`(stub→목록/필터), `(admin)/admin/orders/[orderNumber]/page.tsx`(stub→상세 + 배송완료 처리).
- **산출물**: 관리자가 전체 주문을 조회·필터하고 상세에서 `deliver` 처리.
- **구현 메모 (2026-07-28)**
  - 상태 탭 기본값 = `shipped`(배송완료 처리 대상 = "처리할 것"), 전체는 `all` 명시.
  - 배송완료 처리는 **상세 화면에서 배송건(셀러) 단위** — `deliver`에 `sellerId`를 주면 해당 건만,
    생략하면 SHIPPED 전부. 헤더의 "모두 완료 처리" 버튼은 SHIPPED 가 2건 이상일 때만 노출.
  - 주문 상태 라벨·금액 포맷은 `service/seller-order.ts` 것을 공유(중복 정의 금지).
  - `deliver`는 DemoAccountGuard 적용 — 403 은 화면 배너에 백엔드 message 그대로 표시.
  - e2e 는 §1-A③ 배송 왕복 테스트가 겸한다(관리자 deliver·상세 조회 포함).

### ④ 정산 확인/지급
- **선결**: Phase 1과 동일한 ⚠ 정산 이중 prefix 버그 수정 선반영.
- **연계 백엔드 (이미 존재)**
  | 메서드/경로 | 파일 |
  |---|---|
  | `GET /admin/settlements` | `backend/src/settlement/settlement.controller.ts:53` |
  | `PATCH /admin/settlements/:id/confirm` | `settlement.controller.ts:59` |
  | `PATCH /admin/settlements/:id/pay` | `settlement.controller.ts:66` |
- **변경 대상 (프론트)**: `service/settlement.ts`(Phase 1과 공유, admin 함수 추가), `(admin)/admin/settlements/page.tsx`(stub→목록 + 확정/지급).
- **산출물**: 관리자가 정산 건을 확정(confirm)하고 지급(pay) 처리.

---

## 2-B. 후순위
- **감사 로그 조회** `(admin)/admin/audit-logs/page.tsx`: ✅ **구현 완료**(2026-06-14). 트리아지 3버킷 요약(§5-A) + 포렌식 검색(필터·표·페이지네이션, §5-B)을 `GET /v1/admin/audit-logs`(ADMIN 가드, 필터 완비)에 연결. **별도 계획서** → [ex-audit-log-admin.md](./ex-audit-log-admin.md)(prefix 버그 일괄 수정 · 시드 재기준화·확장 · DTO 행위자 보강 · 뷰어 2면). 이 문서에서는 더 다루지 않는다.
- **카테고리 관리** `(admin)/admin/categories/page.tsx`: 백엔드 CRUD 존재(`category.controller.ts:49~67`, `admin/categories`)하나 운영 빈도 낮아 **가장 후순위**.

## 완료 기준 (DoD)
- 관리자 계정으로: 셀러 신청 승인 → 그 셀러의 상품 승인 → 전체 주문에서 배송완료 처리 → 정산 확정·지급까지 한 흐름으로 동작.
- Phase 1의 셀러 화면과 연결돼 **셀러↔관리자 양방향 시나리오**(신청·승인·등록·정산)가 e2e로 시연 가능.
