# 3-Role 로직 검토 (buyer / seller / admin)

> 목적: 데모에서는 "데모 관리자" 버튼 하나로 **곧장 관리자 페이지로 진입**하도록 되어 있어,
> "역할 부여 → 승인 → 기능 사용"이라는 **실제 흐름을 한 번도 거쳐본 적이 없다.**
> 그래서 관리자/셀러 승인 로직이 실제로 어떻게 동작하는지 파악이 안 된 상태였다.
> 이 문서는 코드를 직접 읽어 3-Role 인가·승인 경로를 추적하고, 정합성/함정을 기록한다.
> (이 문서는 검토 결과이며, 수정 착수 전 단계다. 조치는 §7 참고.)

검토 일자 기준 코드. 인용한 `파일:라인`은 변경 시 달라질 수 있으니 착수 시 재확인.

---

## 0. 한 줄 결론

- **승인 로직(셀러/상품) 자체는 코드상 정상**이다.
- 인가는 전부 **"토큰에 박힌 역할" 기준**이라, **역할이 바뀌어도 새 토큰을 받기 전까지 반영되지 않는다**(가장 큰 함정).
- "데모 관리자 → 바로 관리자 페이지"는 **의도된 데모 단축 경로**이며, 데모 계정의 변경 동작 차단(`DemoAccountGuard`)도 **올바른 설계**다.

---

## 1. 역할·토큰 모델 (모든 인가의 토대)

- 역할: `buyer | seller | admin` (`backend/src/user/entity/role.entity.ts`). User ↔ Role 다대다.
- 가입 시 **buyer 자동 부여**: `auth.service.ts:114-115` (`user.roles = [buyerRole]`).
- 로그인/갱신 시 역할이 **토큰 payload에 문자열 배열로 기록**: `auth.service.ts:322` (`roles: user.roles.map(r => r.name)`).
- **`JwtAuthGuard`는 `request.user = 토큰 payload`** — 요청마다 DB를 다시 읽지 않음: `auth/guards/jwt-auth.guard.ts`.
- **`RolesGuard`는 그 토큰의 `user.roles`(문자열)를 `.includes()`**: `auth/guards/roles.guard.ts:31`.

> ⚑ 핵심: **인가 = 토큰에 박힌 역할.** DB의 user.roles가 바뀌어도 토큰이 갱신되기 전까지 무의미.

## 2. 셀러 신청 · 승인

- `apply()` — 정상. REJECTED는 재신청 허용: `seller/seller.service.ts:28-51`.
- `approve()` — status를 APPROVED로 바꾸고 **대상 user에 SELLER+BUYER 역할을 실제 부여**(중복 제거): `seller/seller.service.ts:70-108`. **로직 정확.**
- 감사로그: 컨트롤러에 `@Auditable(SELLER_APPROVED / SELLER_REJECTED)`: `seller/seller.controller.ts:55,64`.

함정:
- ⚠ **[핵심] 승인 직후 본인은 즉시 셀러 기능을 못 쓴다.** 승인은 DB의 user.roles만 바꿀 뿐, 그 사람이 이미 들고 있는 access token엔 여전히 `roles:['buyer']`. 셀러 API는 SELLER를 요구 → **재로그인 또는 토큰 refresh(access 만료 15분) 전까지 403**.
  - refresh 경로는 DB에서 역할을 다시 읽어 새 토큰을 만든다: `auth.service.ts:441-467`. 따라서 refresh만 일어나면 자동 반영되지만, **클라이언트가 refresh를 트리거해야** 한다.
- ⚠ `approve()`가 **트랜잭션이 아님** — `seller.update`와 `user.save`가 분리(`seller.service.ts:80-105`). user 저장 실패 시 "승인됨 but 권한 미부여" 불일치 가능.

## 3. 데모 관리자 (의도된 설계 — 정상)

- `demoLogin()`: `DEMO_ADMIN_EMAIL/PW`로 로그인하여 **isDemo=true 토큰** 발급: `auth.service.ts:297-311`, `:323`.
- `DemoAccountGuard`: `isDemo`면 무조건 차단: `auth/guards/demo-account.guard.ts:7`.
- 승인/거절/배송완료/정산지급 등 **변경계 엔드포인트에 `DemoAccountGuard` 부착**(seller/product/order/settlement 컨트롤러).

> 데모 관리자는 "구경용"이므로 변경 동작을 막는 것이 맞다. **승인 로직의 실동작은 비(非)데모 실관리자 계정으로만 검증 가능** — 데모 단축 경로만 써왔기에 지금까지 실제로 확인된 적이 없었던 것일 뿐, 로직 결함은 아니다.

## 4. 관리자 측 인가 / 로직 정합성

- 셀러 승인/거절: ADMIN 가드 + 감사로그 ✅ (§2)
- 상품 승인/거절: **트랜잭션 + 상태검증 + 캐시무효화 + 이벤트 발행**까지 깔끔: `product/product.service.ts:361-410`. `@Auditable(PRODUCT_APPROVED/REJECTED)`: `product.controller.ts:169,177`.
- 주문: `admin/orders` 조회 + `deliver`(DemoGuard): `order/order.controller.ts:93-112`.
- 정산: confirm/pay 존재. ⚠ **`v1/` 이중 prefix 경로 버그**(`settlement.controller.ts` `@Controller('v1/...')` + 전역 prefix `/v1` → `/v1/v1/...`). README 선결 과제 참고.

## 5. sellerId 일관성 (정상)

- `product.create`: `sellerId = SellerEntity.id` (`product.service.ts:217`, `getApprovedSeller`는 userId→APPROVED SellerEntity).
- 주문 생성: `orderItem.sellerId = product.sellerId` (`order.service.ts:150`).
- 셀러 주문 조회: `items.sellerId = seller.id`로 필터 (`order.service.ts:308`).
- → 기준이 **SellerEntity.id로 일관** → 셀러가 자기 상품/주문/정산을 정확히 본다. ✅
- 소소: `orderItem.sellerId = product.sellerId ?? 0` — 판매자 없는(시드) 상품 주문 시 0으로 고아화될 엣지.

## 6. 프론트 판정 ↔ 백엔드 인가 불일치 가능성

- 프론트 `AdminGuard`/`AuthContext`는 `/auth/me`로 역할 확인 → **getMe는 DB에서 fresh**: `auth.service.ts:60-64`.
- 백엔드 API 인가는 **토큰 기준**(§1).
- 결과:
  - 승인 직후: `/auth/me`엔 seller가 보여 **프론트는 셀러 메뉴를 띄우지만, 토큰은 아직 buyer라 API는 403** → "메뉴는 보이는데 안 됨".
  - 데모 관리자: `/auth/me`는 admin이라 관리자 UI 전체가 보이나, 변경 API는 DemoGuard 403(의도됨).

## 7. 조치 권장 (우선순위 — 착수 전)

1. ✅ **정산 `v1/` 이중 prefix 수정** — `settlement.controller.ts` `SellerSettlementController`를 `@Controller('seller/settlements')`로 수정. `AdminSettlementController`는 이미 `admin/settlements`로 정상이었음. (Step 0 완료, commit `84a83f4`)
2. ✅ **승인 후 토큰 갱신 전략 결정 → 구현 완료** — 백엔드 무변경. `status=approved`인데 토큰에 SELLER가 없으면 `/auth/refresh` 1회 자동 트리거 + 실패 시 재로그인 안내. (방침 Step 0 확정 → `(main)/my/seller-apply`의 `useSellerRoleSync`로 구현, 2026-07-27. 토큰 payload 판독은 신규 `frontend/src/lib/jwt.ts`, 갱신 큐는 axios 인터셉터의 `refreshAccessToken` 공유)
3. ✅ **비데모 ADMIN으로 승인 플로우 실검증** — `backend-e2e/src/backend/seller-approval.e2e.spec.ts` 신규(2026-07-27). 실행 중인 서버에 실제 HTTP로 붙어 ① 신청→pending ② buyer 토큰의 관리자 엔드포인트 403(RolesGuard) ③ **데모 관리자 승인 403**(DemoAccountGuard — 조회는 200이므로 "역할이 아니라 데모라서 막힌 것"이 구분된다) ④ 비데모 ADMIN 목록 조회 + **응답에 password 해시 없음**(Step 1 회귀 방지) ⑤ 승인 후 DB에 buyer+seller 역할 ⑥ **구토큰으로는 여전히 403** ⑦ refresh 후 신토큰으로 200 ⑧ 반려 사유 저장·노출까지 검증. 3회 연속 실행 통과 확인.
   - 계정 준비만 DB 직결(비데모 ADMIN을 만드는 API가 없고, 회원가입은 `isEmailVerified=false`라 로그인이 막힌다). 검증 대상 동작은 전부 HTTP.
   - **기존 e2e 스캐폴딩은 죽어 있었다** — `GET /api`(없는 엔드포인트) 기대, 포트 3000(실제 4000), `setupFiles`가 함수를 export해 baseURL이 설정된 적 없음, teardown의 `killPort`가 개발 서버를 죽임, `dependsOn: backend:serve`가 이미 뜬 서버와 EADDRINUSE 충돌. 전부 정리했고 **이미 떠 있는 서버를 대상으로** 돌게 바꿨다.
   - 로그인은 IP당 10회/5분 제한이라 계정당 1회만 로그인하고 토큰을 재사용하며, `beforeAll`에서 `rate:login:*`를 비운다(안 그러면 연속 두 번째 실행이 429).
   - `jest.config.ts` → `jest.config.cjs`: Node 22.18+ 타입 스트리핑이 `export default`를 보고 ESM으로 판정해 `__dirname`이 사라지는 문제(로컬에서 jest가 config 파싱 단계에서 죽음)를 확장자로 못 박아 해결.
4. ✅ **`approve()` 트랜잭션화** — `DataSource` 주입 후 `seller.update`와 `user.save`를 단일 `dataSource.transaction()`으로 원자화. 정합성 케이스 테스트 추가. (Step 0 완료, commit `84a83f4`)
5. ⏸ `orderItem.sellerId ?? 0` 고아 방지 가드 — Step 3(주문/배송) 착수 시 함께 처리.
