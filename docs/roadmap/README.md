# 인프라 완성까지 — 실행 로드맵

> 이 폴더는 "셀러 핵심기능 → 관리자 페이지 → 인프라(nginx)"까지의 단계별 계획이다.
> 큰 그림·컨벤션은 루트 `CLAUDE.md` 참조. 여기서는 **무엇을 / 어디에 / 어떻게** 만들지를 단계별로 적는다.

## 핵심 전제 (코드를 읽고 확인한 사실)

이 프로젝트는 **백엔드가 프론트보다 훨씬 앞서 있다.** 셀러·관리자 기능에 필요한
대부분의 API는 이미 구현·가드(역할)까지 걸려 있고, **프론트만 stub**(3줄 placeholder)다.
따라서 이 로드맵의 대부분은 "신규 백엔드 개발"이 아니라 **기존 백엔드에 프론트를 연결**하는 작업이다.

| 영역 | 백엔드 | 프론트 |
|---|---|---|
| 셀러 신청/승인 | ✅ 완성 | 신청폼만 일부, 관리자측 stub |
| 셀러 상품 등록/관리 | ✅ 완성 | stub |
| 셀러 주문/배송 | ✅ 완성 | stub |
| 셀러/관리자 정산 | ✅ 완성(경로 버그 ⚠) | stub |
| 관리자 주문/상품승인/셀러승인 | ✅ 완성 | stub |
| 관리자 대시보드 | ✅ 완성 | ✅ 완성 |

## 선행 검토

- [00-role-audit.md](./00-role-audit.md) — **3-Role(buyer/seller/admin) 인가·승인 로직 검토.** 셀러/관리자 화면 착수 전 필독(승인 로직 정합성, 토큰 staleness, 데모 가드).

## 계획 외 삽입 — 운영/관측성 (2026-06-14)

- [ex-sentry-slack.md](./ex-sentry-slack.md) — **Sentry 에러 추적 + Slack 알림 3종(CI / Claude 훅 / Sentry).** 숫자 시퀀스(셀러→관리자→인프라) **밖**에서, 기능 전달과 무관하게 운영 가시성을 먼저 확보하려고 **Step 0과 Step 1 사이에 끼어든 트랙**이다. 연동 과정의 엣지케이스 6건(Push Protection · isHeadersSent · node:async_hooks · 광고차단 · "새 이슈만 알림" · dev/운영 성능차) 회고를 담는다. 번호 대신 `ex-`(시퀀스 밖) 프리픽스를 쓴다.
- [ex-audit-log-admin.md](./ex-audit-log-admin.md) — **관리자 감사로그 조회(계획서).** Sentry(기술적 예외)와 상보적인 "행위/보안 기록" 뷰어를 관리자 페이지에 붙이는 작업. 로드맵상 Step 5(후순위)지만 읽기 전용·백엔드 완성이라 독립적이어서 운영 가시성 트랙으로 당겨온다. 핵심: **(1) 라우트 이중 prefix 버그 일괄 수정**(아래 선결 과제 참조), **(2) 시드 재기준화·확장**(시드가 실행시각 기준 backdate라 시간이 지나면 그래프에서 사라짐), **(3) 프론트 뷰어 2면(트리아지 요약 + 포렌식 검색)**. 같은 `ex-` 프리픽스.

## 우선순위 / 단계

| Phase | 문서 | 목표 | 비중 |
|---|---|---|---|
| **1** | [01-seller-core.md](./01-seller-core.md) | 셀러 핵심: 상품 등록·관리, 주문/배송, 정산 조회 | 최우선 |
| **2** | [02-admin-core.md](./02-admin-core.md) | 관리자 핵심: 셀러 승인, 상품 승인, 주문 관리, 정산 지급 | 높음 |
| **3** | [03-infra-nginx.md](./03-infra-nginx.md) | nginx 도입으로 Vercel→EC2 프록시 우회 대체 | 중간 |

"필수 기능 우선" 원칙: 각 Phase 안에서도 **(A) 필수 = 시연에 반드시 필요** / **(B) 후순위**로 나눈다.
카테고리 관리·문의 답변 등은 후순위.

## 확정 구현 순서 (이 순서로 작업한다)

> 문서는 **행위자별**(셀러/관리자/인프라)로 정리했지만, 구현은 **수직 슬라이스**로 진행한다.
> 이유: 셀러가 되려면 관리자 승인이 필요하므로 "셀러 신청(1①)"과 "관리자 승인(2①)"은 한 쌍이고,
> 승인 UI 없이 셀러 기능을 만들면 시연·검증이 불가능하다(데모 관리자는 `DemoAccountGuard`로 차단됨).
> 각 Step은 그 자체로 **끝까지 시연 가능**해야 한다.

| Step | 내용 | 묶이는 문서 항목 |
|---|---|---|
| ✅ **0. 기반 정리** | 정산 `v1/` prefix 수정 · `approve()` 트랜잭션화 · 토큰 staleness 방침 결정 · 서비스 정합성 테스트 보강 (commit `84a83f4`) | [00-role-audit](./00-role-audit.md) §7 |
| **1. 셀러 온보딩** | 셀러 신청/상태 + 관리자 셀러 승인/반려 (→ 셀러 기능 잠금 해제) | 01 ① + 02-A ① |
| **2. 상품** | 셀러 상품 등록/관리 + 관리자 상품 승인/반려 | 01 ② + 02-A ② |
| **3. 주문/배송** | 셀러 주문·배송 처리 + 관리자 전체 주문 관리 | 01 ③ + 02-A ③ |
| **4. 정산** | 셀러 정산 조회 + 관리자 정산 확정/지급 (prefix는 Step 0에서 해결) | 01 ④ + 02-A ④ |
| **5. 후순위 화면** | 셀러 대시보드 요약 → 관리자 감사로그 → 카테고리·문의(가장 후순위) | 01-B / 02-B |
| **6. 인프라** | nginx 리버스 프록시 + 4000 비공개 + TLS | [03-infra-nginx](./03-infra-nginx.md) |
| **7. 주문 입력 리팩터링** | createOrder `cartItemIds → items[]` 분리 (셀러·주문 흐름 안정화 후) | 메모리 `order_input_refactor` |

각 Step DoD는 "구매자/셀러/관리자 한 흐름으로 끊김 없이 동작"이며, Step 1~4가 끝나면 셀러↔관리자 양방향 시나리오가 완성된다.

## 공통 작업 패턴 (모든 Phase 프론트 작업에 적용)

기존 코드(예: `service/order.ts`, `hooks/order-query-options.ts`, 대시보드)에서 검증된 방식 그대로 따른다.

1. **API 클라이언트**: `frontend/src/service/<domain>.ts`에 함수 추가.
   - `authClient`(인증 필요) 사용. 경로는 전역 prefix 제외하고 `/seller/...`, `/admin/...` 식으로.
   - 예: `authClient.get('/seller/orders', { params })` (참고: `service/order.ts`)
2. **타입**: 가능하면 `@shopping-mall/shared`의 타입 재사용, 없으면 `frontend/src/model/`에 추가.
3. **데이터 패칭**: TanStack Query. `hooks/<domain>-query-options.ts` + `hooks/use<Domain>.ts` (참고: `hooks/order-query-options.ts`, `hooks/useDashboardQuery.ts`).
4. **페이지**: 해당 stub `page.tsx`를 실제 UI로 교체. 목록은 page/cursor 페이지네이션 백엔드 응답 형식에 맞춤.
5. **권한**: 셀러 라우트는 `(main)/seller/*`(SELLER 역할), 관리자 라우트는 `(admin)/admin/*`(`middleware.ts` + `AdminGuard`로 보호됨). 프론트에서도 비셀러/비관리자 접근 시 안내·리다이렉트.

## 가로지르는 선결/정리 과제 (착수 전 확인)

- ⚠ **라우트 이중 prefix 버그 (무리)**: 전역 prefix가 이미 `/v1`(`main.ts:85`)인데 일부 컨트롤러가 `@Controller('v1/...')`로 한 번 더 붙여 **실제 경로가 `/v1/v1/...`**가 된다. 정산(`settlement.controller.ts`)은 Step 0(`84a83f4`)에 정정 완료. **남은 무리**: `audit`/`wish-list`/`inquiry`/`user`/`review` 컨트롤러. **[ex-audit-log-admin.md](./ex-audit-log-admin.md) §2에서 일괄 수정**한다(깨질 프론트 호출부는 `wishlist.ts:11` 하나뿐 — 나머지는 프론트 미연결이라 백엔드만 고치면 됨).
- ⚠ **역할 변경 후 토큰 staleness**: 인가는 "토큰에 박힌 역할" 기준이라, 셀러 승인 직후에도 본인 토큰이 갱신되기 전(재로그인/refresh, access 15분)까지는 셀러 API가 403. 프론트는 `/auth/me`(DB fresh)로 메뉴를 띄우므로 "메뉴는 보이는데 API는 막힘"이 생길 수 있다. 셀러 승인 화면 설계 시 재로그인 안내/강제 토큰 갱신 고려. (상세 [00-role-audit.md](./00-role-audit.md) §2,§6)
- ✅ **확정(2026-06-14)**: 관리자 감사로그 조회 엔드포인트 **존재** — `GET /v1/admin/audit-logs`, `@Roles(ADMIN)` 가드 + `AuditLogQueryDto` 필터(userId/action/success/기간/IP) 완비(`audit.controller.ts`). 단 위 이중 prefix 버그 대상이며 응답 DTO에 행위자 이름이 없는 갭이 있다 → 상세·조치 [ex-audit-log-admin.md](./ex-audit-log-admin.md).
- ❓ **확인 필요(미점검)**: 셀러 문의 답변 엔드포인트(`inquiry/`)의 존재·역할 가드. 해당 Phase 착수 시 컨트롤러를 직접 읽어 확정(없으면 그 화면은 후순위로). (`inquiry`도 위 prefix 버그 무리에 포함)
- **DTO 출처**: 셀러 상품등록 폼은 `backend/src/product/dto/create-product.dto.ts`를 진실의 원천으로 필드 구성(name·description·price·brand 필수, stockQuantity·categoryId·salesType·discountRate 선택). 카테고리별 specs(JSONB)는 후순위.
