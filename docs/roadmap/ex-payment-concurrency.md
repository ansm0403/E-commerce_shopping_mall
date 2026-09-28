# 결제 동시성 — 재현 테스트와 운영 측정 (ex- 트랙, 2026-09-29)

> verify(브라우저)와 PortOne 웹훅이 같은 결제 건을 동시에 갱신하는 경합을 **코드로 재현**하고 **운영에서 측정**해, 이력서·면접에서 "그럴 수 있어서 막았다"가 아니라 "재현 → 방어 → 관측"으로 말할 수 있게 만든다.
> 방어 코드 자체는 2026-03-30 `8b1dc14` 그대로다(변경 없음). 이 문서는 그 코드가 실제로 무엇을 막는지 **증거를 붙이는** 작업이다.

---

## 0. 한 줄 결론

- 통합 테스트 3건(진짜 Postgres, PortOne 만 mock) 통과. **동시 호출 30라운드에서 먼저 전이시킨 쪽은 verify 27 · 웹훅 3** — 같은 프로세스 안에서도 승자가 갈린다. 매 라운드 `order.paid` 는 정확히 1회.
- 락을 기다리던 웹훅이 만료된 주문을 만나면 PAID 로 덮지 않고 **자동 환불 분기**로 빠지는 것을 결정적으로 재현했다(락 **후** 재검증의 존재 이유).
- **운영 측정(2026-09-29, 테스트 결제 7건, nginx 밀리초 로그)**: **7/7 웹훅이 verify 보다 먼저 도착**(44~69ms, 평균 56ms), **7/7 웹훅이 PAID 로 전이**시켰고, verify 는 7건 모두 웹훅 처리(103~133ms)가 끝나기 전에 도착해 **락 대기 경로**를 탔다(사전 검사에서 PAID 를 본 로그 0건). 전 건 주문 단일 상태. 기존 "24ms" 는 감사 로그 기준 **처리 완료** 시각 차였고(§1), 이번 측정으로 도착 순서까지 확인했다(§3-4).
- 웹훅이 구조적으로 먼저 오는 이유도 로그에 있다: verify 는 브라우저 → **Vercel 프록시**(발신 IP 가 Vercel 의 AWS 서울 대역) → nginx 로 한 홉을 더 거치고, 웹훅은 PortOne 서버 → nginx 직행이다. 그리고 PortOne 은 결제 한 건에 웹훅을 **두 번** 보낸다 — 결제창이 열릴 때 `Transaction.Ready`(주문 생성 0.34~0.43초 뒤, 코드는 스킵) + 완료 때 `Transaction.Paid`.

## 1. 먼저 바로잡은 사실 두 가지

| 기존 표현 | 사실 | 근거 |
|---|---|---|
| "회귀 방지 테스트 +118줄 추가" | **결제 동시성 자동 테스트는 없었다.** 같은 날 커밋 `f6a4b3d`·`891102e` 는 메시지만 "유령결제"고 내용은 `product.service.ts` 엣지케이스 + `product.service.spec.ts`(+118줄) | `git show --stat f6a4b3d 891102e` |
| "웹훅이 verify 보다 24ms 먼저 **도착**" | 감사 로그 `PAYMENT_WEBHOOK`·`PAYMENT_VERIFIED` 두 행의 `createdAt` 차. `AuditInterceptor` 는 핸들러가 끝난 뒤 `tap()` 에서 저장하고 `@CreateDateColumn` 이라 **처리 완료 시각**이다. 도착 순서는 이 두 값으로 단정할 수 없다 | `audit/interceptors/audit.interceptor.ts:70-84`, 감사 로그 원본 타임스탬프는 저장소에 없음 |

"유령 결제"의 뜻도 고정한다: 이 저장소에서는 처음부터 **결제 완료(verify·웹훅)와 취소가 같은 결제 건을 동시에 건드려 상태가 어긋나는 것**을 가리킨다(코드 주석 "[왜 이렇게 짰나 — 유령 결제 방지]"). "주문 없이 결제창이 열리는 경로"는 이 프로젝트에 없던 문제다 — 결제 페이지는 주문 생성 응답을 받은 뒤에만 결제창을 연다(설계 순서, 버그 수정 이력 아님).

## 2. 재현 테스트 — `backend/src/payment/payment.concurrency.integration.spec.ts`

### 2-1. 왜 이 형태인가

| 후보 | 못 쓰는 이유 |
|---|---|
| repository mock 단위 테스트 | 락은 DB 가 거는 것. mock 은 `FOR UPDATE` 를 흉내 못 낸다 |
| HTTP e2e(떠 있는 서버) | verify 가 PortOne 에 실결제를 재조회한다 → 결제 건이 실제로 있어야 함 |
| **서비스 계층 통합(채택)** | 진짜 Postgres + 실물 `PaymentService`. PortOne 호출 2개(`getPaymentFromPortOne`·`cancelPaymentOnPortOne`)만 `jest.spyOn` 으로 mock. 트랜잭션·락·이벤트 발행은 실물 |

승자 판별 장치: verify 와 웹훅에 **서로 다른 `transactionId`** 를 넘긴다. 최종 행의 `transactionId` 가 곧 "누가 PAID 로 바꿨나"다.

### 2-2. 고정하는 것 3건

| # | 시나리오 | 단언 | 결과(2026-09-29) |
|---|---|---|---|
| 1 | `verifyPayment` ∥ `handleWebhook` 을 `Promise.all` 로 N 라운드 | 둘 다 예외 없음 · 결제/주문 PAID · **`order.paid` 정확히 1회** · 라운드마다 정확히 한 쪽만 씀 | 10라운드 verify 9 / webhook 1 · **30라운드 verify 27 / webhook 3** · 이벤트 = 라운드 수 |
| 2 | 다른 트랜잭션이 결제 행을 `FOR UPDATE` 로 잡은 사이 웹훅 도착 → 잠근 쪽이 `failed/cancelled` 로 바꾸고 commit | 웹훅이 `'refunded - order expired'` 반환 · `cancelPaymentOnPortOne` 1회 · 결제는 FAILED 그대로(PAID 로 덮이지 않음) · 이벤트 0 | 통과 — 락 대기 300ms 뒤 만료 감지 |
| 3 | 같은 verify 두 번 | 두 번째는 PortOne 재조회 0회 · `transactionId` 첫 값 유지 · 이벤트 1회 | 통과 |

`order.paid` 1회가 핵심인 이유: 이 이벤트의 리스너가 재고 차감과 Shipment 생성을 한다. 2회 = 재고 이중 차감 = 사용자가 보는 "유령 결제".

### 2-3. 실행

```bash
# 사전: docker-compose.local.yaml postgres(localhost:15432) + 테스트 DB
docker exec shopping_mall-postgres-1 psql -U sangmoon -d postgres -c "create database shopping_mall_test"
cd backend
node ../node_modules/jest/bin/jest.js -c jest.integration.config.js payment.concurrency
PAYMENT_RACE_ROUNDS=30 node ../node_modules/jest/bin/jest.js -c jest.integration.config.js payment.concurrency
```

`backend/jest.integration.config.js` 를 새로 두었다(ts-jest). 이유는 파일 머리 주석 — @swc/jest 는 엔티티 순환 import 에서 TDZ 로 죽고, `backend/node_modules` 에 @nestjs 사본이 한 벌 더 있어 `moduleNameMapper` 로 루트 사본에 고정해야 DI 가 붙는다. CI 의 `nx test backend` 는 통합 스펙을 제외하므로 영향 없음.

### 2-4. 이 테스트가 말하지 않는 것

- 락이 **없을 때** 실제로 깨지는 모습은 재현하지 않았다(코드에서 락을 빼고 돌려야 함). 2026-03 로컬 재현 스크립트도 남아 있지 않다. 면접에서는 "락 없이는 두 트랜잭션이 각자 READY 를 읽고 각자 PAID 로 써서 이벤트가 두 번 나간다"를 **설명**하되, "재현했다"는 표현은 이 테스트(락 있는 상태의 단일 전이·이벤트 1회)까지만.
- 승자 분포(27:3)는 로컬 프로세스의 스케줄링 결과다. 운영의 도착 순서와는 다른 이야기라 §3 을 따로 잰다.

## 3. 운영 측정 — 도착 순서를 nginx 에서 잰다

### 3-1. 왜 nginx 인가

| 시각 | 출처 | 상태 |
|---|---|---|
| 도착 | nginx 액세스 로그 | 기본 `combined` 는 초 단위 → **`timed` 포맷 추가**(`$msec`, `$request_time`) |
| 핸들러 시작 | 백엔드 로그 | 웹훅만 "수신" 로그가 있고 verify 는 없음 |
| 처리 완료 | 감사 로그 `createdAt` | 기존 24ms 의 출처 |

`nginx/default.conf` 에 `log_format timed …` 와 `access_log /var/log/nginx/access.log timed;`(443 server 블록)를 넣었다. `$msec` 은 로그를 쓰는 시각(응답 완료)이므로 **도착 ≈ `$msec` − `$request_time`**. 기록 위치는 그대로 stdout 이라 `docker compose logs nginx` 로 읽는다.

### 3-2. EC2 반영 (사용자 실행 — 이 세션은 원격 쓰기가 차단됨) — ✅ 2026-09-29 적용 완료(로그에 `msec=` 확인)

```bash
KEY=~/.ssh/shoppingApp-key-v2.pem; EC2=ubuntu@15.164.185.156
scp -i $KEY nginx/default.conf $EC2:~/Shopping-mall/nginx/default.conf
ssh -i $KEY $EC2 'cd ~/Shopping-mall \
  && cp nginx/conf.d/default.conf nginx/conf.d/default.conf.bak-$(date +%Y%m%d-%H%M%S) \
  && cp nginx/default.conf nginx/conf.d/default.conf \
  && docker compose -f docker-compose.prod.yaml exec nginx nginx -t \
  && docker compose -f docker-compose.prod.yaml exec nginx nginx -s reload \
  && curl -s -o /dev/null -w "health=%{http_code}\n" https://api.ansmoon.dev/v1/health \
  && docker compose -f docker-compose.prod.yaml logs --no-log-prefix --tail 2 nginx'
```

`nginx -t` 가 실패하면 reload 되지 않는다. 그때는 백업본을 `conf.d/default.conf` 로 되돌린다. 성공 확인 = 마지막 로그 두 줄에 `msec=` 이 보인다.

### 3-3. 테스트 결제와 로그 수집

1. 쇼핑몰 웹에서 **테스트 결제 3~5건**(지난번과 같은 테스트 채널, 실과금 없음). 건마다 주문번호를 적어 둔다.
2. 로그 추출:
   ```bash
   ssh -i $KEY $EC2 'cd ~/Shopping-mall && docker compose -f docker-compose.prod.yaml logs --no-log-prefix nginx \
     | grep -E "POST /v1/payments/(verify|webhook)"'
   ```
   웹훅은 발신 IP `52.78.5.241`, verify 는 본인 IP. 본문이 없어 주문번호는 안 보이므로 시간 창으로 짝짓는다.
3. 같은 건의 감사 로그 두 행(`GET /admin/audit-logs?action=PAYMENT_WEBHOOK` / `PAYMENT_VERIFIED`)의 `createdAt` 으로 완료 순서도 적는다.
4. 누가 PAID 로 바꿨는지는 백엔드 로그로 판별: `"중복 결제 검증 요청"`(웹훅 선행) 또는 `"이미 처리됨 (verifyPayment 선행)"`.

### 3-4. 결과 (2026-09-28 16:44 ~ 17:11 UTC, 테스트 채널 결제 7건)

출처: nginx `timed` 로그(도착 = `msec − rt`, 완료 = `msec`), 백엔드 로그(`-t`, 누가 전이시켰나), 감사 로그 API(`createdAt`, 마지막 3건). 시각은 UTC, 초 이하는 ms.

| 건 | paymentId(뒷 8자) | 웹훅(Paid) 도착 | verify 도착 | **도착 차** | 웹훅 처리 시간 | 웹훅 완료 | verify 완료 | 완료 차 | 감사 로그 완료 차 | PAID 로 전이시킨 쪽 | verify 가 탄 경로 | 최종 주문 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | TGQIHNQX | 16:45:12.751 | .808 | **+57** | 133 | .884 | .940 | 56 | — | 웹훅 | 락 대기 | 단일 |
| 2 | HPDIHQDD | 16:45:57.158 | .202 | **+44** | 103 | .261 | .304 | 43 | — | 웹훅 | 락 대기 | 단일 |
| 3 | IQOMHPCX | 16:46:30.507 | .555 | **+48** | 103 | .610 | .734 | 124 | — | 웹훅 | 락 대기 | 단일 |
| 4 | 3OGW1O5I | 16:49:25.461 | .527 | **+66** | 110 | .571 | .630 | 59 | — | 웹훅 | 락 대기 | 단일 |
| 5 | S0DJ511L | 17:08:54.826 | .885 | **+59** | 119 | .945 | .992 | 47 | 32 | 웹훅 | 락 대기 | 단일 |
| 6 | D8JN7UF2 | 17:10:23.691 | .760 | **+69** | 125 | .816 | .863 | 47 | 28 | 웹훅 | 락 대기 | 단일 |
| 7 | Y0CJJD69 | 17:11:38.591 | .639 | **+48** | 116 | .707 | .762 | 55 | 34 | 웹훅 | 락 대기 | 단일 |

읽는 법과 해석:

- **도착 차 +44 ~ +69ms(평균 56ms), 7/7 웹훅 선착.** 웹훅 처리 시간(103~133ms)이 도착 차보다 길어 **7건 모두 verify 가 웹훅 처리 도중에 들어왔다** — 즉 매 건 실제로 락 경합이 있었다.
- **"락 대기" 판정 근거**: verify 의 사전 검사가 PAID 를 봤다면 `"중복 결제 검증 요청"` 로그가 남는데 7건 모두 없다. 백엔드 로그에는 웹훅 쪽 `"V2 웹훅: 결제 검증 완료"` 만 있다. 따라서 verify 는 READY 를 읽고 PortOne 재조회까지 한 뒤 `FOR UPDATE` 에서 기다렸다가 락 후 재검증에서 PAID 를 보고 조용히 종료했다(`updated = null`, 응답 201 + 결제 행). **락 후 재검증이 없었다면 7건 모두 PAID 를 두 번 쓰고 `order.paid` 를 두 번 발행했을 조건**이다.
- **감사 로그 완료 차(28~34ms)와 nginx 완료 차(47~55ms)가 다른 이유**: 감사 로그는 인터셉터가 핸들러 종료 후 DB 에 insert 한 시각이라 두 요청의 insert 지연이 다르게 섞인다. 지난 "24ms" 는 같은 종류의 숫자다. 도착 순서를 말할 때는 nginx 열을 쓴다.
- **웹훅이 항상 먼저인 구조적 이유**: verify 발신 IP 는 Vercel(AWS 서울) 이었다 — 브라우저 → Vercel rewrites → nginx 로 한 홉이 더 있다. 웹훅은 PortOne → nginx 직행. 테스트 환경 특성(같은 리전, 빠른 결제 승인)이라 실사용에서 비율이 같다고 일반화하지는 않는다.
- **결제 한 건당 웹훅 두 번**: `Transaction.Ready` 가 주문 생성 0.34~0.43초 뒤(결제창 열림)에 먼저 오고 코드는 "처리 스킵"으로 200 을 준다. 감사 로그의 `PAYMENT_WEBHOOK` 이 결제당 2행인 이유.

기록 규칙: IP 는 적지 않았다(발신 주체만). 7건 중 7건 선착으로 쓴다. 표본은 7건·테스트 채널이다.

## 4. 이력서 문장에 쓸 수 있는 것 (측정 전 기준)

- ✅ "verify 와 웹훅이 같은 검증·같은 `SELECT … FOR UPDATE` 를 공유하고, 락 후 재검증으로 만료 주문은 자동 환불로 빠진다 — **통합 테스트 30라운드에서 단일 전이·이벤트 1회, 승자는 27:3 으로 갈렸다**."
- ✅ "운영 테스트 결제 **7건 모두** 웹훅이 verify 보다 **44~69ms 먼저 도착**했고, 7건 모두 verify 가 웹훅 처리 중에 들어와 **락에서 대기 후 재검증으로 종료** — 전 건 주문 단일 상태(nginx 밀리초 로그 + 백엔드 로그 + 감사 로그 대조)."
- ✅ "웹훅이 먼저 오는 이유는 브라우저 경로가 Vercel 프록시를 한 홉 더 거치기 때문 — 즉 이 구조에서는 경합이 예외가 아니라 기본값이다."
- ❌ "회귀 테스트 118줄", "24ms 먼저 도착"(완료 시각 차였음), "Promise.all 스크립트로 재현했다"(미보존), "실사용에서도 항상 웹훅이 먼저"(테스트 채널 7건에서의 관찰)

프론트 층 서술(같은 사례 안에서): 결제창 금액은 서버가 저장한 주문 금액, `isProcessingRef` 로 주문 생성 → 결제창 → 검증 전 구간 잠금, verify 실패는 "결제 실패"로 단정하지 않고 주문 상세로 보내 서버 상태를 확인하게 하며, 완료 화면은 verify 응답이 아니라 주문 재조회로 그린다 — 웹훅이 먼저 처리해도 사용자에게 같은 화면이 나오는 이유.
