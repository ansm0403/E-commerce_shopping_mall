# Phase 1 — 셀러 핵심 기능

> 목표: 한 사용자가 **셀러로 신청 → 승인 후 상품 등록 → 들어온 주문을 배송 처리 → 정산 내역 확인**까지
> 프론트에서 끝까지 시연 가능하게 만든다. 백엔드는 대부분 완성돼 있으므로 **프론트 연결 중심**.

라우트 위치: `frontend/src/app/(main)/seller/*` (전부 현재 stub). 역할: `SELLER`.

---

## 1-A. 필수 (시연 핵심)

### ① 셀러 신청 / 승인 상태 확인  ← 플로우 진입점
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

### ② 셀러 상품 등록 / 내 상품 관리  (승인된 셀러)
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
