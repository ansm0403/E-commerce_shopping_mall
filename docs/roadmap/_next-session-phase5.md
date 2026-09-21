# 작업: Ops Companion Phase 5 — 소스 코드를 읽는 분석 (tool use)

## 한 문장 목표

**AI 가 스택트레이스의 파일:줄을 GitHub 에서 직접 읽고 분석하게 해서, "추측"을 "근거 있는 지적"으로 바꾸고, 그 차이를 Phase 4 의 평가 장치로 숫자로 확인한다.**

Phase 4 는 측정 장치를 만들었고, 첫 측정은 "few-shot 으로는 안 좋아진다"였다(test 6건 v1 5/6 vs v2 4/6). 특히 CORS 이슈는 v1 도 v2 도 똑같이 틀렸다 — "`api.ansmoon.dev` 를 허용 목록에 추가하라", 확신도 high. 모델이 `main.ts` 의 `enableCors` 설정을 **볼 수 없어서** 틀린 것이라 예시로는 못 고친다. Phase 5 는 모델에게 **눈**을 준다. 설계 §9 "Phase 3 이후 보강 후보" 표의 1번이다.

⚠ **설계 문서 §9 에는 Phase 5 정의가 없다.** Phase 4 가 v1 의 마지막이었다. 착수 전에 아래 "Phase 5 정의(초안)"를 사용자와 확정해 §9 에 추가하라.

---

## 먼저 읽어라 (이 순서로)

1. `CLAUDE.md` §5 의 "RN Ops Companion Phase 4 완료" 줄
2. `docs/roadmap/ops-companion-design.md`
   - §9 **Phase 3 이후 보강 후보** 표(1번 = 이번 Phase, 2번 배포 맥락은 같이 할 수 있다) · "DoD 통과가 분석이 맞다는 뜻은 아니다" 문단
   - §9 **Phase 4** — 결정 5건 · 평가 세트 표(9건) · 실측 수치 · 버전 표기 규칙
   - §3.4 AI 분석 파이프라인 · §7 보안 원칙 · §10 작업 지침
3. `docs/learning/ops-companion/05-review-loop.md` — 특히 **0-3 수치**, **6-6 오염 요소**, **6-7**, **8장**
4. `docs/learning/ops-companion/04-ai-analysis.md` **6-8**(CORS 오답의 원형) · 3-2~3-4(파서·교정 재시도·JSON 모드를 안 쓴 이유)
5. `docs/roadmap/ex-ai-assistant.md` §2-3(Tool Use 개념) · Phase 3~4(도구 루프 구현) · **§8-1 `thought_signature` 400** · **§8-4 도구 결과는 직렬화 인터셉터를 안 거친다**
6. `docs/learning/ops-companion/infra-story.md` — 8장에 "소스 코드 읽기" 행을 예약해 뒀다(0-1 지도 · 3-4 · 5장 · 6장을 고칠 것)

코드 출발점: `backend/src/ops/ops-analysis.service.ts`(`generate`), `backend/src/intrastructure/ai/llm-client.interface.ts`(`generateWithTools`), 도구 구현 선례 `backend/src/admin/assistant/`.

---

## ⚠ 착수 전 선행 작업 — Phase 4 운영 배포

Phase 4 는 **코드·실기기 채점·수치 완료, 배포 미완**이다. 브랜치 `feat/ops-review-loop`(원격 푸시됨) = `454fae0`(본 작업) · `dd080f0`(문서 해시) + 이 인수인계 커밋.

| # | 할 일 | 누가 | 비고 |
|---|---|---|---|
| 1 | PR 생성·머지(`feat/ops-review-loop` → `main`) | 사용자 | 머지되면 사용자가 알려 준다 |
| 2 | 운영 배포 | Claude | **마이그레이션 1건**(`OpsReviews1790001959888` — `ops_reviews` 신설 + `ops_analyses` 컬럼 3개). 절차는 아래 |
| 3 | 스모크 | Claude | `GET /v1/ops/analyses/pending`·`/stats`·`POST /v1/ops/analyses/1/review` 가 401(라우트 존재) · `/products`·`/categories` 200 |
| 4 | 새 preview 빌드(선택) | 사용자 | 폰의 개발 빌드는 Metro 의존이다. 운영에서 평가 탭을 쓰려면 `eas build -p android --profile preview`(versionCode 자동 증가). 개발 빌드가 깔린 상태라면 삭제 불필요 — preview 가 versionCode 가 더 높다 |
| 5 | 학습 노트 5편 0-3 "운영 배포 ⏳" · 설계 §9 Phase 4 머리줄 · CLAUDE.md 갱신 | Claude | 배포 SHA 기입 |

운영 배포 절차(설계 §10-6):

```bash
# [로컬] — PR 이 main 에 머지된 뒤, main 에서
git checkout main && git pull
SHA=$(git rev-parse --short HEAD)
docker build --build-arg GIT_SHA="$SHA" -t ansmoon/shopping-mall-backend:latest -t "ansmoon/shopping-mall-backend:$SHA" -f Dockerfile .
docker push ansmoon/shopping-mall-backend:latest && docker push "ansmoon/shopping-mall-backend:$SHA"

# [EC2] ssh -i ~/.ssh/shoppingApp-key-v2.pem ubuntu@15.164.185.156 ; cd ~/Shopping-mall
docker compose -f docker-compose.prod.yaml pull backend
docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js   # ⚠ exec 아님 — migrate.js 는 새 이미지 안에
docker compose -f docker-compose.prod.yaml up -d
docker compose -f docker-compose.prod.yaml exec -T nginx nginx -t && docker compose -f docker-compose.prod.yaml exec -T nginx nginx -s reload   # ⚠ 빠뜨리면 502
curl -s https://api.ansmoon.dev/v1/health   # version == 새 SHA
```

⚠ **운영 DB 를 직접 읽는 것은 권한 정책이 막는다.** 운영 확인은 API·로그·앱 화면으로.
⚠ 운영 DB 에는 **평가 행이 0건**이다(Phase 4 채점은 전부 로컬 DB). 운영에서 few-shot 은 승인 풀이 빌 때까지 v1 로 동작한다(버전 규칙 — 설계 §9 Phase 4).

**1~3 이 끝나야 Phase 4 가 닫힌다. Phase 5 코드는 그 뒤에 시작한다**(설계 §9 절대 원칙).

---

## 현재 상태 (2026-09-22 기준)

### Phase 4 에서 만든 것 — Phase 5 가 그 위에 선다

- `ops_reviews` + `GET /v1/ops/analyses/pending`(블라인드) · `POST …/:id/review`(upsert) · `GET …/stats`(버전별 승인율)
- few-shot: `OpsReviewService.selectFewShot` → `OpsAnalysisService.generate(incident, useFewShot)`. **버전은 "예시가 실제로 들어갔는가"로 정한다**(0개면 v1). Phase 5 는 이 규칙을 **도구 사용 여부**로 확장해야 한다(결정 ⑤)
- `ops_analyses` 에 `incident_title`·`exception_text`·`few_shot_ids`. Phase 5 는 "어떤 파일을 읽었나"를 남길 자리가 필요하다(결정 ⑤)
- 평가 세트 스크립트 `backend/eval/ops-review-set.ts`(list/seed/test/stats). **같은 test 세트를 v3 로 다시 돌리면 v1·v2·v3 비교가 된다.** 스크립트에 버전 선택 인자를 더해야 한다(지금은 `fewShot` true/false 뿐)
- 로컬 DB 평가 데이터: 분석 #14~#28 + 채점 18건(평가자 user 1 = demo-admin). test 세트 id 는 설계 §9 Phase 4 표

### 코드에서 확인한 사실 — 설계 §9 보강 후보 표와 **다르다**

| 설계 표의 전제 | 실제(2026-09-22 확인) | 영향 |
|---|---|---|
| "쇼핑몰은 Sentry release = 커밋 SHA 라 정확한 시점의 코드를 읽을 수 있다" | **백엔드 `backend/src/instrument.ts` 에 `release` 가 없다.** `GIT_SHA` 는 Dockerfile 이 `APP_VERSION` env 로만 넣고 `/v1/health` 가 노출할 뿐 Sentry 에는 안 간다. 프론트(`@sentry/nextjs`)도 명시 설정은 없다 — Vercel 빌드에서 SDK 가 커밋 SHA 를 자동으로 잡는지는 **확인 필요**(Sentry 이슈의 `firstRelease` 값을 실제로 조회해 볼 것) | "그 시점의 코드"를 특정할 수단이 백엔드에는 지금 없다 → 결정 ② |
| 스택의 파일:줄을 읽는다 | **운영 백엔드 스택은 번들 좌표다** — `/app/backend/dist/main.js:<줄>`(4편 6-8 의 `relatedFiles` 가 이것이었다). 이미지에 `*.js.map` 은 들어 있지만 `CMD ["node", "backend/dist/main.js"]` 에 `--enable-source-maps` 가 없고, 백엔드는 Sentry 에 소스맵을 올리지도 않는다 | 백엔드 프레임은 **그대로는 GitHub 경로로 못 바꾼다** → 결정 ① |
| — | 프론트 프레임은 Sentry 소스맵 업로드(`widenClientFileUpload`)로 원본 경로가 나온다(예: `src/lib/axios/axios-http-client.ts:88`) — 실제 Sentry 이벤트로 **확인 필요** | 프론트만으로 먼저 시작하는 선택지가 생긴다 |
| — | 저장소 `ansm0403/E-commerce_shopping_mall` 은 **public** 이다(GitHub API 200). 무인증 raw 읽기가 된다 | 새 비밀값 없이 시작할 수 있다 → 결정 ③ |
| 재사용 자산 `LlmClient.generateWithTools` | 존재한다. 단 **스트리밍 전용**(`AsyncIterable<LlmStreamEvent>`)이다. 도구 루프를 내부에서 돌리고 최종 텍스트를 델타로 흘린다 | 분석은 스트리밍이 필요 없다 → 델타를 모아 `parseAnalysis` 로 넘긴다. 교정 재시도(4편 3-3)와 어떻게 결합할지 → 결정 ④ |

### 인프라·기기 상태

- 운영 백엔드: `89a02bc`(Phase 3). Phase 4 배포 후 새 SHA
- 폰: **개발 빌드**(Phase 4 채점에 사용) — Metro(`yarn start --clear`) + 앱 `.env` LAN IP 가 있어야 돈다. 앱 `.env` 는 지금 **운영 주소**로 되돌려 놓았다
- 로컬: postgres·redis 컨테이너 켜짐, 백엔드(4000)·Metro 꺼짐
- LLM: Gemini flash-lite 무료티어 RPM 15. Phase 4 중 **`"code":503 high demand` 가 자주 왔다**(스크립트는 30초 재시도로 방어)

---

## Phase 5 정의 (초안 — 착수 전 사용자와 확정해 설계 §9 에 추가)

- **구현**: `read_source` 도구(파일 경로 + 줄 범위 → 코드 조각) · 분석 파이프라인을 `generateWithTools` 로 전환(도구 결과를 받아 최종 JSON) · 읽은 파일 기록 · promptVersion `v3` · (선택) Sentry `firstRelease` 를 프롬프트에 싣기(보강 후보 2번 — 필드 하나라 싸다)
- **앱**: 분석 카드에 "AI 가 읽은 코드" 섹션(파일:줄 칩). 새 네이티브 패키지 없이
- **DoD**: ① CORS 이슈(7732523858)에 대해 v3 가 `main.ts` 의 CORS 설정을 **실제로 읽고**(기록으로 확인) "서버 자신을 허용하라"는 오답을 내지 않는다 ② Phase 4 test 세트를 v3 로 분석해 블라인드 채점 → v1·v2·v3 승인율 표 ③ 도구 호출 실패(파일 없음·범위 밖·GitHub 장애)에도 분석이 v1 처럼 끝난다(깨지지 않는다)

### 착수 전에 사용자와 정할 결정 (설계에 답이 없다)

각자 한 줄 추천을 붙여 물어라. 사용자는 RN·AI 초행자다 — Phase 4 에서 few-shot·캐시 질문에 "판단이 어렵다"고 답했다. **선택지를 내기 전에 개념을 코드와 짝지어 먼저 설명하라.**

1. **백엔드 번들 좌표를 어떻게 원본으로 바꾸나**
   - (a) `CMD` 에 `node --enable-source-maps` — 이미지에 이미 있는 `.map` 으로 Node 가 스택을 원본 경로로 찍는다. Sentry 이벤트의 프레임도 원본이 된다. 비용: 에러 시 스택 변환 비용(에러 경로에서만). **Dockerfile 한 줄**이라 가장 싸다. 단 webpack `devtoolModuleFilenameTemplate: '[absolute-resource-path]'` 라 경로가 빌드 머신의 절대경로(`/app/backend/src/...`)로 나올 수 있다 — 저장소 상대경로로 바꾸는 정규화 필요
   - (b) 백엔드 소스맵을 Sentry 에 업로드(`@sentry/cli` + release) — 정석이지만 CI/배포 절차가 는다
   - (c) 이번엔 **프론트 프레임만** 대상 — 가장 작지만 CORS(백엔드 이슈)가 DoD 에서 빠진다
   - 추천: (a). 코드 한 줄 + 배포 1회로 CORS 케이스가 산다. 적용 후 **새로 발생한 이벤트부터** 원본 좌표다(옛 이벤트는 그대로) — 테스트 세트 대부분이 옛 이벤트라는 점을 계산에 넣어라
2. **어느 시점의 코드를 읽나**
   - (a) 항상 `main` HEAD — 단순. 이슈 발생 후 코드가 바뀌었으면 엉뚱한 줄을 읽는다
   - (b) Sentry `release` 를 커밋 SHA 로 설정(`instrument.ts` 에 `release: process.env.APP_VERSION`) 후 이벤트의 release 로 그 커밋을 읽는다 — 정확하지만 **옛 이벤트는 release 가 없다**
   - 추천: (b) 를 설정하고, release 가 없으면 (a) 로 폴백하되 프롬프트에 "HEAD 기준, 발생 시점과 다를 수 있음"을 명시(근거 약하면 confidence 를 낮추는 규칙과 연결)
3. **GitHub 접근**
   - (a) 무인증 `raw.githubusercontent.com` — public 저장소라 된다. 비밀값 0. 상한은 IP 당 시간당 수준(정확한 값은 **착수 시 GitHub 문서로 확인**)
   - (b) fine-grained 토큰(read-only, 이 저장소만) — 상한이 넉넉하지만 **비밀값이 하나 는다**(infra-story 5장·6장 갱신)
   - 추천: (a) 로 시작 + Redis 캐시(`ops:src:<sha>:<path>` — 같은 커밋의 파일은 불변이라 TTL 을 길게). 저장소가 private 으로 바뀌면 (b)
4. **도구 설계와 안전장치**
   - 도구 하나 `read_source({ path, startLine, endLine })` vs 둘(`read_source` + `search_code`). 추천: **하나**. 스택에 파일:줄이 이미 있다 — 검색까지 주면 왕복이 는다
   - **경로 허용 목록**: `backend/src/`·`frontend/src/`·`ops-companion/(app|src)/` 만. `..`·절대경로·`.env*`·`*.pem`·`google-services.json`·`*firebase-adminsdk*` 거부. 저장소가 public 이어도 **LLM 이 원하는 파일을 아무거나 읽는 구조**는 만들지 않는다
   - 줄 범위 상한(예: 한 번에 80줄) · 도구 호출 상한(예: 분석당 3회) · 결과도 LLM 입력이므로 `scrubText`
   - 도구 결과는 직렬화 인터셉터를 안 거친다(어시스턴트 §8-4) — 문자열로 만들어 넘긴다
5. **버전과 기록**
   - 버전 규칙 확장: 도구를 **실제로 한 번 이상 호출**했으면 v3(도구 없음 = few-shot 여부에 따라 v1/v2). few-shot 과 도구를 같이 쓰면? 비교 축이 섞인다 — 추천: **v3 = 도구만(few-shot off)** 으로 고정해 v1 과 1:1 비교, 둘 다 켠 조합은 이후
   - 새 컬럼 `tool_calls`(jsonb: `[{path, startLine, endLine, ok, bytes}]`) — "무엇을 보고 답했나". 원문 코드는 저장하지 않는다(GitHub 에 있다)
6. **호출 예산**
   - 도구 루프가 붙으면 분석 한 건이 LLM 2~4회다. 교정 재시도까지 겹치면 최악 8회. **분당 상한(`OPS_ANALYSIS_MAX_PER_MIN`, 기본 5)은 "분석 건수"라 RPM 15 를 넘길 수 있다** — 상한을 LLM 호출 수 기준으로 바꾸거나 기본값을 2~3 으로 낮춰라. 교정 재시도는 도구 루프가 끝난 뒤 **도구 없이** 형식만 다시 묻는다(추천)
   - 관리자 어시스턴트와 같은 키를 나눠 쓴다

### 재사용할 기존 자산 (새로 짜지 마라)

| 자산 | 위치 | 쓸모 |
|---|---|---|
| `generateWithTools` 도구 루프 | `backend/src/intrastructure/ai/`(Gemini 구현) · 호출 선례 `backend/src/admin/assistant/assistant.service.ts` | 루프·`thought_signature` 처리가 이미 돼 있다(§8-1). 델타를 모으기만 하면 된다 |
| 도구 정의·디스패처 패턴 | `backend/src/admin/assistant/assistant-tools.ts` | 중립 JSON Schema 로 정의, 실행은 호출 측 |
| 파서·교정 재시도·버전 규칙 | `backend/src/ops/ops-analysis.service.ts` · `dto/analysis.dto.ts` | 그대로. 최종 텍스트만 도구 루프에서 온다 |
| 평가 장치 | `ops-review.service.ts` · `backend/eval/ops-review-set.ts` · 앱 평가 탭 | v3 를 같은 test 세트로 채점 |
| judge 탈취 방어 문구 | `backend/eval/run-judge.ts` · few-shot 블록 격리 문구 | 도구 결과(코드) 속 주석이 지시문처럼 읽히는 것을 막는다 — **코드 주석은 사람이 아무거나 쓸 수 있다** |
| Redis 캐시 | `RedisService.getCache/setCache` | GitHub 응답 캐시 |
| span | `ops.analysis.llm` · 앱 `tracesSampler`(`ops.analysis*`) | 도구 호출을 자식 span `ops.analysis.tool` 로(접두어를 지켜야 샘플링된다) |

---

## 범위 밖

- 보강 후보 3번(이벤트 여러 건·태그 분포) · 4번(Slack 초안·GitHub 이슈 생성 같은 "행동")
- LLM 을 Claude 로 전환(env 한 줄이지만 비교 변수가 하나 더 는다 — 이번 비교가 끝난 뒤)
- 오프라인 평가 큐 · iOS · 스토어 배포 · EAS Update
- Slack `#sentry-errors` 복구

---

## 진행 방식

- 사용자는 **RN·AI 초행자이자 프론트엔드 개발자**다. tool use, 소스맵, release 같은 개념이 처음 나오면 한 줄로 풀고, 결정을 물을 때는 **먼저 코드와 짝지어 설명한 뒤** 추천을 붙여 물어라(Phase 4 에서 실제로 필요했다)
- 사용자는 AI 결과를 비판적으로 본다. Phase 4 의 "효과 없음"처럼 **기대와 다른 결과도 그대로 기록하라.** v3 가 좋아졌다면 어느 케이스에서 왜인지(읽은 파일 기록으로)까지
- 작게 나눠라: ① 도구 단독(백엔드 단위 테스트 + 실제 GitHub 스모크) → ② 파이프라인 전환(로컬 실인시던트 1건) → ③ 앱 카드 섹션(실기기) → ④ 평가 세트 → ⑤ 배포. ⚠ 확인 수단이 준비되기 전에 코드를 쌓지 마라
- DB 스키마는 마이그레이션으로만 → `index.ts` 명시 등록. `string | null` 컬럼은 `type:` 명시
- 커밋 전 `git branch` 확인. Phase 5 는 **main 에서 새 브랜치**(Phase 4 PR 머지 후). 커밋 메시지 초안을 보여주고 승인받아라. `git commit -F <파일>`
- ⚠ main 푸시 = Vercel 프론트 자동 운영 배포
- 네이티브 패키지는 넣지 않는 것이 목표다. 넣어야 하면 **설치 전에** 사용자에게 "재빌드 vs 없어도 안 죽게"를 묻는다(4편 6-9)

---

## 로컬 환경 함정 (Phase 4 에서 다시 확인된 것 포함)

- **`nx serve backend` 가 옛 `dist/main.js` 로 먼저 뜬다.** webpack 이 새 번들을 써도 node 는 재시작하지 않는다 → 새 라우트 404. 확인은 **시작 로그의 `Mapped {…}` 줄**. 해결은 cmd → watch-server → node 트리를 `taskkill /T` 로 통째 죽이고 다시 serve. 로그는 파일 리다이렉트
- **평가 스크립트(Nest 컨텍스트 부팅)는 1분 이상 걸리고**, 출력을 `| tail` 로 받으면 끝날 때까지 아무것도 안 보인다 → 파일 리다이렉트 + 백그라운드. `app.close()` 는 안 돌아와서 5초 race 후 `process.exit` 로 끝낸다(이미 반영). cwd 가 안 붙으면 `TS_NODE_PROJECT` 를 **절대경로**로
- Gemini `503 high demand` — 스크립트는 30초 재시도. 백엔드 경로(앱에서 누를 때)는 재시도 없이 에러다
- 백엔드 jest: Node 22 에서 `jest.config.ts` 파싱 실패 → 인라인 JSON config(메모리 `backend_jest_local_run`). `testMatch: ['**/src/ops/**/*.spec.ts']`
- e2e: `yarn nx e2e @shopping-mall/backend-e2e --testPathPatterns=mobile-token-and-ops`. 서버를 띄우지 않는다
- 앱 타입 검사는 루트에서 `npx tsc --noEmit -p ops-companion/tsconfig.json`(앱 폴더의 `yarn typecheck` 가 cwd 문제로 안 잡힐 때). 번들 확인은 `node node_modules/expo/bin/cli export --platform android`(앱 폴더에서)
- RN 0.86 타입에 `StyleSheet.absoluteFillObject` 가 없다
- 앱을 로컬 백엔드에 붙일 때: `ops-companion/.env` 의 `EXPO_PUBLIC_API_BASE_URL` 두 줄(운영/LAN IP `172.30.1.85`)을 주석으로 바꿔 끼우고 `yarn start --clear`. **끝나면 운영으로 되돌린다**
- ⚠ 로컬 백엔드와 운영 백엔드를 동시에 켜 두면 폴러가 둘이라 알림이 두 번 온다
- gh CLI 없음. GitHub 상태는 공개 API 를 curl 로
- Bash 도구 heredoc 안 파이썬의 `'\n'` 은 실제 개행이 된다 — `chr(92)` 또는 Write 도구. 긴 문서는 Write 도구로

---

## Phase 3·4 에서 확정돼 이번에도 유효한 것

| 항목 | 내용 |
|---|---|
| LLM 호출 | `LlmClient` 에 **프로바이더 어휘를 넣지 않는다**(JSON 모드 안 씀). 파서가 관대하게 읽고 엄격하게 검증 |
| 재시도 | 같은 질문 반복이 아니라 **교정 요청**(틀린 답 + 사유) |
| 비싼 동작 | 사용자가 눌렀을 때만. 화면 진입(캐시 HIT)은 LLM 을 부르지 않는다 |
| 강제 실패 | `simulate` 는 운영에서 무시. 집계는 `model='simulated'` 제외 |
| 마스킹 | LLM 에 넣는 텍스트는 전부 `scrubText` — few-shot 예시도, **도구 결과(코드)도** |
| 버전 | 프롬프트가 실제로 달라졌을 때만 버전이 바뀐다(이름표 오염 금지). 비교는 **같은 인시던트 세트 + 블라인드** |
| 방어 렌더링 | 앱은 필드마다 없을 수 있다고 보고 그린다(새 필드 `toolCalls` 도) |
| 트랜잭션 샘플링 | `tracesSampler` 이름 필터 — 새 span 은 `ops.analysis` 접두어 |

---

## Phase 가 끝나면

1. 학습 노트 **6편** `docs/learning/ops-companion/06-<영문-케밥>.md` — `README.md` "이어 쓰는 규칙" 대로, 목차 표 채움. 6장 함정은 실제로 밟은 것만
2. 설계 §9 Phase 5 에 진행·통과 기록(결정·함정·**v1/v2/v3 수치**)
3. **`infra-story.md` 를 고쳐 쓴다** — GitHub 이 새 외부 연결이다: **0-1 지도**(백엔드 → GitHub raw 선) · 3-4 · **5장**(토큰을 썼다면) · **6장**(GitHub 이 죽으면 → 분석은 도구 없이 v1 처럼 끝나야 한다) · 8장에서 이 행 제거 · 용어(tool use·소스맵 적용 경로·release) · 갱신 기록
4. `CLAUDE.md` §5 에 Phase 5 한 줄
5. **이 파일(`_next-session-phase5.md`)은 삭제한다.** 다음 인수인계는 사용자와 방향을 정한 뒤에
