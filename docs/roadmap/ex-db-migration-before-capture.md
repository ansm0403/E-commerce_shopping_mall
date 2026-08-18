# DB 리셋 전 실측 캡처 (before 데이터)

> 캡처 일시: **2026-08-17**, EC2(43.201.118.88) 운영 DB에서 SSH로 직접 실측.
> 용도: ① 리셋 판정 근거(행 수 인벤토리) ② nginx 문서 v2의 "before 데이터"(IP 분포 — 리셋하면 사라짐).
> 본 문서는 `ex-db-migration.md` 안전장치 ①·§5-1의 산출물이다.

---

## 1. 테이블별 행 수 인벤토리 (21개 테이블, DB 총 11MB)

| 테이블 | 행 수 | 판정 |
|---|---:|---|
| audit_logs | 2,495 | 대부분 시드산(가짜 IP) + 본인 활동. §2에 분포 캡처 완료 |
| product_images | 1,047 | 상품 시드 부속 |
| order_items | 677 | 시드 주문 부속 |
| orders | 446 | 대시보드 시드(4/3~6/12 분포) |
| products | 349 | 상품 시드(`backend/src/data/*.ts` 원본 보유) |
| settlements | 104 | 시드 파생 |
| refresh_tokens | 45 | 세션 잔재 — 가치 없음 |
| categories | 27 | 부팅 시드가 재생성 |
| user_roles | 27 | 〃 |
| **users** | **27** | **전원 시드/본인 계정 — 외부 실사용자 0명 (§3)** |
| payments | 17 | 본인 테스트 결제 |
| sellers | 5 | 시드 셀러 |
| roles | 3 | 부팅 시드가 재생성 |
| carts | 1 | 잔재 |
| cart_items, inquiries, product_tags, reviews, shipments, tags, wish_list_items | 0 | 비어 있음 |

### users 27명 전수 (지인/채용담당자 가입 여부 판정)

- `id=5` kirianir@naver.com (안상문 본인, 4/24 가입)
- `id=6` demo-admin@portfolio.local (데모 관리자, 5/4)
- `id=7~26` user1~20@seed.com (시드유저, 5/4)
- `id=27~31` seller1~5@seed.com (시드셀러, 5/4)

→ **외부인이 실제 가입한 계정 없음. 살릴 데이터 없음 판정의 실측 근거.**

---

## 2. audit_logs IP 분포 (nginx 문서 v2 "before 데이터")

- 기간: 2026-04-02 15:31 ~ 2026-08-16 18:49, 총 **2,495건**
- 구성: 시드산 가짜 IP(`192.168.1.x` LOGIN 계열, `10.0.0.x` FAILED_LOGIN 계열)가 대부분 + `system`(크론) 30건 + 실 트래픽 소량

### 2-1. IP별 상위 (LIMIT 15)

| ipAddress | count | 성격 |
|---|---:|---|
| system | 30 | 크론(CRON_ORDER_AUTO_COMPLETED 등) |
| 112.163.229.139 | 30 | **본인 실제 공인 IP** — 경로 A(XFF 수동 파싱) 통과 |
| 192.168.1.219 외 다수 | 10~16씩 | 시드 가짜 IP |

### 2-2. 실 트래픽(사설 IP·system 제외) 핵심 패턴 — trust proxy 부재의 증거

| action | ipAddress | count | 기간 | 해석 |
|---|---|---:|---|---|
| ORDER_CREATED | 112.163.229.139 | 19 | 4/28~6/12 | **경로 A**(`@Auditable`+인터셉터가 XFF 직접 파싱) → 진짜 클라 IP가 남음 |
| PAYMENT_VERIFIED | 112.163.229.139 | 6 | 5/3~6/12 | 〃 |
| ORDER_CANCELLED | 112.163.229.139 | 5 | 4/28~5/3 | 〃 |
| LOGIN / LOGOUT / TOKEN_REFRESH / REGISTER / FAILED_LOGIN | `::ffff:` + AWS IP 40여 종 각 1~3건 | ≈50 | 4/23~8/16 | **경로 B**(`@Ip()`→`request.ip`) → **Vercel 서버 IP가 기록됨.** 같은 사람(본인)의 접속인데 매번 다른 AWS egress IP |

관측된 경로 B IP 예: `::ffff:43.201.37.153`(REGISTER 3), `::ffff:35.175.113.31`, `::ffff:13.216.3.6`, `::ffff:54.162.123.54`, `::ffff:54.80.118.15`(8/16), `::ffff:15.168.166.14`(8/16), `::ffff:3.85.112.122`(8/16) 등 — 3.x/13.x/15.x/18.x/32.x/34.x/35.x/43.x/44.x/52.x/54.x/98.x/100.x/107.x/184.x 대역에 광범위 분산.

> **결론(문서용 한 줄)**: 동일 사용자 접속이 인증 계열에서는 40여 개의 서로 다른 Vercel/AWS IP로,
> 주문 계열에서는 진짜 클라 IP 하나로 기록됐다 — trust proxy 부재 + 경로 이원화의 실측 증거.
> 로그인 레이트리밋 키(`login:${ip}`)가 매 요청 다른 IP를 받아 사실상 무력화되어 있었음도 함께 시사.

---

## 3. 부수 실측 (같은 날 확인)

- **EC2 배포 디렉터리**: `~/Shopping-mall` (문서의 `~/shopping_mall`과 대소문자·하이픈 다름 — 주의)
- **docker 명령**: EC2는 `docker compose`(v2, v5.1.2)만 존재. `docker-compose`(v1) 없음. 로컬(Windows)은 두 형태 모두 v5.1.1로 동작
- **EBS**: `nvme1n1` 5GB가 `/mnt/postgres-data`에 마운트 — 문서 기술과 일치(마운트 포인트가 `/mnt`가 아니라 한 단계 아래)
- **루트 디스크**: 19GB 중 8GB 여유 — DB 11MB 백업엔 충분
- **EC2 `.env`**: `LLM_PROVIDER`/`GEMINI_API_KEY`/`GEMINI_MODEL` **부재 확인**(신규 3종 필요 — 진단 일치). `POSTGRES_*`·`JWT_*` 키가 파일 내 중복 선언돼 있음(정리 대상)
- 컨테이너: backend "Up 2 months"(6월 이미지), postgres/redis "Up 3 months" — 진단과 일치
