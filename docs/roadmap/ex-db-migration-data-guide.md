# DB 리셋 후 데이터 재현 가이드라인 (안전장치 ③)

> 작성: 2026-08-17, **DB를 지우기 전에** 작성함(안전장치 ③ 이행).
> 근거: 시드 소스 전수 분석 + EC2 운영 DB 실측 대조(`ex-db-migration-before-capture.md`).
> 백업: EC2 `~/db-backup-20260817/` + 로컬 `Desktop\fullstack\db-backups\20260817\` (sha256 일치 확인, 2026-08-17)

---

## 0. 한눈에 — 시드는 3계층이다

| 계층 | 파일 | 트리거 | 멱등성 |
|---|---|---|---|
| ① 부팅 시드 | `backend/src/common/seeds/roles.seed.ts`, `category.seed.ts` | **모든 부팅 시 자동**(`app.module.ts` providers) | 완전 멱등 |
| ② 상품 시드 | `common/seeds/product.seed.ts` | **배치 `SEED_PRODUCTS=true`(표준, 2026-08-18~)** 또는 `POST /v1/products/seed`(admin 전용으로 가드 복구됨) | **없음 — `TRUNCATE products CASCADE` 후 재삽입(파괴적)**. 단 배치 경로는 멱등 게이트 뒤라 no-op 재실행 시 TRUNCATE 안 함 |
| ③ 대시보드 시드 | `backend/src/seed/*.seed.service.ts` | `NODE_SEED=true` 일회성 배치(`nx run backend:seed`), 완료 후 `process.exit(0)` | audit 마커(`metadata->>'seed'='v1'`) 존재 시 전체 스킵. `SEED_RESET=true`로 리셋 |

---

## 1. 재현 순서 (이 순서 강제)

```
0) 환경변수 확인: DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD
   - 로컬: 루트 .env(52행)·backend/.env(51행)에 이미 있음
   - EC2: ec2.env.backup에 보존됨 (키 존재 실측 확인)
   - 없으면 → 데모 관리자가 "에러 없이 조용히" 빠지고, 관리자 행위 audit의
     actor가 전부 null로 떨어진다 (조용한 실패 경로)

1) 서버 정상 부팅 1회
   → roles 3행 + categories 27행 (자동, 멱등)

2) (구 경로 — 2026-08-18부터는 4)의 SEED_PRODUCTS=true 배치에 통합, 이 단계 생략 가능)
   POST /v1/products/seed  ※ admin 전용 가드 복구됨
   → products 349(published 336 / sold_out 13) + product_images 1,047(상품당 동일 URL 3중)
   → categories 선행 필수(없으면 categoryId 전부 null)
   ※ 이미지는 전부 외부 핫링크 URL(yes24/ssgcdn 등) — 로컬 파일 의존 없음
   ※ sellerId는 넣지 않음 → published 상품 seller_id = NULL (의도된 상태)

3) 백엔드 빌드 (dist/main.js 실행이므로 선행 필수)

4) NODE_SEED=true SEED_PRODUCTS=true SEED_DAYS=30 [SEED_RESET=true] node dist/main.js
   (= nx run backend:seed:full — 상품 시드가 배치 맨 앞에 통합돼 2)를 대체)
   → 데모 관리자 1 (env에서 읽음, isDemo=true, roles=[admin])
   → user1~20@seed.com + seller1~5@seed.com (공통 비번 Seed1234!, sellers 5행 APPROVED)
   → 주문 ~390건 + order_items ~580 (오늘 포함 31일, KST 09~23시 분포, memo='[SEED] 시드주문')
   → audit ~2,600건: 주문 ~780 + 보안 ~1,820(LOGIN=192.168.1.x / FAILED_LOGIN=10.0.0.x,
     10·20일 전 spike 22% 실패율) + 관리자·시스템 ~25(log-only)
   → 리뷰 ~1,850건(published 336개 상품 × 3~8) + 상품 평점 집계 재계산
   → 문의 13건(미답변8/답변5/비밀2, PII 마스킹 시연용 2건 포함)
   ※ 실행 후 process.exit(0) — 서버로 남지 않음. 끝나면 서버 다시 기동

5) settlements는 재현 불가(즉시) — 매시 cron autoCompleteOrders가 DELIVERED 7일 경과
   주문을 구매확정시키며 order.completed 이벤트로 자연 생성됨. 며칠 띄워두면 생긴다.
```

### 순서를 바꾸면 안 되는 이유
- ② 상품 시드의 `TRUNCATE products CASCADE`가 reviews/inquiries/cart_items/wish_list_items/product_summaries까지 같이 비운다. **④ 뒤에 돌리면 리뷰·문의 전멸.** (order_items.product_id는 FK 없는 컬럼이라 dangling으로 남음)
- ④는 roles 없으면 throw, published 상품 풀이 비면 `productId=999999` 합성값으로 오염된다.

---

## 2. 재현하지 않기로 한 것 (결정 기록)

| 데이터 | prod 행 수 | 처리 |
|---|---:|---|
| 본인 계정(kirianir@naver.com) | 1 | 직접 재가입 |
| payments | 17 | 버림 — 본인 테스트 결제, PortOne 재결제로 언제든 생성 가능 |
| refresh_tokens / carts | 45 / 1 | 버림 — 세션 잔재 |
| audit_logs 중 실 트래픽 | ~200 | 버림 — IP 분포는 `ex-db-migration-before-capture.md`에 캡처 완료 |
| settlements | 104 | cron 파생 — §1-5) 참고, 시간이 재현 |

---

## 3. 검증 체크리스트 (재현 직후 기대값)

| 테이블 | 기대값 | 비고 |
|---|---|---|
| roles / categories | 3 / 27 | 정확값 |
| products / product_images | 349 / 1,047 | 정확값 |
| users / user_roles / sellers | 26 / 26 / 5 | 본인 재가입 시 27/27 |
| orders | 155~620 (평균 ~390) | 난수 범위 |
| order_items | 주문수 × 1~2 | |
| audit_logs | ~2,600 | |
| reviews | ~1,850 (336상품 전부 ≥3건) | |
| inquiries | 13 정확값 | |
| settlements / shipments / payments | 0 | 정상 — 파생/실사용 데이터 |

앱 화면 검증: 관리자 대시보드 차트(31일 분포 덕에 1개월 필터와 정합), 보안 차트 spike 2개(10·20일 전), 상품 상세 리뷰·평점, 문의 목록.

---

## 4. 알아둘 함정 (시드 분석에서 발견)

1. ~~`POST /v1/products/seed` 가드가 주석 상태~~ → **2026-08-18 해소**: admin 가드 복구(401 실측) + 운영 부트스트랩은 배치 경로(`SEED_PRODUCTS=true`)로 대체.
2. ~~`.env.example`에 `DEMO_ADMIN_*` 항목 누락~~ → **2026-08-18 해소**: `DEMO_ADMIN_*`/`DEMO_LOGIN_ENABLED` 추가(`LLM_*` 3종은 이미 있었음).
3. **리뷰·문의는 날짜 분포가 없다** — 전량 실행 시각에 몰림. 기간 필터 화면에서는 하루에 뭉쳐 보임(추후 기간 분포 설계는 별도 과제 — 사용자 인지).
4. **주문·보안 로그는 시간이 지나면 필터 창 밖으로 밀린다** — 시연/캡처 직전 `nx run backend:seed:reset`으로 오늘 기준 재기준화가 정석(과거 사례: ex-audit-log-admin.md).
5. 대시보드 시드의 멱등 게이트는 audit 마커 하나 — 부분 재실행 불가, 재실행은 `SEED_RESET=true`로 전체 리셋 후.
