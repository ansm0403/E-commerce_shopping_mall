# Phase 2 — 관리자 페이지 핵심 기능

> 목표: 이미 라우트만 잡혀 있는 `(admin)/admin/*` stub들을 **기존 백엔드 기능에 연결**한다.
> 대시보드는 완성돼 있으므로, 그 패턴(`service/admin-dashboard.ts`, `hooks/useDashboardQuery.ts`)을 그대로 답습한다.

라우트 위치: `frontend/src/app/(admin)/admin/*`. 보호: `middleware.ts`(refreshToken 쿠키) + `AdminGuard`(role=ADMIN). 역할: `ADMIN`.

---

## 2-A. 필수 (운영 핵심)

### ① 셀러 신청 승인/반려
- **연계 백엔드 (이미 존재)**
  | 메서드/경로 | 파일 |
  |---|---|
  | `GET /seller/applications` | `backend/src/seller/seller.controller.ts:45` |
  | `PATCH /seller/applications/:id/approve` | `seller.controller.ts:52` |
  | `PATCH /seller/applications/:id/reject` | `seller.controller.ts:61` |
  - 승인/반려는 `DemoAccountGuard` 적용(데모계정 차단). 반려는 사유(`reason`) 필요.
- **변경 대상 (프론트)**: `service/admin-seller.ts`(신규), `hooks/admin-seller-query-options.ts`(신규), `(admin)/admin/sellers/page.tsx`(stub→신청 목록 + 승인/반려 모달).
- **산출물**: 관리자가 pending 신청을 보고 승인(→SELLER 권한 부여)·반려(사유 입력) 처리.

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
