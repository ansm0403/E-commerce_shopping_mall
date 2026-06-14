# 운영/관측성 — 관리자 감사로그 조회 (계획 외 삽입 · ex- 트랙)

> 이 문서는 로드맵 숫자 시퀀스(`00`~`03`: 셀러 → 관리자 → 인프라) **밖**의 작업이다.
> 그래서 번호 대신 `ex-`(시퀀스 밖 / extra) 프리픽스를 쓴다. [ex-sentry-slack.md](./ex-sentry-slack.md)와 같은 **운영 가시성 트랙**이다.
>
> 성격: ex-sentry-slack은 "이미 한 일의 회고"지만, **이 문서는 아직 착수 전인 "계획서"**다.
> 그래서 구조는 [02-admin-core.md](./02-admin-core.md)의 계획 스타일(목표 / 선결 / 단계 / DoD)을 따른다.
> 데이터 흐름 문서(`docs/etc/data-flow/`)가 아니므로 `DOC_GUIDE.md` 템플릿(가상 주인공·시퀀스 다이어그램)은 적용하지 않는다.
>
> 작성 기준일: 2026-06-14. 인용한 `파일:라인`은 변경 시 달라질 수 있으니 착수 시 재확인.
> 이 문서는 **다른 컨텍스트에서 그대로 구현에 착수**할 수 있도록 자기완결적으로 작성한다.

---

## 0. 한 줄 결론

- 방금 붙인 **Sentry(예기치 못한 기술적 예외)** 와 상보적인, **"누가·언제·무엇을 했나"(의도된 행위/보안 기록)** 를 보여주는 **감사로그 뷰어**를 관리자 페이지에 붙인다.
- 백엔드 조회 엔드포인트·필터·가드는 **이미 존재**한다. 이 작업의 실체는 **(1) 라우트 prefix 버그 일괄 수정, (2) 시드 데이터 재기준화·확장, (3) 프론트 뷰어 2면(요약+검색) 구현**이다.
- **mock(프론트 하드코딩)은 쓰지 않는다.** 대신 **DB 시드**(실제 `audit_logs` 행)를 갱신·확장해, 뷰어가 실제 엔드포인트·쿼리·필터를 거쳐 동작하게 한다.

---

## 0-1. 실행 결과 — 완료 (2026-06-14)

Step A~E 전부 구현·검증 완료. 계획대로 진행했고, 착수 중 **계획에 없던 버그 2건을 추가로 발견·수정**했다.

- **A. prefix + 뼈대 정리** — 6개 데코레이터 `v1/` 제거 + `wishlist.ts` 경로 수정 + `getFailedLoginAttempts` 삭제. 새 경로 200/401·옛 경로 404 curl 검증.
- **B. 시드 재기준화·확장** — `SEED_RESET` 재시드로 "오늘" 기준 재정렬(이전엔 03~04월로 밀려나 있었음) + 버킷 B(시스템오류)·C(관리자행위) 시드 추가. `insertAuditLog`에 `metadata` 병합 파라미터 추가.
- **C. DTO 행위자 보강** — `getAuditLogs`에 user 일괄 조인(N+1 회피) + DTO `userNickName`/`userEmail`. userId=null은 metadata.email fallback.
- **D. 트리아지 뷰** / **E. 포렌식 검색 뷰** — `service/admin-audit.ts` → `hooks/useAuditQuery.ts`(TanStack Query, `useQueries`로 N회 호출) → page + 컴포넌트 3개. 트리아지 창은 시드가 30일에 걸쳐 있어 **30일**로 설정(7일이면 희소한 버킷 B가 빌 수 있음).

**계획 외 발견·수정한 버그 2건**:
1. **시드 reset가 정산 FK로 실패** — `settlements.order_id`가 `[SEED]` 주문을 참조해 `DELETE FROM orders`가 막힘. `resetSeedData`에 정산 선삭제 추가.
2. **`success=false` 필터가 깨짐** — 전역 `ValidationPipe`의 `enableImplicitConversion`이 `@Transform`보다 먼저 돌며 `'false'`(string)→`true`로 coerce. DTO에서 원본 `obj[key]`(raw 쿼리스트링)를 읽도록 수정. (수정 전: `success=false`/`true`가 동일 집합 반환)
3. **잘못된 날짜 쿼리가 500** — `startDate`/`endDate`가 `@IsString`이라 `?startDate=foo`가 통과 → `new Date('foo')`=Invalid Date → pg 오류 500. `@IsDateString`으로 바꿔 400 처리(프론트가 보내는 `YYYY-MM-DD`/ISO는 통과). 엣지케이스 검증 중 발견.
4. **시각이 UTC로 표시(9h 어긋남)** — `audit_logs.createdAt`가 `timestamp without time zone`(naive=UTC)인데 node-postgres가 읽을 때 프로세스 로컬(KST)로 해석 → API가 9h 어긋난 인스턴트 반환. `main.ts` bootstrap에 `process.env.TZ='UTC'`로 읽기/쓰기 UTC 일치(대시보드는 SQL `AT TIME ZONE`이라 무영향). 프론트는 `toLocaleString(timeZone:'Asia/Seoul')`로 KST 표시.
5. **`take` 무상한** — 엣지케이스 검증 중 발견. `?take=100000` 같은 거대 값이 통과해 무거운 쿼리 가능(admin 전용이라 위험은 낮음). DTO에 `@Max(100)` 추가 → 초과 시 400.

> 엣지케이스 검증(URL 직접 조작 기준): 잘못된 날짜/page=0·음수/take 초과·userId 비숫자 → 모두 400, 결과 0건·전부 userId=null·page 범위초과 → graceful 200. 위 3·5번이 그 과정에서 잡혀 수정됨.

> 빌드 도구 메모: `nx serve backend`(webpack dev)는 매우 느림. 시드/기동은 `yarn nx build backend` 후 `node backend/dist/main.js`가 수 초로 빠름.

---

## 1. 배경 — Sentry와의 경계, 그리고 왜 지금 하는가

### 1-1. 감사로그 vs Sentry (겹치지 않음)

| | Sentry | 감사로그(audit_logs) |
|---|---|---|
| 잡는 것 | **예기치 못한 기술적 예외**(crash, stack trace) | **의도된 비즈니스/보안 행위**(로그인, 승인, 결제, 취소 등) |
| 계층 | 인프라/관측성, 외부 SaaS | 애플리케이션/도메인, 내부 PostgreSQL |
| 목적 | 디버깅·복구 | 책임추적(accountability)·포렌식·보안 |
| 표시 위치 | Sentry 대시보드 + Slack `#sentry-errors` | **관리자 페이지(이번 작업)** |

`success=false`/`errorMessage`에서 약간 겹치지만, Sentry는 *예외*를, 감사로그는 *행위*를 기록한다. 면접 예상질문("Sentry 있는데 감사로그 왜?")의 답이 이 표다.

### 1-2. 왜 시퀀스 밖에서 지금 하는가

- 로드맵상 감사로그 조회는 **Step 5(후순위)** 지만(README 참조), 실제로는 **읽기 전용**이고 백엔드가 완성돼 있어 `00`~`02`(셀러·관리자 핵심) 미구현과 **독립적**이다.
- 표시할 **실데이터가 이미 존재**한다: `@Auditable` 데코레이터와 auth 이벤트가 백엔드 레벨에서 이미 동작 → 완성된 구매자 커머스 흐름(로그인/주문/결제/리뷰…)이 지금도 `audit_logs`를 쌓는다. 또한 [dashboard.seed.service.ts](../../backend/src/seed/dashboard.seed.service.ts)가 합성 행을 backdate로 채운다.
- 방금 끝낸 [ex-sentry-slack.md](./ex-sentry-slack.md) **운영 가시성 트랙의 자연스러운 연장**이라 서사가 일관된다.

---

## 2. 선결 과제 (착수 전 반드시) — 라우트 이중 prefix 버그 일괄 수정

### 2-1. 증상 / 원인

전역 prefix가 `v1`([main.ts:85-86](../../backend/src/main.ts#L85))인데, 일부 컨트롤러가 `@Controller('v1/...')` 로 **prefix를 한 번 더** 달았다. NestJS는 둘을 이어붙이므로 실제 경로가 **`/v1/v1/...`** 가 된다. 정산에서 이미 한 번 겪고 Step 0(commit `84a83f4`)에 고친 그 버그와 **동일 패밀리**다.

> 로컬 기준 axios `baseURL = http://localhost:4000/v1`([.env](../../frontend/.env), [axios-http-client.ts:5](../../frontend/src/lib/axios/axios-http-client.ts#L5)).
> 운영은 `baseURL=/api` → [next.config.js rewrites](../../frontend/next.config.js#L181)가 `/api/* → {EC2}/v1/*`로 프록시.
> 어느 쪽이든 `@Controller('v1/wishlist')`를 부르려면 프론트가 `/v1/wishlist`를 또 붙여야 해서 `/v1/v1/...`로 맞아떨어지는, **양쪽이 같이 틀려서 우연히 동작하던** 상태다.

### 2-2. 수정 대상 (백엔드) — 6개 데코레이터 / 5개 컨트롤러

각 컨트롤러의 `@Controller(...)` 에서 **앞의 `v1/` 만 제거**한다. (전역 prefix가 이미 `v1`을 붙이므로)

| 컨트롤러 파일 | 현재 (버그) | 실제 경로(현재) | **수정 후** | 수정 후 실제 경로 |
|---|---|---|---|---|
| [audit.controller.ts](../../backend/src/audit/audit.controller.ts#L11) | `v1/admin/audit-logs` | `/v1/v1/admin/audit-logs` | `admin/audit-logs` | `/v1/admin/audit-logs` |
| [wish-list.controller.ts](../../backend/src/wish-list/wish-list.controller.ts) | `v1/wishlist` | `/v1/v1/wishlist` | `wishlist` | `/v1/wishlist` |
| [inquiry.controller.ts](../../backend/src/inquiry/inquiry.controller.ts) | `v1/inquiries` | `/v1/v1/inquiries` | `inquiries` | `/v1/inquiries` |
| [inquiry.controller.ts](../../backend/src/inquiry/inquiry.controller.ts) | `v1/seller/inquiries` | `/v1/v1/seller/inquiries` | `seller/inquiries` | `/v1/seller/inquiries` |
| [user.controller.ts](../../backend/src/user/user.controller.ts) | `v1/users` | `/v1/v1/users` | `users` | `/v1/users` |
| [review.controller.ts](../../backend/src/review/review.controller.ts) | `v1/reviews` | `/v1/v1/reviews` | `reviews` | `/v1/reviews` |

> 참고(이미 정상): [settlement.controller.ts](../../backend/src/settlement/settlement.controller.ts)는 Step 0에서 `seller/settlements` / `admin/settlements`로 정정됨. 나머지 컨트롤러(`orders`, `cart`, `products`, `payments`, `categories`, `admin/dashboard`, `auth`, `seller`, `common`)는 처음부터 정상이다.

### 2-3. 수정 대상 (프론트) — 단 1곳

prefix를 고치면 **그 라우트를 부르던 프론트도 같이 바꿔야** 한다. 전체 프론트를 조사한 결과, 버그 경로를 실제로 호출하는 곳은 **하나뿐**이다.

| 파일 | 현재 호출 | **수정 후** |
|---|---|---|
| [wishlist.ts:11](../../frontend/src/service/wishlist.ts#L11) | `authClient.post('/v1/wishlist/toggle')` | `authClient.post('/wishlist/toggle')` |

**review / inquiry / user 컨트롤러는 프론트가 아직 호출하지 않는다** → 백엔드만 고치면 되고 회귀 위험 없음. 근거:
- 리뷰: [ReviewSection.tsx](../../frontend/src/app/(main)/products/[id]/ReviewSection.tsx)는 평점분포가 **"예시 데이터"** 하드코딩이고 별점은 `product.rating`/`reviewCount`(상품 응답 임베드)에서 옴 → 리뷰 전용 API 호출 없음.
- 문의: `my/inquiries`, `seller/inquiries` 페이지는 stub.
- 유저: `v1/users` 별도 호출 없음(인증은 `/auth/*` 사용).
- → 이들은 나중에 프론트를 붙일 때 **정상 경로(`/reviews`, `/inquiries`)** 로 호출하면 그대로 동작한다(이번 수정의 부수 효과로 미래 작업이 쉬워짐).

### 2-4. 검증 (필수)

수정 후 각 라우트가 새 경로로 응답하고 옛 경로가 404임을 확인한다. (백엔드 직접 호출 기준, 전역 prefix 포함)

```bash
# 예: 감사로그 (ADMIN 토큰 필요)
curl -i http://localhost:4000/v1/admin/audit-logs        # 200/401 (라우트 존재)
curl -i http://localhost:4000/v1/v1/admin/audit-logs     # 404 (옛 경로 사라짐)
# 위시리스트 토글은 프론트(/wishlist/toggle)로 실제 토글 동작까지 확인
```

> 위시리스트는 **백엔드+프론트를 한 쌍으로** 고치고, 찜 토글이 실제로 되는지 UI로 확인한다(유일한 회귀 지점).

### 2-5. AuditService 코드 정리 (뼈대 신뢰성 — 착수 전 권장)

> ✅ **구현 결과**: 1번 **`getFailedLoginAttempts` 삭제 완료**(죽은 코드+버그 동시 제거). 2번 페이지네이션 통일은 **보류** — `getAuditLogs`는 손수 `findAndCount` 유지(응답 `meta` 형식이 뷰어 페이지네이션에 그대로 맞고, 행위자 보강 로직과 결합도 낮음).

뷰어가 올라탈 [audit.service.ts](../../backend/src/audit/audit.service.ts)는 전반적으로 건전하나, **죽은 코드 1개에 버그가 박혀 있어** 나중에 누가 믿고 쓰다 당하기 전에 정리한다.

1. **`getFailedLoginAttempts` 삭제(권장) 또는 수정** — [audit.service.ts:84-96](../../backend/src/audit/audit.service.ts#L84). **현재 호출부 없음(죽은 코드)** 이고 로그인 잠금/레이트리밋은 Redis로 따로 처리하므로 영향 0. 단, 쿼리 2곳이 틀려 있다:
   - `createdAt: since` → TypeORM에서 `createdAt = since`(동등)로 번역됨. "이후"를 원하면 **`MoreThanOrEqual(since)`** 여야 한다(같은 파일 [getAuditLogs:65](../../backend/src/audit/audit.service.ts#L65)는 올바르게 씀 — 여기만 누락).
   - `metadata: { email }` → `json` 컬럼 전체 동등비교라 부분매칭이 안 됨.
   - **결정**: 쓸 계획이 없으면 **삭제**(버그+죽은 코드 동시 제거). 향후 보안 카드에 "이메일별 24h 실패수"가 필요해지면 그때 `MoreThanOrEqual` + JSON 연산자로 재구현.
2. **(선택) 페이지네이션 방식 통일** — [getUserLogs](../../backend/src/audit/audit.service.ts#L46)는 `commonService.paginate`, [getAuditLogs](../../backend/src/audit/audit.service.ts#L52)는 손수 `findAndCount`. 동작은 정상이라 필수는 아니나, 뷰어가 `getAuditLogs`를 주로 쓰므로 통일하면 일관성↑.

> 위 1·2는 prefix 수정(§2-1~2-4)과 독립적인 저위험 정리라 **Step A에 함께 묶어** 처리하면 된다. 1은 권장, 2는 선택.

---

## 3. 시드 데이터 재기준화 · 확장 (이 작업의 절반)

감사로그 뷰어는 **실제 `audit_logs` 행**을 보여줘야 한다. 현재 시드([dashboard.seed.service.ts](../../backend/src/seed/dashboard.seed.service.ts))가 그 행을 만들지만, 두 가지 손질이 필요하다.

### 3-1. 문제 — 시드가 "실행 시각" 기준이라 시간이 지나면 그래프에서 사라진다

- 근본 원인: [seed-helpers.ts:14-20](../../backend/src/seed/seed-helpers.ts#L14)의 `randomKstTime(daysAgo)`가 **`Date.now()`(시드 실행 시점)** 를 기준으로 N일 전 시각을 만든다.
- 결과: 시드 데이터는 `[시드 실행일 - SEED_DAYS, 시드 실행일]` 구간에 고정 backdate된다. 시드를 만든 지 오래돼서, **오늘 기준 "최근 30일" 창에는 데이터가 거의/전혀 안 들어온다** → 그래프가 비고, 필터를 과거로 한 달 밀어야 보임.
- **해법: 임시로 필터를 미루지 말고, 재시드로 "오늘" 기준 재기준화한다.** 시드는 멱등이라 `SEED_RESET=true`로 옛 시드를 지우고 다시 심으면 데이터가 다시 오늘 끝에 붙는다.

**재시드 명령** (현재 전용 Makefile/script 타깃 없음 — 환경변수로 실행. 시드 서비스는 [onApplicationBootstrap](../../backend/src/seed/dashboard.seed.service.ts#L47)에서 돌고 `process.exit(0)`):

```bash
# bash/zsh
NODE_SEED=true SEED_RESET=true SEED_DAYS=30 yarn nx serve backend
```
```powershell
# PowerShell (Windows)
$env:NODE_SEED='true'; $env:SEED_RESET='true'; $env:SEED_DAYS='30'; yarn nx serve backend
```

- `SEED_RESET=true`: `metadata->>'seed'='v1'` 마커 행 + `[SEED]` 주문 + `@seed.com` 유저를 지우고 재생성([resetSeedData](../../backend/src/seed/dashboard.seed.service.ts#L482)). 운영 데이터(실 admin/회원)는 건드리지 않음.
- 데모 관리자 계정은 `DEMO_ADMIN_EMAIL/PASSWORD` 있을 때만 멱등 생성([seedDemoAdmin](../../backend/src/seed/dashboard.seed.service.ts#L95)).
- ⚙ **개선 제안(선택)**: 매번 환경변수 나열이 번거로우니 `Makefile`에 `seed`/`seed-reset` 타깃 추가 또는 `backend/package.json` script 추가. 본 작업의 필수는 아님(후속).

### 3-2. 현재 시드가 채우는 것 / 비는 것 (3버킷 매핑)

뷰어는 3개 버킷으로 분류해 보여줄 계획이다(§5). 시드 커버리지는 다음과 같다.

| 버킷 | 대상 action | 현재 시드 | 비고 |
|---|---|---|---|
| **A. 보안·이상징후** | `LOGIN` / `FAILED_LOGIN` / `ACCOUNT_LOCKED` | ✅ 완비 | [seedLoginAudit](../../backend/src/seed/dashboard.seed.service.ts#L384). 실패율 7%, [SPIKE_DAYS](../../backend/src/seed/dashboard.seed.service.ts#L27)(10·20일 전) 22% + 잠금 |
| **B. 시스템 오류** | `success=false` + `errorMessage` (결제검증/웹훅/크론 실패 등) | ⚠ 거의 없음 | 현재 `ACCOUNT_LOCKED`만 실패 플래그. 결제·크론 실패 행 부재 → **이 버킷이 빈 화면** |
| **C. 관리자 행위(책임추적)** | `SELLER_APPROVED` / `PRODUCT_APPROVED`·`PRODUCT_REJECTED` / `PAYMENT_CANCELLED_ADMIN` / `SETTLEMENT_CONFIRMED`·`SETTLEMENT_PAID` / `INQUIRY_ANSWERED` | ❌ 전무 | 시드가 관리자 행위를 만들지 않음 → **이 버킷 완전히 빈 화면** |

> 참고: 주문 이벤트(`ORDER_CREATED`/`PAYMENT_VERIFIED`/`ORDER_CANCELLED`)는 [seedOrdersAndEvents](../../backend/src/seed/dashboard.seed.service.ts#L225)가 채운다(주문 테이블과 정합). 이건 어느 버킷에도 강제로 안 넣고 "포렌식 검색 뷰"(§5-B)에서 보인다.

### 3-3. 추가할 시드 — 버킷 B·C 채우기

[dashboard.seed.service.ts](../../backend/src/seed/dashboard.seed.service.ts)에 두 줄기를 추가한다. 둘 다 기존 [insertAuditLog](../../backend/src/seed/dashboard.seed.service.ts#L442) 헬퍼를 재사용하면 몇 줄이면 된다. **반드시 `metadata`에 `{seed:'v1'}` 마커**가 들어가야 `SEED_RESET`으로 정리된다(insertAuditLog가 이미 `SEED_METADATA`를 넣음).

1. **버킷 B — 실패/오류 이벤트** (소수, 현실적 비율):
   - 기존 70% 결제 흐름([seedOrdersAndEvents](../../backend/src/seed/dashboard.seed.service.ts#L257)) 중 일부를 `PAYMENT_VERIFIED success=false, errorMessage='amount mismatch'`로 분기, 또는 별도 루프로 `PAYMENT_WEBHOOK`/`SETTLEMENT_*` 실패 몇 건.
   - 가능하면 `CRON_ORDER_EXPIRED` 같은 무인 동작도 일부 `success=false`로(시스템 자동 동작 가시성).
   - 권장량: 30일치에 걸쳐 총 5~15건 정도(드물어야 현실적).
2. **버킷 C — 관리자 행위 이벤트**:
   - 데모 관리자 userId(있으면)로 `SELLER_APPROVED`(5명 셀러 승인), `PRODUCT_APPROVED`/`PRODUCT_REJECTED` 몇 건, `PAYMENT_CANCELLED_ADMIN` 1~2건, `SETTLEMENT_CONFIRMED`/`SETTLEMENT_PAID` 몇 건.
   - 데모 관리자 계정이 없을 수 있으니, 없으면 시드 유저 중 하나를 "관리자 역할"로 처리하거나 `userId=null`로 두되 metadata에 actor 표시.

> ⚠ **정합성 주의**: 버킷 C의 `SELLER_APPROVED`는 시드 셀러가 이미 `APPROVED`로 생성되므로([seedUsers](../../backend/src/seed/dashboard.seed.service.ts#L172)) "로그만" 추가하면 된다(상태와 어긋나지 않음). `SETTLEMENT_*`는 정산 행을 시드하지 않으면 "로그만 존재"가 되는데, 감사로그 뷰어 관점에선 허용 가능(정산 프론트는 Step 4 영역). 문서·코드 주석에 "로그 전용"임을 명시.

---

## 4. 백엔드 — 대부분 이미 존재 (확정 사실)

### 4-1. 조회 엔드포인트 (그대로 사용)

| 항목 | 내용 |
|---|---|
| 경로 | `GET /v1/admin/audit-logs` (**§2-1 prefix 수정 후**) |
| 가드 | `JwtAuthGuard` + `RolesGuard` + `@Roles(Role.ADMIN)` ([audit.controller.ts:11-14](../../backend/src/audit/audit.controller.ts#L11)) |
| 직렬화 | `@Serialize(AuditLogResponseDto)` ([audit.controller.ts:18](../../backend/src/audit/audit.controller.ts#L18)) |
| 서비스 | [getAuditLogs](../../backend/src/audit/audit.service.ts#L52) — page/take 페이지네이션 + where 필터 + `createdAt DESC` |
| 필터(쿼리) | [AuditLogQueryDto](../../backend/src/audit/dto/audit-log-query.dto.ts#L5): `page`(기본1) · `take`(기본50, **최대100**) · `userId` · `action`(string) · `success`(bool, raw `obj[key]` 파싱) · `startDate`·`endDate`(`@IsDateString`) · `ipAddress` |
| 응답 | `{ data: AuditLogResponseDto[], meta: { total, page, lastPage, take, hasNextPage } }` — **DTO에 `userNickName`/`userEmail` 포함(§4-2 ① 구현)** |
| action 종류 | [AuditAction enum](../../backend/src/audit/entity/audit-log.entity.ts#L3) (인증·주문·결제·배송·상품·셀러·리뷰·정산·문의·사용자·크론) |

→ 즉 **포렌식 검색 뷰(§5-B)에 필요한 필터는 백엔드가 전부 지원**한다. 프론트가 쿼리스트링만 붙이면 됨.

### 4-2. ⚠ 갭 — "누가"를 사람이 못 읽는다 → **옵션 ① 채택·구현 완료**

> ✅ **구현 결과**: 옵션 ①. [getAuditLogs](../../backend/src/audit/audit.service.ts#L52)가 결과 행의 `userId`들을 모아 `In([...])`로 user를 **한 번에 조회(N+1 회피)**해 `userNickName`/`userEmail`을 행에 덧붙이고, [AuditLogResponseDto](../../backend/src/audit/dto/audit-log-response.dto.ts#L3)에 두 필드를 `@Expose`로 추가했다. `userId=null`(웹훅·크론·FAILED_LOGIN)은 `metadata.email` fallback → 없으면 null.

(아래는 착수 시 검토했던 세 옵션 기록. ① 채택.)

[AuditLogResponseDto](../../backend/src/audit/dto/audit-log-response.dto.ts#L3)는 `userId`(숫자)만 노출하고 **이메일/닉네임이 없다**. [getAuditLogs](../../backend/src/audit/audit.service.ts#L52)도 user 조인을 하지 않는다. 화면에 "user#42"만 뜨면 쓸모가 떨어진다. 세 옵션 중 택1(권장: ①):

1. **백엔드 조인/보강(권장)**: `getAuditLogs`에서 `userId`들을 모아 user를 한 번에 조회해 `nickName`/`email`을 응답에 덧붙임(N+1 회피). `AuditLogResponseDto`에 `userNickName?`/`userEmail?` 필드 추가. `FAILED_LOGIN`처럼 `userId=null`이고 `metadata.email`만 있는 경우는 metadata fallback.
2. 프론트 resolve: 별도 user 조회 API로 매핑(호출 증가, 비권장).
3. 표시 보류: 1차는 `userId`만, 후속 보강(빠른 시연용).

### 4-3. (선택) 요약 집계 엔드포인트 — 트리아지 카드용 → **옵션 (a) 채택**

> ✅ **구현 결과**: 옵션 (a). 요약 엔드포인트 신설 없이 [useAuditQuery.ts](../../frontend/src/hooks/useAuditQuery.ts)의 `useTriageQuery`가 기존 엔드포인트를 `useQueries`로 **필터별 N회 호출**(FAILED_LOGIN/ACCOUNT_LOCKED count, success=false count+샘플, 관리자 action별 count+최근). 시스템오류 count는 `success=false 전체 − 실패 − 잠금`으로 보안 버킷을 차감해 산출. 카드가 많아지면 (b) 요약 엔드포인트로 후속 최적화.

§5-A의 요약 카드("최근 24h: 실패 N · 잠금 M · 관리자행위 K")는 두 방법 중 택1:
- (a) **프론트에서 기존 엔드포인트를 필터로 N번 호출**(`?success=false`, `?action=FAILED_LOGIN`, 기간=24h) — 추가 백엔드 0, 1차 권장.
- (b) `GET /v1/admin/audit-logs/summary` 신설로 action별/버킷별 count 한 방 — 호출 절약, 후속 최적화.

---

## 5. 프론트 — 뷰어 2면 구조

라우트: [(admin)/admin/audit-logs/page.tsx](../../frontend/src/app/(admin)/admin/audit-logs) (현재 stub). 보호: `middleware.ts`(refreshToken 쿠키) + `AdminGuard`(role=ADMIN).
**공통 패턴**은 완성된 대시보드를 그대로 답습한다: [service/admin-dashboard.ts](../../frontend/src/service/admin-dashboard.ts#L37)(`authClient.get('/admin/...')`) → `hooks/*-query-options.ts`(TanStack Query) → page.

### 5-A. 트리아지 뷰 (요약 — "봐야 할 것")

요약 카드 + 클릭 시 해당 필터로 하단 포렌식 뷰 이동(`#forensic` 앵커 + URL 쿼리 세팅).

> ✅ **구현 결과**: 집계 기간은 **최근 30일**로 구현([TriageCards](../../frontend/src/app/(admin)/admin/audit-logs/components/TriageCards.tsx)). 계획의 "24h/7d" 대신 30일을 쓴 이유 — 시드 버킷 B(시스템오류)·C(관리자행위)가 30일에 걸쳐 드물게 분포해(§3-3) 7일 창에선 빌 수 있어 DoD "빈 버킷 없음"이 깨질 위험. 30일이면 세 버킷이 안정적으로 채워진다.

| 카드(버킷) | 데이터 소스(필터) |
|---|---|
| 🔴 보안·이상징후 | `action=FAILED_LOGIN`(success=false) count, `action=ACCOUNT_LOCKED` count, IP별 집계 |
| 🟠 시스템 오류 | `success=false` 전체 중 결제/정산/크론 우선 정렬, `errorMessage` 노출 |
| 🟡 관리자 행위 | `action IN (SELLER_APPROVED, PRODUCT_APPROVED, …)` 최근 목록(누가 무엇을) |

### 5-B. 포렌식 검색 뷰 (전체 — "무슨 일이 있었나")

[AuditLogQueryDto](../../backend/src/audit/dto/audit-log-query.dto.ts#L5) 필터를 그대로 노출하는 표:
- 필터 UI: `userId` · `action`(enum 셀렉트) · `success`(전체/성공/실패) · 기간(`startDate`~`endDate`) · `ipAddress`
- 표 컬럼: 시각(`createdAt`) · 행위자(§4-2 보강 후 닉네임/이메일) · action · success · IP · errorMessage · metadata(펼치기)
- 페이지네이션: 응답 `meta`(page/lastPage/hasNextPage) 사용

> 버킷 분류(triage)는 "프론트 표현"일 뿐, 데이터 출처는 같은 `audit_logs`다. 백엔드에 버킷 개념을 새로 만들지 않는다.

---

## 6. 작업 순서 (Step 분해 — 각 단계 그 자체로 시연 가능)

| Step | 내용 | 산출물/검증 |
|---|---|---|
| **A. prefix 수정 + 뼈대 정리** | §2 — 백엔드 6개 데코레이터 `v1/` 제거 + [wishlist.ts:11](../../frontend/src/service/wishlist.ts#L11) 경로 수정 + §2-5 `getFailedLoginAttempts` 삭제(권장) | §2-4 curl 검증 통과 + 위시리스트 토글 UI 동작 + 죽은 함수 제거 |
| **B. 시드 재기준화·확장** | §3 — `SEED_RESET=true` 재시드 + 버킷 B·C 시드 추가 | 대시보드 그래프가 "오늘" 기준 다시 채워짐 + `audit_logs`에 오류·관리자행위 행 존재 |
| **C. 응답 DTO 보강** | §4-2 — `getAuditLogs`에 user 조인 + DTO에 닉네임/이메일 | `/v1/admin/audit-logs` 응답에 행위자 이름 포함 |
| **D. 프론트 트리아지 뷰** | §5-A — 요약 카드(필터 N회 호출) | 관리자 페이지에 3버킷 요약 카드 표시 |
| **E. 프론트 포렌식 검색 뷰** | §5-B — 필터 + 표 + 페이지네이션 | 관리자가 userId/action/기간/success로 조회 |

> Step A·B는 백엔드/데이터 정리(독립), C는 A에 의존, D·E는 A+C에 의존. B는 어디서든 가능하나 D·E 시연 전 완료 권장.

---

## 7. 완료 기준 (DoD) — ✅ 전부 충족 (2026-06-14)

- prefix 버그 컨트롤러 6개가 `/v1/<...>` 단일 경로로 응답하고 옛 `/v1/v1/...`는 404. 위시리스트 토글 정상.
- `SEED_RESET=true` 재시드 후, 관리자 대시보드 그래프가 **오늘 기준**으로 채워진다(필터를 과거로 밀 필요 없음).
- 관리자 계정으로 `/admin/audit-logs` 진입 → **트리아지 3버킷 요약** + **포렌식 검색 표**가 **실제 시드/실데이터**로 동작(프론트 mock 없음).
- 행위자가 숫자 ID가 아니라 닉네임/이메일로 보인다(§4-2 ① 채택 시).
- 빈 버킷 없음: 보안·시스템오류·관리자행위 각 버킷에 표시할 행이 시드로 존재.

---

## 8. 파일 매핑 (조회용)

**백엔드 — 감사로그**
- 컨트롤러: [audit.controller.ts](../../backend/src/audit/audit.controller.ts) / 서비스: [audit.service.ts](../../backend/src/audit/audit.service.ts#L52)
- 엔티티·enum: [audit-log.entity.ts](../../backend/src/audit/entity/audit-log.entity.ts#L3)
- DTO: [audit-log-query.dto.ts](../../backend/src/audit/dto/audit-log-query.dto.ts#L5) / [audit-log-response.dto.ts](../../backend/src/audit/dto/audit-log-response.dto.ts#L3)
- 자동 로깅: [audit.interceptor.ts](../../backend/src/audit/interceptors/audit.interceptor.ts) / [auditable.decorator.ts](../../backend/src/audit/decorators/auditable.decorator.ts)

**백엔드 — prefix 버그 대상**
- [audit.controller.ts](../../backend/src/audit/audit.controller.ts#L11) · [wish-list.controller.ts](../../backend/src/wish-list/wish-list.controller.ts) · [inquiry.controller.ts](../../backend/src/inquiry/inquiry.controller.ts) · [user.controller.ts](../../backend/src/user/user.controller.ts) · [review.controller.ts](../../backend/src/review/review.controller.ts)
- 전역 prefix: [main.ts:85](../../backend/src/main.ts#L85) / 기수정 참고: [settlement.controller.ts](../../backend/src/settlement/settlement.controller.ts)

**백엔드 — 시드**
- [dashboard.seed.service.ts](../../backend/src/seed/dashboard.seed.service.ts) (주문이벤트 [:225](../../backend/src/seed/dashboard.seed.service.ts#L225), 보안로그 [:384](../../backend/src/seed/dashboard.seed.service.ts#L384), 공통 INSERT [:442](../../backend/src/seed/dashboard.seed.service.ts#L442), reset [:482](../../backend/src/seed/dashboard.seed.service.ts#L482))
- [seed-helpers.ts:14](../../backend/src/seed/seed-helpers.ts#L14) (시각 기준 `Date.now()` [:20](../../backend/src/seed/seed-helpers.ts#L20)) / [seed.module.ts](../../backend/src/seed/seed.module.ts)

**프론트** (✅ 구현 완료)
- 수정: [wishlist.ts:11](../../frontend/src/service/wishlist.ts#L11)(prefix), [UserMenu.tsx](../../frontend/src/components/header/topbar/UserMenu.tsx)(관리자 진입 버튼), [AdminSidebar.tsx](../../frontend/src/app/(admin)/admin/components/AdminSidebar.tsx)(상단 홈 링크)
- 신규: [service/admin-audit.ts](../../frontend/src/service/admin-audit.ts)(API+타입+action 라벨), [hooks/useAuditQuery.ts](../../frontend/src/hooks/useAuditQuery.ts)(`useAuditLogsQuery`+`useTriageQuery`), [page.tsx](../../frontend/src/app/(admin)/admin/audit-logs/page.tsx) + 컴포넌트 3개(`TriageCards`·`AuditFilters`·`AuditTable`)
- 패턴 참고: [admin-dashboard.ts](../../frontend/src/service/admin-dashboard.ts#L37) / axios [axios-http-client.ts:5](../../frontend/src/lib/axios/axios-http-client.ts#L5)

---

## 9. 기존 로드맵 문서 동기화 (이 작업과 함께 갱신)

- [README.md](./README.md): `❓ 확인 필요(audit 엔드포인트 존재·가드)` → **"존재 확정(ADMIN 가드) + prefix 버그"** 로 갱신, "계획 외 삽입" 절에 이 문서 링크 추가.
- [02-admin-core.md](./02-admin-core.md) §2-B: 감사로그 항목의 `❓` 해소하고 이 문서로 포인터.
- prefix 버그 무리(wishlist/inquiry/user/review)는 README "가로지르는 선결/정리 과제"에 **"ex-audit-log-admin §2에서 일괄 수정"** 으로 기록.
