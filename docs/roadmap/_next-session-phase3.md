# 작업: Ops Companion Phase 3 — AI 분석

## 먼저 읽어라 (이 순서로)

1. `CLAUDE.md` §5 의 "RN Ops Companion" 항목 3개 — Phase 0-A / Phase 0 / Phase 2. 지금 어디까지 됐는지
2. `docs/roadmap/ops-companion-design.md`
   - §9 **Phase 2 완료 기록** ← 직전 세션의 결과. 확정한 결정 4건과 함정 6건이 여기 있다
   - §3.4 **AI 분석 파이프라인**(이번 목표) · §5.1 의 Phase 3 엔드포인트 · §5.3 `ops_analyses` · §5.4 **응답 스키마**
   - §6 의 "AI 호출 계측" 행 · §7 보안 원칙 · §10 작업 지침 · §11·§11-1 물려받은 전제
3. `docs/learning/ops-companion/03-observability-and-biometrics.md` — 특히 **6장 함정 9건**(그대로 다시 밟지 마라)과 7장 실행·진단법. 1·2편은 필요할 때만
4. `docs/learning/ops-companion/infra-story.md` — **살아 있는 인프라 지도**. 새 용어가 헷갈리면 여기 용어 사전부터
5. `docs/roadmap/ex-ai-assistant.md` — 쇼핑몰 관리자 AI 어시스턴트. **이번에 재사용할 자산의 원본**이다
6. `ops-companion/README.md` — 실행·빌드·소스맵 절차

앱 코드와 백엔드 `ops` 모듈은 이미 있다. 새로 만들지 말고 지금 코드에서 출발하라.

---

## 현재 상태 (2026-09-21 기준)

**브랜치**: `feat/ops-observability` = `2277dd1` (원격에 푸시됨). **PR 은 사용자가 직접 만든다.**
`main` 은 `c19e306` 으로 6커밋 뒤처져 있다. PR 이 머지되기 전에 Phase 3 을 시작한다면 새 브랜치를
`feat/ops-observability` 에서 따라 — main 에서 따면 Phase 2 코드가 없다.

**Phase 2 는 DoD 전 항목 통과로 끝났다**(2026-09-21). 확인한 것:
프로덕션 빌드 에러가 **원본 파일:줄:칸**으로 복원(`sentry.ts:48:43` = `new Error(` 의 여는 괄호) /
테스트 이벤트 3건이 **이슈 1개**로 묶임(beforeSend 억제) / 태그 `screen`·`appVersion`·`ops.test` /
`user` 가 id 뿐(이메일 없음) / crash-free 카드 **두 줄**(`1.0.0+2` 1세션이 위, `1.0.0+1` 16세션이 아래) /
지문 잠금 + 백그라운드 60초 재잠금 / **앱 완전 종료 → 푸시 탭 → 잠금 → 지문 → 인시던트 상세 직행**

**운영 배포도 완료됐다** — `4ead4ca`. health `version` 단언, `/v1/ops/release-health` 401(라우트 존재),
`/products`·`/categories` 200(회귀 없음). **Phase 2 는 DB 변경이 없었다.**

**그래서 Phase 3 은 아래 "이번 범위" 부터 바로 시작하면 된다.**

### 인프라 상태

- **운영 백엔드**: `4ead4ca`. EC2 `15.164.185.156`, `https://api.ansmoon.dev/v1`
- **EC2 접속**: `ssh -i ~/.ssh/shoppingApp-key-v2.pem ubuntu@15.164.185.156`, 작업 디렉터리 `~/Shopping-mall`
  - ⚠ **운영 DB 를 직접 읽는 것은 권한 정책이 막는다**(Production Reads). 우회하지 마라.
    필요한 값은 화면·로그·API 로 얻거나 사용자에게 요청한다.
- **앱 빌드**: 실기기에 **preview `7908bf7d`**(versionCode 2)가 설치돼 있다.
  개발 빌드 **`8f91794d`**(versionCode 1)도 expo.dev 에 남아 있어 재설치 가능하다.
  ⚠ **preview 에는 런처가 없다** — Metro 에 붙지 못한다(JS 가 APK 내장). JS 를 고쳐가며 개발하려면
  개발 빌드를 다시 설치해야 한다. 키스토어가 같으니 덮어 설치된다.
- **EAS 서버가 기억하는 versionCode = 2**. preview·production 은 `autoIncrement` 가 켜져 있어
  빌드할 때마다 오른다(development 는 제외).
- **앱 `.env`** 는 운영(`https://api.ansmoon.dev/v1`)을 가리킨다. 로컬 백엔드에 붙일 때는 PC 의
  LAN IP(직전 세션 기준 `172.30.1.85`)로 바꾸고 **`yarn start --clear`** 로 다시 띄운다
  (`EXPO_PUBLIC_*` 는 번들을 만들 때 박히는 값이다).
- ⚠ **로컬 백엔드와 운영 백엔드를 동시에 켜 두지 마라.** 둘이 같은 Sentry 를 각자 폴링하고
  커서·발송기록이 DB 별로 따로여서 알림이 두 번 온다.
- 로컬 DB 관리자 = `demo-admin@portfolio.local`(루트 `.env` 의 `DEMO_ADMIN_PASSWORD`).
  운영 DB 관리자 = `kirianir@naver.com`. **로컬과 운영은 별개 DB.**

---

## 이번 범위 (설계 §9 Phase 3)

**Phase 3 은 Phase 2 와 성격이 다르다. DB 가 바뀌고, 외부 LLM 이 붙고, 응답이 불확실하다.**

- **백엔드 분석 파이프라인**(§3.4) — `POST /v1/ops/incidents/:id/analysis`
  1. Sentry 에서 해당 인시던트 상세(스택·태그·빈도) 조회 — `ops.service.ts` 의 `getIncident` 재사용
  2. 프롬프트 조립(시스템 지시 + 인시던트 데이터. few-shot 은 Phase 4)
  3. **LLM 호출** — `backend/src/intrastructure/ai/` 의 `LlmClient` 를 **그대로 재사용**한다. 새로 짜지 마라
  4. 응답 JSON 파싱 + **스키마 검증**(§5.4). 실패 시 1회 재시도 → 그래도 실패면 `parse_failed` 로 저장
  5. 결과를 `ops_analyses` 에 저장(캐시 겸 Phase 4 의 평가 대상)
- **DB 마이그레이션** — `ops_analyses`(§5.3). id · incidentId · status(`ok`|`parse_failed`) ·
  resultJson(jsonb) · promptVersion · model · latencyMs · createdAt.
  ⚠ `promptVersion` 을 반드시 저장한다. Phase 4 의 "프롬프트 v1 vs v2 승인율" 비교가 이 값에 걸려 있다
- **S4 AnalysisScreen**(§4.3 S4) — 구조화 카드(심각도 뱃지 / 원인 / 추천 조치 / 관련 파일 칩).
  상태 3가지: 로딩(스켈레톤) · 성공 · **구조화 실패 fallback**(원문 + 재시도 버튼)
- **S3 의 CTA 활성화** — "AI에게 원인 물어보기". 지금은 숨겨져 있다
- **AI 호출 Sentry span 계측**(§6) — Phase 2 에서 `tracesSampleRate: 0` 으로 꺼 둔 성능 추적을 켠다.
  ⚠ 켜면 트랜잭션이 쿼터를 먹는다. 샘플링 비율을 낮게 두고, beforeSend 와 같은 방어 감각으로 접근하라
- DoD: 실제 인시던트에 대해 구조화 카드가 렌더된다. **AI 가 스키마를 어겨도 앱이 깨지지 않고
  fallback UI 가 표시된다(강제 실패 테스트 포함).**

### 재사용할 기존 자산 (새로 짜지 마라)

| 자산 | 위치 | 쓸모 |
|---|---|---|
| 프로바이더 비종속 `LlmClient` | `backend/src/intrastructure/ai/` | AI 호출부. 현재 Gemini, 교체 가능 |
| SSE 스트리밍 | `POST /v1/admin/assistant/stream` | **nginx 통과 검증 완료**(`X-Accel-Buffering: no` + `proxy_read_timeout 300s`) |
| tool use · PII 스크럽 | `backend/src/admin/assistant/` | 스키마 강제·마스킹 선례 |
| `scrubText` | `backend/src/common/utils/scrub-text.ts` | 프롬프트에 넣기 전 인시던트 텍스트 마스킹 |
| eval 하네스 | `backend/eval/` | Phase 4 의 품질 비교에 쓴다 |

⚠ **Gemini 무료티어는 RPM 15** 다. 분석 요청 빈도·재시도 설계에 반영하라.

---

## 범위 밖

- Phase 4(평가 루프 · 스와이프 카드 · few-shot 주입)
- Slack `#sentry-errors` 복구(설계 §3.3 💡 — 폴링 루프에 얹을 수 있다. 제안만 하라)
- iOS 빌드·스토어 배포(설계 §9 비목표)
- EAS Update(설치 없이 JS 교체) — 쓸지 정하지 않았다

---

## 진행 방식

- 사용자는 **RN 초보**이고 **프론트엔드 개발자**다. 새 개념이 처음 나올 때 한 줄로 설명하라.
  개념 질문에는 웹 Claude 처럼 자세히 답하고, **문서와 실제 코드를 짝지어** 설명하라.
- 설계 §10-2 대로 **작게 나눠** 단계마다 사용자가 실기기로 확인하게 하라.
  ⚠ **확인 수단이 준비되기 전에 코드를 쌓지 마라.** 직전 세션에서 사용자가 질문만 했는데 다음 단계
  코드를 진행해, 20분짜리 빌드를 한 번 더 하게 만든 일이 있었다. 앱 JS 를 고칠 거면 **개발 빌드가
  설치돼 있는지 먼저 확인**하라.
- 패키지는 `npx expo install` 로 설치한다(`npm install` 로 최신을 깔지 마라). 설치 뒤 `npx expo-doctor`.
- **DB 스키마는 마이그레이션으로만.** 엔티티 수정 →
  `nx run @shopping-mall/backend:migration:generate --name=<이름>` →
  **`src/database/migrations/index.ts` 에 명시적 등록**(글롭은 nx 단일 번들이라 **조용히 실패**한다) →
  `migration:run`. CLI DataSource 는 `src/database/data-source.ts`(cwd=backend 필수).
  ⚠ `string | null` 컬럼은 `@Column({ type: 'varchar', nullable: true })` 처럼 **타입을 명시**해야 한다
  (리플렉션이 `Object` 로 보고 generate 가 거부한다 — Phase 1 에서 겪었다).
- **커밋 전에 반드시 `git branch` 로 브랜치를 확인하라.** 과거에 main 에 직접 푸시한 사고가 있었다.
  커밋 메시지 초안을 먼저 보여주고 승인을 받아라.
- ⚠ **main 에 푸시하면 Vercel 이 프론트를 자동 운영 배포한다.**
- 커밋 메시지는 `git commit -F <파일>` 로 넘겨라. PowerShell here-string(`@'…'@`)을 Bash 도구에서
  쓰면 메시지 앞에 `@` 가 붙는다.
- ⚠ **아주 긴 heredoc 은 잘린다.** 큰 문서를 만들 때는 Write 도구를 쓰거나 나눠서 append 하라
  (직전 세션에서 30KB heredoc 이 중간에 끊겨 `unexpected EOF` 가 났다).

---

## 운영 배포 절차

반드시 사용자 승인을 받고 진행하라. 절차는 설계 §10-6 / `03-infra-nginx-runbook.md` §10:

```bash
# [로컬]
SHA=$(git rev-parse --short HEAD)
docker build --build-arg GIT_SHA="$SHA" -t ansmoon/shopping-mall-backend:latest -t "ansmoon/shopping-mall-backend:$SHA" -f Dockerfile .
docker push ansmoon/shopping-mall-backend:latest && docker push "ansmoon/shopping-mall-backend:$SHA"

# [EC2] ~/Shopping-mall
docker compose -f docker-compose.prod.yaml pull backend
docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js   # ⚠ Phase 3 은 마이그레이션이 있다
docker compose -f docker-compose.prod.yaml up -d
docker compose -f docker-compose.prod.yaml exec -T nginx nginx -t && docker compose -f docker-compose.prod.yaml exec -T nginx nginx -s reload   # ⚠ 빠뜨리면 502
curl -s https://api.ansmoon.dev/v1/health   # version == 새 SHA
```

- **마이그레이션은 `run --rm`** 이다(기존 컨테이너 `exec` 가 아니다 — `migrate.js` 는 **새 이미지 안**에 있다)
- **마지막 nginx reload 필수** — nginx 가 backend 이름→IP 를 시작 시 1회만 캐시한다
- 운영 `.env` 에 LLM 키가 들어 있는지 확인하라. 없으면 `LlmClient` 가 no-op 이 되어 분석이 503 이다

---

## 로컬 환경 함정 (메모리에도 있다)

- **`nx serve backend` 는 코드를 바꿔도 node 를 재시작하지 않는다.** 직전 세션에서 이것 때문에 새
  라우트가 404 였다(node 시작 12:38:12 → `main.js` 기록 12:38:27). 백엔드를 고쳤으면 `Ctrl+C` 후
  다시 띄우고, 시작 로그의 `[RouterExplorer] Mapped {…} route` 로 확인하라.
- 백엔드 jest 는 Node 22 에서 `jest.config.ts` 파싱이 실패한다(CI 는 Node 24 라 정상).
  인라인 config 우회법은 메모리 `backend_jest_local_run`.
- 프론트는 `nx test frontend --testPathPatterns=`(복수형). backend-e2e 는 `--testPathPattern` 을 줘도
  전 스위트가 돈다.
- 백엔드 eslint 는 Nx 그래프 때문에 로컬에서 20분 넘게 걸린다. 급하면 `tsc` 로 본다.
- `tsc -p backend/tsconfig.app.json` 에는 **원래 있던 오류가 30건** 있다. 바뀐 파일만 걸러 보라
  (`| grep -E 'src/ops'` 같은 식).
- backend-e2e 는 서버를 띄우지 않는다. postgres·redis + `nx serve backend` 가 떠 있어야 한다.
  로그인은 IP 당 10회/5분 — 프로브를 반복하면 429 가 된다.
- `nx serve backend` 를 백그라운드로 띄울 때 `| tail` 파이프를 물리면 로그가 버퍼에 갇혀 에러를
  못 본다. **파일로 리다이렉트**해라. PowerShell 에서는 끝의 `&` 가 동작하지 않으니 **터미널 창을
  따로** 여는 편이 낫다.
- Docker Desktop 데몬이 멈춰 있으면 프로세스를 강제 종료하고 다시 켠다.
- gh CLI 가 없다. GitHub Actions 상태는 공개 API 를 curl 로 조회한다.
- 앱 흰 화면은 번들러 고장을 먼저 의심하라(학습 노트 2편 6-9 · 7-4 의 curl 한 줄).
- **QR 이 두 종류다.** `eas build` 의 QR = APK 다운로드, `yarn start` 의 QR = Metro 서버 주소.
  개발 빌드는 둘 다 필요하고, preview 는 앞의 것만 쓴다.

---

## Phase 2 에서 확정돼 이번에도 유효한 것

| 항목 | 내용 |
|---|---|
| Sentry `release` | **init 에 적지 않는다.** 네이티브 기본값이 소스맵 업로드 릴리즈명과 일치해야 한다 |
| 소스맵 업로드 | **debug 가 아닌 빌드만**. 개발 빌드로는 복원 확인 불가 → preview 필요 |
| `beforeSend` | 같은 에러 60초 1건 + 실행당 20건. **새 에러 경로를 만들면 이 상한을 의식하라** |
| 마스킹 | `src/lib/scrub.ts`(앱) · `common/utils/scrub-text.ts`(백). **LLM 에 넣는 텍스트도 반드시 거쳐라** |
| 태그 | `screen` 은 `useSegments`(패턴). `usePathname` 은 카디널리티가 터진다 |
| Sentry sessions 조회 | `project` 와 **`interval` 둘 다 필수**. 빼면 에러 없이 틀린 답이 온다 |
| 생체 잠금 | **덮개**(라우트 아님). 잠긴 동안 뒤에서 딥링크 이동이 정상 수행된다 |

---

## Phase 가 끝나면

학습 노트 4편(`docs/learning/ops-companion/04-ai-analysis.md` 예정)을
`docs/learning/ops-companion/README.md` 의 "이어 쓰는 규칙" 대로 쓰고 목차 표를 채운다.
설계 문서 §9 Phase 3 에 진행·통과 기록을 남긴다. **이 파일(`_next-session-phase3.md`)은 삭제한다.**

**그리고 [`docs/learning/ops-companion/infra-story.md`](../learning/ops-companion/infra-story.md) 를
갱신하라.** 이 문서는 편 번호가 붙은 학습 노트와 달리 **살아 있는 문서**다 — Phase 종료 시점의
기록이 아니라 **현재 인프라의 지도**이므로, 인프라가 늘거나 연결이 바뀌면 **덧붙이지 말고 고쳐 쓴다.**

Phase 3 은 갱신 대상이 확실하다. 그 문서 **8장 "앞으로 바뀔 것"** 표에 Phase 3 몫이 적혀 있다:

| Phase 3 에서 생기는 변화 | 고칠 곳 |
|---|---|
| **AI API**(현재 Gemini, 추후 Claude) — 백엔드가 호출한다. 키는 백엔드에만 | 0-1 전체 지도 · 5장 비밀값 · 6장 의존성 |

그 밖에 비밀값이 하나라도 늘면 **5장 비밀값 지도**와 **6장 "무엇이 죽으면 무엇이 멈추나"** 를 함께
고친다(LLM 이 죽으면 무엇이 멈추는지가 새 줄이 된다). 새 용어는 본문 첫 등장 자리에서 풀고
**용어 사전**에도 넣는다. 끝으로 맨 아래 **갱신 기록** 표에 날짜·커밋·바뀐 내용을 한 줄 남기고,
README 부록 표의 "마지막 갱신" 도 맞춘다. 끝낸 항목은 8장 표에서 지우고 본문에 녹인다.
