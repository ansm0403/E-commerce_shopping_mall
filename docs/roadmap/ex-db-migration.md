# DB 리셋 + TypeORM 마이그레이션 도입 (계획 외 삽입)

> **배경**: nginx(Phase 3) 설계 대화 도중, 배포 정합성 점검에서 **EC2 백엔드가 2개월 뒤처져 있음**을 발견.
> 응급 패치(pg_dump 복사) 대신 **DB를 비우고 마이그레이션 체계를 새로 도입**하기로 결정.
> 이 작업이 끝나야 Phase 3(nginx)로 복귀한다.
>
> 작성 시점: 2026-08-17. 진단은 전부 소스/Docker Hub API로 실측한 값이며 추측이 아니다.

---

## 1. 진단 — 무엇이 어긋나 있나 (실측)

### 1-1. 3층 드리프트

```
로컬 작업 브랜치   2026-07-28  11027d8   ← 최신
main / Vercel      2026-07-28  667098f   ← 최신 (PR #29 로 정상 머지됨)
EC2 백엔드 이미지  2026-06-14  591757b   ← 13커밋 뒤처짐 (약 2개월)
EC2 DB 스키마      테이블 3개 + 컬럼 1개 부족
```

> 🔴 **정정 (2026-08-18)**: 최초 진단은 위 2행을 `2026-07-27 4d195ff ← 6커밋 뒤처짐`으로 적었으나
> **사실이 아니다.** PR **#29**(셀러 판매 파이프라인 완성)가 **07-28 21:12 에 정상 머지**돼 있었고,
> 스쿼시 커밋 `667098f` 의 내용은 브랜치 팁 `11027d8` 과 **완전히 동일**하다(`git diff` 결과 0).
> 오진 원인: **`git fetch` 없이 로컬의 낡은 `origin/main` 추적 ref(4d195ff)를 읽었다.**
> → 드리프트는 3층이 아니라 **2층**(EC2 백엔드만 뒤처짐)이었다. 프론트는 3주간 최신이었고,
> 오히려 **07-28 프론트가 06-14 백엔드를 상대로 3주간 돌아** 셀러/주문/정산 화면이 깨져 있었을 것이다.
> 교훈: 원격 상태를 판단할 때는 **반드시 fetch 후** 읽는다. (EC2 이미지 진단은 Docker Hub API
> 직접 조회였으므로 이 오류와 무관하게 유효하다.)

### 1-2. 배포 시점 확정 근거

Docker Hub API(`hub.docker.com/v2/repositories/ansmoon/shopping-mall-backend/tags`) 조회 결과:

| 항목 | 값 |
|---|---|
| 태그 | **`latest` 하나뿐** (count=1) |
| 마지막 push | 2026-06-13 21:34 UTC = **2026-06-14 06:34 KST** |
| 마지막 pull | 2026-08-11 03:13 UTC = 2026-08-11 12:13 KST |

커밋 시각과 대조하면 경계가 분 단위로 확정된다:

```
06-14 06:02 KST  591757b  fix(deps): @sentry/* yarn.lock 동기화   ← 여기까지 배포됨
06-14 06:34 KST  ══════ 🐳 이미지 빌드·푸시 ══════
06-14 21:18 KST  0f6b243  docs(roadmap): 감사로그 계획서 (문서만)
06-14 23:08 KST  6800909  feat(admin): 감사 로그 조회            ← 여기부터 미배포
```

> ⚠️ **8/11의 pull은 무의미했다.** `:latest`는 이름일 뿐이라, 재빌드·재푸시 없이 pull하면
> 6월 이미지가 그대로 내려온다(`Image is up to date`). "배포했다고 생각했지만 안 된" 사고의 정체.

### 1-3. 미배포 백엔드 커밋 13개

| # | 커밋 | 날짜 | 내용 |
|---|---|---|---|
| 1 | `6800909` | 06-14 | 감사 로그 **조회** API |
| 2 | `52190f2` | 06-15 | AI 어시스턴트 MVP |
| 3 | `edcfadd` | 06-16 | 어시스턴트 대화 DB 영속화 |
| 4 | `8c1c36f` | 06-16 | 구매자 리뷰 + RAG 요약 |
| 5 | `833991d` | 06-17 | 프롬프트 캐싱·usage |
| | | *↕ 34일 공백(이력서 시즌)* | |
| 6 | `86a0618` | 07-21 | AI 평가 관측경로 |
| 7 | `65b247e` | 07-24 | eval 골든셋·러너 |
| 8 | `ac675cf` | 07-26 | 프롬프트 1줄 수정(A-1) |
| 9 | `4d195ff` | 07-27 | 셀러 온보딩 왕복 |
| 10 | `40d2a6a` | 07-28 | 셀러 상품 등록/관리 |
| 11 | `44fab55` | 07-28 | 셀러 배송 + 관리자 주문 |
| 12 | `f7a2a48` | 07-28 | 정산 프론트 |
| 13 | `11027d8` | 07-28 | e2e + 결함 2건 수정 |

~~`main`에 없는 6커밋~~ → **정정: 없다.** 위 6커밋(전부 07-28)은 PR #29 로 스쿼시 머지됐다.
따라서 §4 계획의 "5. 프론트: main 병합(fast-forward)" 단계도 **불필요**하다(이미 배포됨).
⚠ 스쿼시 머지의 부작용: 브랜치 커밋들과 main 의 스쿼시 커밋은 **다른 객체**라, 브랜치 위에 새
작업을 쌓으면 origin/main 과 분기한다. 이 트랙 커밋도 같은 함정에 걸려 `rebase --onto origin/main`
으로 정리했다(2026-08-18).

### 1-4. 스키마 격차 (`591757b..HEAD` 엔티티 전수 확인)

변경된 엔티티 파일은 **5개가 전부**:

| 파일 | 변경 | DDL 필요 |
|---|---|---|
| `admin/assistant/entity/conversation.entity.ts` | 신규 | `assistant_conversations` 생성 |
| `admin/assistant/entity/message.entity.ts` | 신규 | `assistant_messages` 생성 |
| `product/entity/product-summary.entity.ts` | 신규 | `product_summaries` 생성 + **enum 타입** |
| `order/entity/order-item.entity.ts` | 수정 | `seller_id` → NULL 허용 |
| `user/entity/user.entity.ts` | 수정 | ❌ `@Exclude()` 데코레이터만 — DB 무관 |

> **`audit_logs` 테이블은 이미 EC2에 존재한다.** 감사로그를 *기록*하는 코드는 훨씬 전부터 돌고 있었고,
> `6800909`는 *조회* API/화면만 추가했다. → **운영 DB에 감사로그 데이터가 쌓여 있다**(§5의 IP 실험에 활용).

### 1-5. 이번 스키마 격차를 pg_dump로 때우려다 발견한 함정 (마이그레이션 도입의 근거)

1. **enum 타입 누락** — `product_summaries.status`는 PG enum(`product_summaries_status_enum`: `fresh`/`stale`/`generating`).
   `pg_dump -t <테이블>`은 **의존 타입을 함께 덤프하지 않아** 적용 시 `type does not exist`로 실패한다.
2. **`$POSTGRES_USER`가 호스트 셸에서 빈 값** — compose가 넣는 변수는 컨테이너 안에만 있다. `sh -c '...'`로 감싸야 한다.
3. **PowerShell `>` 리다이렉트 인코딩** — UTF-16/BOM으로 저장돼 psql이 문법 에러를 낸다.

→ 이 세 함정은 **마이그레이션을 쓰면 전부 사라진다**(`migration:generate`가 enum 포함해 정확히 뽑아준다).

### 1-6. 기타 실측 사실

- **`synchronize: process.env.NODE_ENV !== 'production'`** ([app.module.ts:67](../../backend/src/app/app.module.ts#L67))
  → 로컬 자동 / **운영 꺼짐 + 마이그레이션 없음** = 운영 스키마를 갱신할 경로가 아예 없었다. 이번 사고의 뿌리.
- **CI는 배포를 하지 않는다** — `.github/workflows/ci.yml`은 테스트/린트 + Slack 알림뿐.
  배포 = 로컬 `docker build` → `docker push` → EC2 `docker pull` **전 과정 수동**.
- **새로 필요한 환경변수 3종**(`591757b` 이후): `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.1-flash-lite`.
  키가 비면 AI 어시스턴트는 **자동 no-op**(서버는 정상 기동).
- **Dockerfile**: `WORKDIR /app`, 업로드 경로 `/app/uploads`, 백엔드는 **단일 번들 `backend/dist/main.js`**.
- **`/v1/health`는 `{status, timestamp}`만 반환** — 버전 정보가 없어 이번 진단에 전혀 도움이 되지 않았다.

---

## 2. 결정 — 왜 "비우고 새로 시작"인가

### 2-1. 결정 내용

**응급 패치(pg_dump로 테이블 3개 복사) 폐기. EC2 DB를 비우고 TypeORM 마이그레이션을 새로 도입한다.**

### 2-2. 근거

마이그레이션 도입을 미뤘던 유일한 이유는 **베이스라인 문제**였다 —
"마이그레이션은 빈 DB에서 시작한다고 전제하는데, 운영 DB엔 이미 마이그레이션 없이 만든 테이블 20여 개가 있다."

그런데 **살릴 데이터가 없다면 DB를 비우는 순간 그 전제가 그냥 참이 된다.** 베이스라인 작업이 통째로 사라지고,
응급 DDL 4건도 불필요해진다(새 스키마를 마이그레이션이 처음부터 만드니까).

포트폴리오 프로젝트의 특권이며, "배포 사고를 계기로 스키마 관리 체계를 리셋하고 마이그레이션을 도입했다"는
서사 자체가 실무에서 실제로 일어나는 일이라 포트폴리오 가치도 있다.

### 2-3. 사용자가 직접 확인한 전제

- 상품 mock 데이터는 **파일로 존재** → 다시 넣으면 됨
- 로그/리뷰 테스트 데이터는 양이 적고, **어차피 새로 만들어야 함**
  (필터 버튼이 최대 1개월이라 기간 분포를 새로 설계할 필요가 있음)

### 2-4. 합의된 안전장치 3개 (하나도 생략 금지)

1. **행 수 인벤토리 먼저** — "데이터 없다"는 기억을 실측으로 바꾼다
2. **전체 백업은 무조건** — 버리기로 한 데이터와, 백업 없이 지운 데이터는 다르다. 전자는 결정이고 후자는 사고다
3. **데이터 가이드라인 문서를 지우기 *전에* 작성** — 무엇을 어떻게 재현할지 적어두고 나서 지운다

---

## 3. 데이터 재현 자산 (이미 있는 것 — 새로 만들 필요 없음)

DB를 비운 뒤 데이터를 되살릴 수단이 이미 코드에 상당히 갖춰져 있다.

| 자산 | 위치 | 실행 방식 |
|---|---|---|
| 역할(role) 시드 | `common/seeds/roles.seed.ts` | `app.module.ts` providers 등록 — 부팅 시 |
| 카테고리 시드 | `common/seeds/category.seed.ts` | 동상 |
| 상품 시드 | `common/seeds/product.seed.ts` | `product.controller.ts`가 주입 — **엔드포인트로 실행** |
| 상품 원본 데이터 | `backend/src/data/*.ts` (+`raw/`) | beauty/book/clothing/food/living/shoes |
| 대시보드용 대량 시드 | `seed/dashboard.seed.service.ts` (28KB) | `SeedModule` — **`NODE_SEED=true`일 때만 AppModule에 등록** |
| 리뷰 시드 | `seed/review.seed.service.ts` | 동상 |
| 문의 시드 | `seed/inquiry.seed.service.ts` | 동상 |

> **새 컨텍스트가 할 일**: 위 시드들이 각각 무엇을 얼마나 만드는지 읽고,
> "리셋 후 어떤 순서로 무엇을 실행하면 원래 상태가 재현되는가"를 가이드라인으로 확정할 것.
> 감사로그·결제 로그처럼 시드가 없는 영역은 **새로 만들어야 한다**(사용자가 이미 인지·수용).

---

## 4. 작업 계획 (뼈대)

```
0. 실측 인벤토리 + 전체 백업            ← 안전장치 ①②
1. 데이터 재현 가이드라인 문서화        ← 안전장치 ③ (지우기 전에!)
2. 로컬에 마이그레이션 체계 구축
   - CLI용 DataSource 파일 + migrations 폴더 + package.json 스크립트
   - 빈 로컬 DB에서 migration:generate → "0번: 전체 스키마" 생성 (enum 자동 포함)
3. 로컬 리허설: 빈 DB → migration:run → seed → 앱 정상 동작 확인
4. EC2 반영: 백엔드 정지 → DB 비우기 → 새 이미지(태그 2개) → migration:run → seed
5. 프론트: main 병합(fast-forward) → Vercel 자동 재배포
6. 검증 + §5의 이월 과제 → Phase 3(nginx) 복귀
```

### 4-0. 진행 로그 (2026-08-17)

- **안전장치 ① 완료** — EC2 전 테이블 행 수 실측. users 27명 전원 본인+데모+시드 계정, **외부 실사용자 0명** → 버려도 됨 판정 확정. 캡처: `ex-db-migration-before-capture.md`
- **§5-1 IP 분포 캡처 완료** — 경로 A(XFF 수동)=본인 IP 1개 vs 경로 B(@Ip())=AWS IP 40여 종 실측 증명. 같은 문서에 보존
- **안전장치 ② 완료** — 전체 pg_dump(766KB) + globals + **EC2 .env 사본**을 EC2 `~/db-backup-20260817/`와 로컬 `Desktop\fullstack\db-backups\20260817\` 이중 보관. sha256 일치·gzip 무결성·행 수 대조(users 27/audit 2,495) 검증 통과
- **안전장치 ③ 완료** — 재현 가이드라인 `ex-db-migration-data-guide.md` 작성(시드 3계층 전수 분석 기반, 순서·수량·함정 포함)
- **결정 확정 3건**: ① 로컬 synchronize **끈다**(마이그레이션 파일 단일 진실) ② 실행은 **배포 절차의 명시적 단계**(`migrationsRun: false`) — 상세 §4-0-1 ③ 잔가지 포함(상품 시드 가드 복구 + `.env.example`에 `DEMO_ADMIN_*`·`LLM_*` 보강)
- 부수 실측: EC2 배포 디렉터리는 **`~/Shopping-mall`**(문서 오기 주의), `docker compose` v2만 존재, EBS는 `/mnt/postgres-data`에 정상 마운트(5GB), EC2 .env에 `DEMO_ADMIN_*` 존재·`LLM_*` 3종 부재 확인
- **계획 2단계(로컬 체계) + 3단계(로컬 리허설) 완료 (2026-08-18)**:
  - 신규: `backend/tsconfig.typeorm.json`(ts-node용, eval 패턴)·`src/database/data-source.ts`(CLI 전용)·`src/database/migrations/index.ts`(명시적 배열)·`1786978325132-Init.ts`(0번 전체 스키마) + nx 타깃 4종(`migration:generate --name=X`/`run`/`revert`/`show`)
  - 0번 검증: 테이블 24 정확(가짜 서브타입 0)·**enum 11종 포함**(§1-5의 pg_dump 함정 해소 증명)·order_items.seller_id nullable·FK 28. 빈 DB에서 run→revert 왕복 통과
  - `app.module.ts` **synchronize: false** 전환(통합 테스트 2개는 자체 forRoot(sync)라 CI 무영향)
  - 리허설: 로컬 DB 백업(`db-backups/local-20260818/`) → 스키마 드랍 → migration:run → 부팅 시드(3/27) → 상품 시드(349/1,047) → 대시보드 시드(주문 377·audit 2,512·리뷰 1,855·문의 13·데모 관리자 생성) → API 응답 확인. **가이드(`ex-db-migration-data-guide.md`) 체크리스트 전 항목 일치**
  - 앞으로 스키마 변경 절차: 엔티티 수정 → `migration:generate --name=X` → index.ts 등록 → `migration:run` → 서버 재시작
- **계획 4단계 사전 구현 완료 (2026-08-18, 사용자가 런북으로 직접 EC2 실행 예정)**:
  - **상품 시드 배치화**: `SEED_PRODUCTS=true` 면 대시보드 배치 맨 앞(멱등 게이트 뒤)에서 상품 시드 실행 — HTTP·관리자 토큰 불필요, 가드 복구와의 닭-달걀 해소. nx `seed:full` 타깃 추가. 스크래치 DB 왕복 검증(상품 349 + 전체 시드 + `product_id=999999` 오염 0)
  - **`POST /v1/products/seed` 가드 복구**(admin 전용) — 무인증 401 실측
  - **`src/migrate.ts` → `dist/migrate.js`** 별도 번들(webpack `additionalEntryPoints`) — run/check/revert 3모드, 접속 옵션은 `connection-options.ts` 로 CLI 와 공용화. 빈 DB run→check→재실행(멱등) 검증
  - **`/v1/health` 에 version 노출** + Dockerfile `--build-arg GIT_SHA` 주입(§4-2 ①② 이행) — 로컬 `"version":"dev"` 실측
  - **`.env.example` 보강**: `DEMO_ADMIN_*`/`DEMO_LOGIN_ENABLED` 추가(LLM 3종은 기존재)
  - **0번 마이그레이션에 `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` 수동 추가** — refresh_tokens uuid 기본값의 자기완결성(드라이버 자동 설치 의존 제거). 확장 없는 빈 DB에서 실측 검증
  - **런북 작성**: `ex-db-migration-deploy-runbook.md` — 0~9단계 복붙 명령 + [정상]/[멈춤] 기준 + 트러블슈팅/복구
- **EC2 반영 1차 시도 (2026-08-19, 사용자 직접)**: §1~§5 성공(빌드·푸시·리셋·migrate — DB 는 신 스키마 완료) → §6 에서 **부팅 크래시 루프**: `Cannot find module '@google/genai'`. 원인 = Dockerfile prod-deps 가 루트 package.json 만 `yarn workspaces focus --production` 하는데, 이 패키지만 backend 에 실버전으로 선언돼 있었다(유일 케이스). 06-14 구 이미지는 AI 도입 이전이라 2개월 잠복. **`247a93a`** 로 루트 승격 해소. 부수 확인: EC2 `~/Shopping-mall` 의 소스 체크아웃은 4월자 잔재로 **컨테이너와 무관**(compose 는 `image:` pull) — 정리 대상. dangling 이미지 prune 으로 895MB 회수
- **✅ 계획 4단계(EC2 반영) 완료 (2026-08-19)**: genai 수정(`247a93a`) 재빌드·재푸시(두 태그 동일 다이제스트 `4e38cec…`) → pull → up(70초 만에 healthy) → **§6 검증 통과**(`ps` healthy + health `version:"247a93a"` 단언) → 부팅 시드(3/27) → §7 시드 배치(상품 349·유저 26·주문 369·audit 1,889·리뷰 1,812·문의 13) → §8-1 전 항목 일치(합성값 오염 0) → **Vercel 프록시 경유 외부 검증**(홈 200, `/api/products` 실데이터, `/api/health` 버전 일치). 2개월 드리프트 해소 — 운영이 최신 코드+신 스키마+시드 데이터로 가동. 남은 것: §8-2 브라우저 화면 확인(사용자) + 본인 계정 재가입. `scripts/deploy.sh` 는 이번 수동 완주 경험을 스크립트화하는 후속 과제로 이월

### 4-0-1. 결정 ② 상세 — 마이그레이션은 "배포 절차의 단계"로 (2026-08-17 확정)

**최초 추천은 부팅 시 자동(`migrationsRun: true`)이었으나, 사용자 제안대로 수동 단계(B)로 뒤집었다.**

**A를 밀었던 근거의 결함**: "수동 단계는 잊을 수 있다"는 논거는 *사람이 기억해야 할 때만* 성립한다.
그 단계가 **스크립트 안에 있으면 스크립트가 기억한다** → B의 단점이 아니라 "사람이 손으로 치는 B"의 단점이었다.

**B의 실질 이점 3가지 (A 검토 시 과소평가했던 것)**:
1. **`migration:revert` 경로가 생긴다.** A는 부팅 시 전진만 하므로 되돌릴 방법이 없다. 마이그레이션 학습 단계에서 되돌리기 가능 여부는 크다.
2. **A의 "실패하면 앱이 안 떠서 즉시 발각"은 과대평가였다.** `docker-compose.prod.yaml:31`에 `restart: unless-stopped`가 있어, 실패 시 **깨끗한 실패가 아니라 무한 크래시 루프**(매 재시작마다 DDL 재시도)가 된다. B는 마이그레이션 단계에서 멈추고 **구 컨테이너가 계속 서비스**하므로 진단 시간이 확보된다.
3. **앱을 내린 상태로 마이그레이션할 수 있다.** A는 마이그레이션하려면 앱이 떠야 하므로 파괴적/장시간 DDL에 불리하다.

**단, 원안("배포 파이프라인을 만들면서 동시에")은 2단계로 쪼갠다** — §6 "변수 하나씩" 원칙 + CI/CD가 예상보다 큰 트랙이기 때문:
- GitHub Actions 러너 → EC2 SSH가 걸린다. `My_Environment.md:371`에 **22번은 본인 IP만 허용**인데 러너 IP는 동적. 선택지는 (i) 22 전체 개방(**보안 후퇴** — 곧 nginx/HTTPS 하드닝을 할 참인데 역방향) (ii) self-hosted 러너 (iii) SSM Session Manager(IAM/OIDC 설정). 설정 한 줄이 아니라 설계 결정이다.
- t3.small에서 빌드 금지(2GB RAM) → Action이 빌드·푸시하고 EC2는 pull만 하는 2단 구조 필수.
- **nginx 전환이 헬스체크 URL·보안그룹을 바꾼다** → CI/CD를 nginx보다 먼저 하면 일부를 다시 만들게 된다.

**따라서 순서**: `scripts/deploy.sh`(이 트랙) → nginx/HTTPS(Phase 3) → CI/CD 파이프라인(별도 트랙).
`deploy.sh`는 파이프라인의 **몸통**(순서 있는 명령 목록)이므로 버려지는 작업이 아니다. 나중에 Action은 "checkout + 이 스크립트 호출"이 되고, 바뀌는 것은 **트리거뿐**이다.

**구현 제약 — 컨테이너 안에서 마이그레이션을 어떻게 호출하나 (§4-1① 번들 제약의 재등장)**
운영 이미지에는 `backend/dist/main.js` **단일 번들만** 들어 있다(`Dockerfile:55`). typeorm CLI가 가리킬 DataSource 파일이 이미지 안에 없다 → **전용 엔트리포인트를 의도적으로 만들어야 한다.**
- **(a) 권장 — 별도 번들 타깃**: `src/migrate.ts` → `dist/migrate.js`(NxAppWebpackPlugin의 `additionalEntryPoints` 사용 가능한지 구현 시 **확인 필요**). Nest 전체를 띄우지 않고 DataSource만 → 실패 표면 최소. `--revert`/`--check`(대기 중 마이그레이션 유무) 플래그의 자연스러운 거처.
- (b) 대안 — `main.js --migrate-only` 플래그: webpack 설정 무변경. **저장소 선례 있음**(`backend/package.json:7-17`의 seed 타깃이 `NODE_SEED=true node dist/main.js`로 배치 실행 후 `process.exit(0)`). 단 마이그레이션에 Redis/Sentry/cron까지 부팅하는 건 과하다.

⚠ **함정 — `exec`가 아니라 `run --rm`**: `migrate.js`는 **새 이미지 안**에 들어 있으므로, 아직 구 이미지로 돌고 있는 컨테이너에 `docker compose exec`로는 실행할 수 없다.
`docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js`처럼 **새 이미지로 일회성 컨테이너**를 띄워야 한다(같은 네트워크·env 상속).

**deploy.sh가 강제할 순서** (B의 새 실패 모드 차단 — `up -d`를 먼저 하면 새 코드가 구 스키마를 때려 500이 난다):
```
로컬: build → push(:latest + :<sha> 병행 — §4-2①)
EC2:  pull → migrate(run --rm) → up -d → 헬스체크 + 버전 단언(§4-2②)
```
마이그레이션이 가산적(테이블 3개 추가 + nullable 완화)이라 구 컨테이너가 서비스하는 중에 먼저 적용해도 안전하다.

### 4-1. 구현 시 부딪힐 결정 포인트 2개

**① 번들 환경에서 마이그레이션 파일을 못 찾는 문제 (거의 확실히 발생)**
이 백엔드는 nx가 **단일 `main.js`로 번들**한다. TypeORM의 흔한 설정인 `migrations: ['dist/migrations/*.js']`
같은 **글롭 방식은 읽을 파일이 없어 조용히 실패**한다(마이그레이션 0건 실행 후 정상 종료 — 가장 위험한 실패 유형).
→ 마이그레이션 클래스를 **명시적으로 import해 배열로 등록**하는 방식이 필요하다.

**② 로컬 synchronize를 끌 것인가**
정석은 로컬도 끄고 마이그레이션으로 스키마를 바꾸는 것(안 그러면 로컬 DB ↔ 마이그레이션 파일 드리프트가
새로 생긴다). 대신 개발 흐름이 한 단계 느려진다(엔티티 수정 → generate → run). 트레이드오프를 직접 겪고 결정.

### 4-2. 재발 방지 (이번 작업에 포함할 것)

1. **이미지에 커밋 해시 태그 병행** — `:latest`와 `:<sha>` 동시 푸시. `docker ps`만으로 버전 식별 가능
2. **`/v1/health`에 버전 노출** — [app.controller.ts:14](../../backend/src/app/app.controller.ts#L14).
   빌드 시 주입한 커밋 해시를 얹으면 앞으로 진단이 `curl` 한 번으로 끝난다
3. **배포 절차 문서화** — 수동 배포가 계속될 것이므로 순서를 글로 고정

---

## 5. 이 작업 완료 후 이월되는 과제

### 5-1. 클라이언트 IP 추적 문제 (nginx 문서 v2용 "before 데이터")

Phase 3 설계 중 발견한 미해결 문제. **DB 리셋 전에 실측값을 떠 두면 좋다**(감사로그가 지워지므로).

- `main.ts`에 **`trust proxy` 설정이 없다** → Express가 `X-Forwarded-For`를 무시한다.
- 경로가 두 갈래인 것이 확인됨:
  - **경로 A**: `@Auditable` + `AuditInterceptor` → [audit.interceptor.ts:44-47](../../backend/src/audit/interceptors/audit.interceptor.ts#L44-L47)이
    XFF를 **손으로 직접 읽는다** → trust proxy 없어도 클라 IP가 나온다(위조 검증은 없음)
  - **경로 B**: 인증 계열(`@Ip()`) → `request.ip` → **소켓 주소(=Vercel 서버 IP)를 그대로 기록**
- 아이러니: [login/route.ts:15](../../frontend/src/app/api/auth/login/route.ts#L15)가 XFF를 **정성껏 실어 보내는데**
  백엔드가 안 읽는다. 데이터는 도착하는데 버려지는 중.
- **로그 품질 문제로 끝나지 않는다**: [auth.service.ts:202-206](../../backend/src/auth/auth.service.ts#L202-L206)의
  로그인 레이트리밋 키가 `login:${ipAddress}`(IP당 10회/5분). 이 값이 Vercel IP면
  **전 세계 사용자가 키 하나를 공유**해 서로의 시도 횟수를 잡아먹는다. → 실질 버그.
- 로컬에서 `::1`이 찍히는 것은 **trust proxy와 무관**하다(로컬은 브라우저가 `localhost:4000`을 직접 호출 —
  `NEXT_PUBLIC_API_URL='http://localhost:4000/v1'`). 운영과 로컬은 아예 다른 경로를 탄다.

> **떠 둘 값**: EC2에서 아래를 실행해 `ip_address` 분포를 캡처(화면이 없어도 데이터는 있다).
> ```bash
> docker compose -f docker-compose.prod.yaml exec -T postgres \
>   sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT action, ip_address, count(*) FROM audit_logs GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20;"'
> ```

### 5-2. Phase 3 (nginx) — 의제 E부터 재개

`docs/roadmap/03-infra-nginx.md`를 v2로 보강하는 작업이 중단된 상태.
A~D(설계 결정 16개) 학습 완료, **의제 E(안전한 전환)·F(검증) 남음**. 도메인 `ansmoon.dev` 구매 완료.
→ 이 DB 작업이 끝난 뒤 별도 컨텍스트에서 재개한다. **두 작업을 섞지 말 것**(변수 하나씩).

---

## 6. 진행 원칙

- **변수 하나씩** — DB 작업이 끝나고 사이트가 멀쩡히 도는 걸 확인한 뒤 nginx로 넘어간다.
  둘을 섞으면 문제가 터졌을 때 원인 구분이 불가능하다.
- **되돌릴 수 없는 작업(DB 삭제) 앞에서는 반드시 멈추고 확인** — 백업 존재와 크기를 눈으로 본 뒤 진행.
- 사용자는 **신입 백엔드 개발자**로 마이그레이션·인프라 실무 경험이 없다.
  일반론이 아니라 **이 저장소의 실제 파일·코드와 짝지어** 설명할 것.
