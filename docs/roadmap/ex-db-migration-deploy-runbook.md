# EC2 DB 리셋 + 마이그레이션 배포 런북 (계획 4단계)

> **이 문서는 복붙 런북이다.** 위에서 아래로 순서대로 실행한다. 순서를 바꾸면 안 된다.
> 각 단계에 **[이게 보이면 정상]** 과 **[멈춰야 하는 신호]** 를 적어뒀다.
> 멈춰야 하는 신호가 보이면 **다음 단계로 넘어가지 말고** §9 트러블슈팅을 본다.
>
> 예상 소요: 1~1.5시간 (이미지 빌드 ~20분이 가장 김)
> 로컬 리허설: 2026-08-18 동일 순서로 완주·검증됨 (`ex-db-migration.md` §4-0)

---

## 0. 사전 조건 (하나라도 아니면 시작하지 말 것)

| # | 확인 | 방법 |
|---|---|---|
| 1 | **백업 존재** — EC2와 로컬 이중 보관 | 로컬: `ls ~/Desktop/fullstack/db-backups/20260817/` → 4개 파일. EC2: §2에서 재확인 |
| 2 | **이 트랙의 코드 변경분이 커밋돼 있다** | `git status` 에서 backend/·Dockerfile 변경이 안 보여야 함(PR_DRAFT.md, eval results 중간본 등 의도적 미커밋 문서는 남아 있어도 됨). 이미지는 커밋이 아니라 현재 파일로 빌드되지만, "어느 코드가 배포됐나"를 :sha 태그로 증명하려면 코드 커밋 후 빌드가 원칙 |
| 3 | 로컬 리허설 완료 | 이미 완료(2026-08-18) |
| 3-1 | **이 트랙 코드가 main 에 머지됨** | PR **#30**(`feat/db-migration`) 머지 → `git checkout main && git pull`. §1 의 GIT_SHA 는 **그때의 main tip**(스쿼시 커밋)이다. 커밋을 로컬에만 두고 빌드하면 "배포된 코드가 어디에도 없는" 상태가 되므로 머지를 먼저 한다 |
| 4 | Docker Desktop 실행 중 + `docker login` 된 상태 | `docker info --format "{{.Username}}"` → 사용자명이 나오면 OK, 빈 값이면 `docker login` |

> 💡 **용어 한 줄**: 아래에서 "배치"란 서버를 상시로 띄우는 게 아니라,
> `node dist/main.js` 를 환경변수(NODE_SEED 등)와 함께 **한 번 실행하고 스스로 종료**하는 방식이다.

---

## 1. [로컬] 이미지 빌드 + 태그 2종 + 푸시

**Git Bash 에서** (PowerShell 아님 — `$(...)` 문법 때문):

```bash
cd ~/Desktop/fullstack/shopping_mall

# PR #30 머지분을 받아온 뒤 그 커밋으로 빌드한다 (⚠ 스쿼시 머지라 해시가 새로 생긴다)
git checkout main && git pull

# 커밋 해시를 태그와 버전 주입에 사용
GIT_SHA=$(git rev-parse --short HEAD)
echo $GIT_SHA   # 예: 11027d8 — 아래에서 이 값이 계속 쓰인다

# 빌드 (⚠ 20분 내외. --build-arg 가 /v1/health 의 version 이 된다)
docker build \
  --build-arg GIT_SHA=$GIT_SHA \
  -t ansmoon/shopping-mall-backend:latest \
  -t ansmoon/shopping-mall-backend:$GIT_SHA \
  .

# 푸시 (같은 이미지에 이름표 2개 — :latest 사고 재발 방지용 :sha 병행)
docker push ansmoon/shopping-mall-backend:latest
docker push ansmoon/shopping-mall-backend:$GIT_SHA
```

- **[정상]** 빌드 끝에 `naming to docker.io/ansmoon/shopping-mall-backend:...`, 푸시 끝에 `latest: digest: sha256:...`
- **[멈춤]** 빌드 에러(대부분 TS 컴파일 에러) → 로컬에서 `yarn nx build backend` 로 재현해 고친 뒤 처음부터
- 💡 `:latest` 와 `:$GIT_SHA` 는 **같은 이미지**다. 태그가 두 개일 뿐. 이제 Docker Hub 에서 "이 latest 가 어느 커밋인지" 눈으로 확인할 수 있다 — 8/11 사고(재푸시 없이 pull → 6월 이미지 그대로)의 재발 방지 장치.

---

## 2. [EC2] 접속 + 사전 점검

```bash
ssh -i ~/.ssh/shoppingApp-key.pem ubuntu@43.201.118.88
cd ~/Shopping-mall        # ⚠ 대문자 S, 하이픈. (~/shopping_mall 아님)

# 현재 상태 스냅샷 (문제 시 비교 기준)
docker compose -f docker-compose.prod.yaml ps
curl -s localhost:4000/v1/health ; echo

# 백업 재확인 (안전장치 ② — 이게 없으면 여기서 중단)
ls -la ~/db-backup-20260817/
```

- **[정상]** 컨테이너 3개 `Up (healthy)` / health 는 `version` **없이** `{status,timestamp}` (아직 구 이미지니까) / 백업 4개 파일(sql 766KB 등)
- **[멈춤]** 백업 디렉터리가 비어 있다 → **진행 금지**, 백업부터 다시

---

## 3. [EC2] .env 에 신규 환경변수 3종 추가

```bash
nano .env
```

파일 끝에 추가 (`GEMINI_API_KEY` 는 본인 키 — 로컬 `backend/.env` 에 있는 값을 복사):

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=<본인 키>
GEMINI_MODEL=gemini-3.1-flash-lite
```

저장: `Ctrl+O` → Enter → `Ctrl+X`

```bash
# 확인: LLM 3줄 + DEMO_ADMIN 2줄이 나와야 한다
grep -E '^(LLM_|GEMINI_|DEMO_ADMIN_)' .env
```

- **[정상]** `LLM_PROVIDER` `GEMINI_API_KEY` `GEMINI_MODEL` + `DEMO_ADMIN_EMAIL` `DEMO_ADMIN_PASSWORD` 가 보인다
- 💡 키를 못 찾겠으면 `GEMINI_API_KEY=` 로 비워둬도 된다 — AI 어시스턴트만 조용히 꺼지고(no-op) 서버는 정상. 단 `DEMO_ADMIN_*` 이 없으면 **중단** — 시드가 조용히 불완전해진다(로컬 `backend/.env` 값을 옮겨 넣을 것)

---

## 4. [EC2] 백엔드 정지 + DB 리셋 ⚠ 비가역 지점

> 여기부터 사이트가 잠시 내려간다. 그리고 **이 단계는 되돌릴 수 없다**(백업으로만 복구 가능).
> §0-1, §2 에서 백업을 두 번 확인했다. 그래도 심호흡 한 번 하고 진행.

```bash
# 백엔드만 정지 (postgres/redis 는 계속 돈다)
docker compose -f docker-compose.prod.yaml stop backend

# DB 리셋 — 데이터베이스 안의 모든 객체 삭제 (로컬 리허설과 동일 방식)
docker compose -f docker-compose.prod.yaml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE;" -c "CREATE SCHEMA public;"'

# Redis 도 비운다 (옛 세션/레이트리밋 잔재 제거 — 유저가 전부 사라졌으니 토큰도 무효)
docker compose -f docker-compose.prod.yaml exec -T redis redis-cli FLUSHALL
```

- **[정상]** `DROP SCHEMA` 출력에 `drop cascades to ...` 수십 줄 → `CREATE SCHEMA` / redis 는 `OK`
- **[멈춤]** `ERROR: database ... does not exist` 류 → .env 의 POSTGRES_* 값 확인

---

## 5. [EC2] 새 이미지 pull + 마이그레이션 실행

```bash
# 새 이미지 받기
docker compose -f docker-compose.prod.yaml pull backend

# 마이그레이션 실행 — 일회성 컨테이너(run --rm)로. exec 가 아닌 이유:
# migrate.js 는 "새 이미지 안"에 있는데, 기존 컨테이너는 구 이미지로 만들어졌기 때문.
docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js

# 검증 (변경 없음, 상태만 출력)
docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js check
```

- **[정상]** run: `Migration Init1786978325132 has been executed successfully.` + `✓ 1건 적용` / check: `✓ 모든 마이그레이션 적용됨`
- **[멈춤]** 에러로 끝나면 → §9-A. **백엔드가 stop 상태라 사이트는 어차피 내려가 있다. 서두르지 말 것**

---

## 6. [EC2] 백엔드 기동 + 부팅 시드 + 버전 단언

```bash
docker compose -f docker-compose.prod.yaml up -d

# 헬스체크가 healthy 될 때까지 ~30초 기다렸다가:
docker compose -f docker-compose.prod.yaml ps
curl -s localhost:4000/v1/health ; echo
```

- **[정상]** health 에 **`"version":"<§1의 GIT_SHA>"`** 가 보인다 — 이 한 줄이 "새 이미지가 진짜 배포됐다"의 증명이다
- **[멈춤]** version 이 없거나 다른 값 → 구 이미지가 돌고 있다. `docker compose -f docker-compose.prod.yaml pull backend` 재실행 후 `up -d` 다시

```bash
# 부팅 시드(roles/categories) 자동 실행 확인
docker compose -f docker-compose.prod.yaml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT (SELECT count(*) FROM roles) roles, (SELECT count(*) FROM categories) categories;"'
```

- **[정상]** `roles=3, categories=27`

---

## 7. [EC2] 시드 배치 (상품 + 유저 + 주문 + 로그 + 리뷰 + 문의, 원커맨드)

```bash
docker compose -f docker-compose.prod.yaml run --rm \
  -e NODE_SEED=true -e SEED_PRODUCTS=true -e SEED_DAYS=30 \
  backend node backend/dist/main.js
```

약 1~2분. 이 순서로 출력되면 정상:

```
🌱  Dashboard Seed 시작 (days=30, reset=false)
  ✓ 데모 관리자 생성 완료: demo-admin@portfolio.local
  ✓ 총 349개 상품 시드 완료 (뷰티:50, 의류:50, 신발:49, 도서:100, 식품:50, 생활:50)
  ✓ 사용자 20명, 셀러 5명
  ✓ 주문 N건 (31일치)          ← N 은 155~620 사이 난수
  ✓ 보안 audit_logs N건 (31일치)
  ✓ 관리자행위·시스템오류 audit_logs N건
  ✓ 커버리지 리뷰 N건 (상품 336개) + 집계 재계산
  ✓ 문의 13건 (미답변 8 / 답변완료 5 / 비밀 2)
✅  Seed 완료!
```

- **[멈춤]** `데모 관리자 생성 완료` 대신 `⚠ DEMO_ADMIN_EMAIL ... 미설정 — 스킵` → §3 이 안 됐다. .env 고치고 이 단계만 재실행(이미 시드됐다며 스킵하면 `-e SEED_RESET=true` 를 추가해 재실행)
- 💡 상시 서버(§6에서 띄운 것)는 그대로 두고 실행해도 된다 — run --rm 은 포트를 열지 않고 DB 만 공유한다

---

## 8. 최종 검증

**8-1. DB 카운트** (EC2):

```bash
docker compose -f docker-compose.prod.yaml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT (SELECT count(*) FROM products) products,
       (SELECT count(*) FROM users) users,
       (SELECT count(*) FROM orders) orders,
       (SELECT count(*) FROM reviews) reviews,
       (SELECT count(*) FROM inquiries) inquiries,
       (SELECT count(*) FROM order_items WHERE product_id=999999) must_be_zero;"'
```

- **[정상]** products **349** / users **26** / orders 155~620 / reviews ~1,850 / inquiries **13** / must_be_zero **0**

**8-2. 실제 사이트** (브라우저):

| 확인 | 기대 |
|---|---|
| 상점 목록 | 상품이 이미지와 함께 뜬다 |
| 데모 계정 로그인 | 성공 → 관리자 대시보드 차트가 최근 31일 데이터로 그려짐 |
| 상품 상세 | 리뷰·평점 보임 |
| 관리자 감사 로그 | 로그인/실패 로그 분포 보임 |

**8-3. 프론트 배포 — 이번엔 할 일이 없다 (확인만)**

> 🔴 **정정**: 최초 진단의 "main/Vercel 이 07-27 에 멈춰 3주 뒤처짐"은 **오진이었다**
> (`git fetch` 없이 낡은 `origin/main` ref 를 읽음). PR **#29** 가 **07-28 21:12 에 정상 머지**돼
> 프론트는 그때부터 최신이었다. 이 트랙 커밋도 **프론트 변경이 0**이므로, PR #30 머지 시점에
> Vercel 이 같은 프론트를 재빌드할 뿐 사이트 동작은 변하지 않는다.

- 확인: Vercel 대시보드에서 PR #30 머지 후 배포가 **Ready** 인지만 본다.
- 실제 상황은 오히려 그 역이었다 — **07-28 프론트가 06-14 백엔드를 상대로 3주간 돌아**
  셀러 상품/주문/정산 화면이 운영에서 깨져 있었을 것이다. §1~§7 이 그것을 해소하는 작업이다.

> ⚠ **알려진 한계(이번 작업과 무관, 기존 문서화된 사항)**: 셀러 상품 이미지 업로드는 diskStorage 라
> 컨테이너 내부(/app/uploads)에 저장된다 → **컨테이너 재생성 시 유실**. 시드 상품 이미지는 외부 URL 이라 무관.
> 운영에서 셀러 업로드를 실사용하기 전에 볼륨 마운트/S3 전환 필요(별도 과제).

끝. 🎉 완료 후 상태를 `ex-db-migration.md` §4-0 에 기록할 것.

---

## 9. 트러블슈팅

**A. §5 마이그레이션 실패**
- 에러 전문을 읽는다. 대부분 접속 문제(`ECONNREFUSED` → postgres 컨테이너 상태 확인, `password authentication failed` → .env)
- 마이그레이션이 절반 적용된 경우: TypeORM 이 트랜잭션으로 감싸므로 **전부 롤백**돼 있다. 원인 고치고 같은 명령 재실행
- 원인 불명이면: 사이트는 어차피 내려가 있으니 **그 상태로 두고** 로그를 가져와 상의(강행 금지)

**B. §6 에서 backend 가 unhealthy / 재시작 반복**
```bash
docker compose -f docker-compose.prod.yaml logs --tail=50 backend
```
- `FRONTEND_URL environment variable is required` → .env 손상. §3 편집 중 실수 여부 확인
- DB 접속 에러 → postgres 상태(`ps`) 확인

**C. 완전 복구 (모든 것을 되돌리고 싶다)**
```bash
# 리셋 직전 상태(구 스키마 + 구 데이터)로 복원
docker compose -f docker-compose.prod.yaml stop backend
docker compose -f docker-compose.prod.yaml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE;" -c "CREATE SCHEMA public;"'
docker compose -f docker-compose.prod.yaml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < ~/db-backup-20260817/shopping_mall_full_20260817.sql
docker compose -f docker-compose.prod.yaml up -d
# 참고: 구 이미지 코드로의 롤백은 사실상 무의미(2개월 전 코드) — 복구는 "데이터"만, 코드는 전진(fix-forward)이 원칙
```

**D. 자주 하는 실수**
| 증상 | 원인 |
|---|---|
| `no such service: backend` | `-f docker-compose.prod.yaml` 빠뜨림 |
| `docker-compose: command not found` | EC2 는 `docker compose`(공백) 만 있다 |
| health 에 version 이 안 보임 | pull 안 된 구 이미지. §6 [멈춤] 참조 |
| 시드가 "이미 있다"며 스킵 | 정상 멱등 동작. 갈아엎으려면 `-e SEED_RESET=true` 추가 |
