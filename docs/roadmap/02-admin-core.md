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

### ② 상품 승인/반려
- **연계 백엔드 (이미 존재)**
  | 메서드/경로 | 파일 |
  |---|---|
  | `GET /admin/products` | `backend/src/product/product.controller.ts:160` |
  | `PATCH /admin/products/:id/approve` | `product.controller.ts:166` |
  | `PATCH /admin/products/:id/reject` | `product.controller.ts:174` |
- **변경 대상 (프론트)**: `service/admin-product.ts`(신규), `hooks/admin-product-query-options.ts`(신규), `(admin)/admin/products/page.tsx`(stub→승인 대기 목록 + 승인/반려).
- **산출물**: 셀러가 등록한 상품의 `approvalStatus`(pending→approved/rejected)를 관리자가 전환.

### ③ 전체 주문 관리
- **연계 백엔드 (이미 존재)**
  | 메서드/경로 | 파일 |
  |---|---|
  | `GET /admin/orders` | `backend/src/order/order.controller.ts:99` |
  | `GET /admin/orders/:orderNumber` | `order.controller.ts:105` |
  | `PATCH /admin/orders/:orderNumber/deliver` | `order.controller.ts:111` |
- **변경 대상 (프론트)**: `service/admin-order.ts`(신규), `hooks/admin-order-query-options.ts`(신규), `(admin)/admin/orders/page.tsx`(stub→목록/필터), `(admin)/admin/orders/[orderNumber]/page.tsx`(stub→상세 + 배송완료 처리).
- **산출물**: 관리자가 전체 주문을 조회·필터하고 상세에서 `deliver` 처리.

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
