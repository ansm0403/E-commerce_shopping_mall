# 프론트 브라우저 E2E — 결제 동선을 Playwright 로 CI 에 (2026-10-16 착수)

작성일: 2026-10-16. **상태: 로컬 구현 완료 · 8건 중 6건 통과, 2건은 발견한 결함(§4 배송비 불일치)으로 빨간불 유지 · CI job 작성(미실행) · 미커밋.**

## 1. 왜

테스트 층이 둘뿐이었다 — 프론트 단위·RTL(Jest 24 스위트)과 백엔드 HTTP e2e(14 파일, CI `security-e2e`). 둘 다 "화면이 서버와 맞물려 도는지"는 보지 못한다: 금액 표시가 서버 주문과 같은가, 가드가 올바른 곳으로 보내는가, 결제 완료 페이지가 서버 상태를 맞게 판정하는가(PR #79 회귀가 바로 이 틈에서 났다). `scripts/buyer-flow/` 의 확인 스크립트 36개가 사실상 이 일을 하지만 사람이 손으로 돌리는 스크립트라 CI 에 없었다. 이 작업은 **그 스크립트를 테스트 러너(@playwright/test)로 승격해 매 PR 에 올리는 것**이다. 이력서 반영은 보류(사용자 결정 2026-10-16) — 비어 있던 칸(FE E2E ✗)을 채우는 작업으로만 본다.

## 2. 범위와 경계

| 본다 | 보지 않는다 |
|---|---|
| 로그인 폼 → 장바구니 → 주문서 → **결제하기 → `POST /orders` 201** 까지 | **PortOne 결제창** — CI 가 승인할 수 없다. 결제창으로 나가는 요청을 `page.route` 로 끊어 SDK 가 실패하게 두고, 화면이 실패를 "주문 상세로 보내 서버 상태를 확인하게" 다루는지까지 본다 |
| 결제 **뒤** 화면 — 결제된 주문을 DB 로 만들어(`simulatePaidOrder`, 리스너 결과물 재현) 완료 페이지 판정 | 실결제·웹훅·verify(백엔드 e2e·통합 테스트·운영 점검의 몫) |
| 가드: 비로그인 → `/login?redirect=…`(쿼리 보존), 빈 장바구니 → `/cart`, 새로고침 유지 | 판매자·관리자 콘솔(기존 스크립트 그대로) |

스펙 3 파일 8건(`frontend-e2e/tests/`): `auth-guard` 4 · `checkout-complete` 2 · `checkout` 2. 모든 거절·이동은 **URL 과 화면 문구**로, 금액은 **"결제 금액" 요약의 행 단위**로 단언한다(같은 금액 문자열이 헤더 장바구니 링크·상품 줄에도 나와 strict mode 에 걸렸다).

## 3. 구성

- `frontend-e2e/playwright.config.ts` — Nx 프로젝트가 **아니다**(package.json·project.json 없음 → `nx affected -t e2e` 가 security-e2e job 에서 이걸 집어 가지 않는다). 루트 `yarn e2e:frontend`. 직렬(worker 1 — 한 구매자 계정의 장바구니를 공유), 실패 시 trace·스크린샷·a11y 스냅샷.
- `support/api.ts` — **backend-e2e 의 하네스를 그대로 import**(`db.ts` 계정·상품·`simulatePaidOrder`, `commerce.ts` HTTP 준비, `login.ts` 429 흡수, `redis.ts` 레이트리밋 리셋). 준비는 HTTP·DB 로, 검증은 브라우저로.
- `support/global-setup.ts` — `e2e-fe-checkout-` 접두 구매자·승인 셀러·관리자 + 셀러가 등록하고 관리자가 승인한 상품 1개(19,900원 — 5만 원 미만이라 화면 배송비 3,000원 경우). 값은 `.state/fixtures.json` 으로 워커에 전달. teardown 이 전부 지운다.
- `support/browser.ts` — 폼 로그인(직전에 `resetLoginRateLimits` — 첫 실행에서 8번째 로그인부터 429 "너무 많은 로그인 시도"), dialog 자동 닫기.
- 전제: 백엔드 4000 + 프론트 **운영 빌드**(`NEXT_PUBLIC_API_URL=/api`, `API_PROXY_TARGET=http://localhost:4000/v1` — 운영과 같은 same-origin 프록시). webServer 가 `next start -p 3100` 을 띄운다(로컬에 떠 있으면 재사용).
- CI: `.github/workflows/ci.yml` `frontend-e2e` job — security-e2e 와 같은 서비스 컨테이너·마이그레이션·백엔드 기동·헬스 대기 + `npx next build`(Nx 캐시 우회 — build inputs 에 `NEXT_PUBLIC_API_URL` 이 없어 다른 값의 번들이 캐시로 돌아올 수 있다) + `playwright install --with-deps chromium` + 실행 + 리포트 업로드. `CORS_ORIGINS`·`FRONTEND_URL` 은 3100.

## 4. 첫 실행에서 발견한 것 — 화면 총 결제금액 ≠ 서버 주문 금액 (미결)

| | 주문서 화면 | 서버(`POST /orders` 응답 · 완료 페이지) |
|---|---|---|
| 상품 | 19,900원 | 19,900원 |
| 배송비 | **3,000원**(5만 원 미만) | 없음 — 백엔드에 배송비 개념이 없다(`order.service.ts` 는 항목 합계만, `grep shippingFee` 0건) |
| 총 결제금액 | **22,900원** | **19,900원** |

결제창에 넘기는 금액은 `order.totalAmount`(②의 프론트 층 규칙)이므로 **실제 청구는 19,900원** — 화면이 약속한 22,900원보다 적다. 완료 페이지는 19,900원을 보인다. 같은 "배송비 3,000원(50,000원 이상 무료)" 문구가 장바구니·주문서·상품 상세(`ProductInfo.tsx`·`ProductTabs.tsx`) 세 곳에 있다. 운영도 같은 코드다(이번 작업 전부터 있던 결함, E2E 가 처음 잡았다).

선택지: (a) **프론트가 서버가 청구하는 대로 보인다** — 배송비 줄을 "무료"로(세 화면), 가장 작고 정직하다. (b) 백엔드에 배송비를 둔다 — 주문·결제 금액·정산·데모 결제·PortOne 금액 대조까지 번지는 기능 작업. **결정 전까지 두 스펙(`checkout` 1 · `checkout-complete` 1)은 빨간불로 둔다**(깨진 상태를 먼저 기록 — 보안 트랙과 같은 원칙). 결정은 사용자.

## 5. 측정 (로컬, 2026-10-16, 운영 빌드 3100 + 백엔드 dist/main.js)

| 지표 | 값 |
|---|---|
| 스펙 | 3 파일 8건 — 통과 6 · 실패 2(§4) |
| 실행 시간 | 46~47초(webServer 기동 포함, 직렬) · 첫 실행은 로그인 429 로 2.2분 |
| 발견 | 배송비 불일치 1건(§4) · 하네스 함정 2건(§6 — 로그인 레이트리밋, CORS) |
| 추가 의존성 | `@playwright/test` 1.64.1(루트 devDependency), Chromium headless shell 118 MB |

CI job 시간은 첫 실행 뒤에 적는다.

## 6. 함정 (다음 사람을 위해)

- **same-origin 인데 CORS 500** — 브라우저는 same-origin 이어도 POST·PATCH 에 `Origin` 을 붙이고(GET 에는 안 붙인다), Next rewrites 가 그대로 백엔드에 넘긴다. 백엔드 `CORS_ORIGINS` 에 테스트 사이트(3100)가 없으면 **GET 은 되는데 쓰기만 `Not allowed by CORS` 500**. 로컬은 백엔드를 `CORS_ORIGINS=http://localhost:3000,http://localhost:3100` 으로 띄운다(CI env 에 넣어 뒀다).
- **브라우저 로그인도 IP 10회/5분** — 백엔드 e2e 는 `loginRaw` 가 429 를 흡수하지만 폼 로그인은 그대로 막힌다 → 직전에 `resetLoginRateLimits()`.
- **`yarn nx serve backend` 는 `backend/.env` 를 읽는다**(cwd 가 backend) — 이 PC 의 backend/.env 는 검색 평가용 DB(`search_probe`)를 가리켜 `password authentication failed`. 루트 `.env` 의 `POSTGRES_*` 를 환경 변수로 export 하고 `backend/dist/main.js` 를 직접 띄우면 된다(dotenv 는 기존 환경 변수를 덮지 않는다).
- `yarn nx serve backend | grep -m1 …` 처럼 파이프 뒤에서 먼저 끝나는 명령을 붙이면 **SIGPIPE 로 서버가 함께 죽는다** — 로그는 파일로.
- `yarn add` 는 손대지 않은 워크스페이스의 `package.json` 서식까지 다시 쓴다(`backend/package.json` 300줄 diff) — 내용 변화 없으면 `git checkout` 으로 되돌린다.
- Git Bash 는 인자 `/api` 를 `C:/Program Files/Git/api` 로 바꾼다 — 프론트 빌드는 PowerShell 에서.
- `next start` 는 `output: standalone` 설정에 경고를 내지만 페이지는 정상 서빙한다(standalone 서버로 바꾸면 static·public 복사가 필요해 보류).
- 2026-10-16 C 드라이브 100% — Docker Desktop 데이터 디스크 53 GB(빌드 캐시 20.9 GB + 옛 백엔드 이미지 14개). 정리 뒤 12 GB.

## 7. 남은 것

1. §4 결정 → 해당 쪽 수정 → 두 스펙 초록 확인(결정이 (a)면 `expectedTotal` 도 서버 규칙으로).
2. 커밋·PR(사용자 승인) → CI `frontend-e2e` 첫 실행 시간 기록 → `security-e2e` 와의 중복 스텝(서버 준비)을 합칠지 검토.
3. 완료 페이지 판정을 옛 코드(`status === 'paid'`)로 되돌려 `checkout-complete` 가 실제로 빨간불이 되는지 CI 로그로 확인(테스트가 잡는지).
4. 기존 `scripts/buyer-flow/` 가운데 결제 동선 스크립트(`verify-demo-checkout`·`reload-probe` 의 cart/checkout 부분)는 이 스위트가 대신하므로 README 에 표기.
