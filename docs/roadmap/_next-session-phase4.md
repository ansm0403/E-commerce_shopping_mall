# 작업: Ops Companion Phase 4 — 평가 루프 (human-in-the-loop)

## 한 문장 목표

**AI 가 쓴 분석을 사람이 스와이프로 채점하고, 승인된 분석을 다음 프롬프트의 예시(few-shot)로 넣어, 프롬프트 v1 과 v2 의 품질 차이를 숫자로 보인다.**

Phase 3 은 "AI 가 쓴다"까지였다. Phase 4 는 "사람이 채점한 데이터로 AI 를 고친다"를 **측정 가능하게** 만드는 단계이고, 이 앱의 뼈대 서사(설계 §1.4 핵심 순환 고리)가 여기서 완성된다.

---

## 먼저 읽어라 (이 순서로)

1. `CLAUDE.md` §5 의 "RN Ops Companion" 항목들 — 특히 **Phase 3 구현** 줄. 지금 어디까지 됐는지
2. `docs/roadmap/ops-companion-design.md`
   - §9 **Phase 3** 기록 — 확정한 결정 7건, **"DoD 통과가 분석이 맞다는 뜻은 아니다"** 문단, **Phase 3 이후 보강 후보** 표
   - §9 **Phase 4** 정의(DoD) · §4.3 **S5 ReviewScreen** · §5.1 Phase 4 엔드포인트 2개 · §5.3 **`ops_reviews`** · §1.4 핵심 순환 고리
   - §10 작업 지침 · §3.4 의 "few-shot: 평가에서 승인된 과거 분석 상위 N개"
3. `docs/learning/ops-companion/04-ai-analysis.md` — 특히 **3장**(파서·교정 재시도·캐시 의미·useQuery/useMutation 분리)과 **6장 함정 9건**. 6-8(매끄럽지만 틀린 분석)은 이번 Phase 의 **동기**이고, 6-9(네이티브 패키지)는 **다시 밟으면 안 되는 것**이다
4. `docs/learning/ops-companion/infra-story.md` — 살아 있는 인프라 지도. 새 용어는 여기 용어 사전부터
5. `docs/roadmap/ex-ai-assistant.md` §5 Phase 7 · §8-13~15 — 관리자 어시스턴트의 **eval 루프 완주 서사**(도구 선택 94.1→100%, judge 무회귀). Phase 4 는 이 서사를 앱에서 한 번 더 만드는 것이다. 하네스 원본은 `backend/eval/`
6. `ops-companion/README.md`

코드는 이미 있다. 새로 만들지 말고 지금 코드에서 출발하라 — 파이프라인은 `backend/src/ops/ops-analysis.service.ts`, 화면은 `ops-companion/app/(tabs)/incidents/analysis/[id].tsx`.

---

## ⚠ 착수 전 선행 작업 — Phase 3 의 남은 배포 (이것부터)

Phase 3 은 **코드·실기기 DoD 완료, 배포 미완**이다. 브랜치 `feat/ops-ai-analysis`(원격 푸시됨) = `bd9f8b4` · `cf5c2a2` · `6418ef6` + 이 인수인계 커밋.

| # | 할 일 | 누가 | 비고 |
|---|---|---|---|
| 1 | PR 생성·머지(`feat/ops-ai-analysis` → `main`) | 사용자 | ✅ PR #33, main `89a02bc`(스쿼시) · CI 통과 |
| 2 | 운영 배포 | Claude | ✅ 2026-09-21 — 마이그레이션 1건 적용, health `89a02bc`, 회귀 없음 |
| 3 | EC2 `.env` 에 `GEMINI_API_KEY` 가 있는지 확인 | Claude | ✅ 있음(값은 출력하지 않고 존재만 확인). `NODE_ENV=production` 은 compose 가 넣는다 |
| 4 | ✅ Sentry span 확인 — 앱 `ops.analysis.request`(누른 만큼 기록, `ops.analysis.status=ok`, 다른 트랜잭션 없음) · 백엔드 `ops.analysis.llm` | 사용자 + Claude | 개발 모드는 앱 Sentry 가 꺼져 있다(`enabled: !__DEV__`). **preview 빌드 `aad289d2` + 운영 백엔드**에서 Performance 탭. 앱 시작·화면 이동 트랜잭션이 **없어야** 한다(`tracesSampler` 이름 필터). ⚠ 백엔드는 `instrument.ts` 의 `tracesSampleRate` 가 운영 **0.1** 이라 `ops.analysis.llm` 은 10% 만 남는다 — 안 보이면 샘플링 탓인지부터 본다 |
| 5 | ✅ 학습 노트 4편 0-3 표의 ⏳ 갱신, 설계 §9 Phase 3 을 "✅ 완료" 로 | Claude | |
| 6 | 앱 `ops-companion/.env` 를 운영 주소로 되돌림 | Claude | ✅ |
| 7 | 로컬 백엔드(4000) 종료 | Claude | ✅ (postgres·redis 컨테이너는 켜 둠) |
| 8 | `feat/ops-observability` 브랜치의 `docs/roadmap/_next-session-phase3.md` 정리 | 사용자 판단 | 그 파일은 main 에 없고 그 브랜치에만 있다(`aa7a653`). 브랜치를 지우면 끝 |

운영 배포 절차(설계 §10-6 / `03-infra-nginx-runbook.md` §10):

```bash
# [로컬] — 커밋이 main 에 머지된 뒤, main 에서
SHA=$(git rev-parse --short HEAD)
docker build --build-arg GIT_SHA="$SHA" -t ansmoon/shopping-mall-backend:latest -t "ansmoon/shopping-mall-backend:$SHA" -f Dockerfile .
docker push ansmoon/shopping-mall-backend:latest && docker push "ansmoon/shopping-mall-backend:$SHA"

# [EC2] ssh -i ~/.ssh/shoppingApp-key-v2.pem ubuntu@15.164.185.156 ; cd ~/Shopping-mall
docker compose -f docker-compose.prod.yaml pull backend
docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js   # ⚠ exec 가 아니다 — migrate.js 는 새 이미지 안에
docker compose -f docker-compose.prod.yaml up -d
docker compose -f docker-compose.prod.yaml exec -T nginx nginx -t && docker compose -f docker-compose.prod.yaml exec -T nginx nginx -s reload   # ⚠ 빠뜨리면 502
curl -s https://api.ansmoon.dev/v1/health   # version == 새 SHA
# 스모크: POST /v1/ops/incidents/1/analysis 가 401(라우트 존재) · /products·/categories 200(회귀 없음)
```

⚠ **운영 DB 를 직접 읽는 것은 권한 정책이 막는다**(Production Reads). 우회하지 마라. 운영 확인은 API·로그·앱 화면으로.

**2026-09-21 기준 1~7 완료.** 8번(옛 브랜치 정리)만 사용자 판단으로 남았다. **이 8개가 끝나야 Phase 3 이 닫힌다.** Phase 4 코드는 그 뒤에 시작한다(설계 §9 "이전 Phase 의 DoD 를 만족하기 전에 다음 Phase 코드를 작성하지 않는다").

---

## 현재 상태 (2026-09-21 기준)

### Phase 3 에서 만든 것 — Phase 4 가 그 위에 선다

- **`POST /v1/ops/incidents/:id/analysis`** — `getIncident` → `scrubText` 프롬프트 → `LlmClient.generate`(기존 인프라) → `parseAnalysis`(관대하게 읽고 엄격하게 검증) → 위반 시 사유를 실은 교정 재시도 1회 → `ops_analyses` 저장
- **`ops_analyses`** — id · incident_id · status(`ok`|`parse_failed`) · result_json(jsonb, §5.4 스키마) · raw_text · **prompt_version(`'v1'`)** · model · latency_ms · createdAt. **UNIQUE 없음** — 재분석마다 행이 쌓이고 "현재값"은 최신 행이다. 옛 행을 지우지 않아야 v1 vs v2 비교가 성립한다
- **`OpsAnalysisService.PROMPT_VERSION = 'v1'`** — 프롬프트(SYSTEM 또는 `buildUserPrompt` 형식)를 바꾸면 **반드시 올린다**
- **캐시 의미** — force 없는 요청은 이슈의 **최신 행을 상태·버전 무관하게** 반환. 재분석은 `{ force: true }` 뿐(앱 "다시 분석" 버튼)
- **분당 상한** `OPS_ANALYSIS_MAX_PER_MIN`(기본 5) → 429 · 이슈별 Redis 락 → 409 · LLM 키 없음 → 503 · `simulate:'parse_failed'`(비운영 전용)
- **앱 S4** `/incidents/analysis/[id]` — 구조화 카드 · fallback · 섹션별/전체 복사 버튼. `features/analysis/queries.ts` 의 `useAnalysis`(useQuery, `['analysis', incidentId]`) · `useReanalyze`(useMutation → `setQueryData`)
- **첫 실기기 분석은 틀렸다** — CORS 봇 이슈에 "`api.ansmoon.dev` 를 origin 허용 목록에 추가하라"(차단한 서버 자신을 허용하라는 오답), 확신도 "높음". **Phase 4 가 사람에게 이런 답을 반려할 수단을 준다.** 이 사례를 평가 데이터의 첫 반려 건으로 쓰면 서사가 선다

### 인프라 상태

- **운영 백엔드**: **`89a02bc`**(Phase 3, 2026-09-21 배포, `ops_analyses` 표 있음). EC2 `15.164.185.156`, `https://api.ansmoon.dev/v1`
- **폰**: Phase 3 마감 때 preview **`aad289d2`**(versionCode 3, main `89a02bc`, 운영 API)를 설치했다(개발 빌드 위 업데이트 설치를 안내했고 실패 보고는 없었다 — 삭제 여부는 확인하지 않았다). 운영 계정 `kirianir@naver.com` 으로 로그인돼 있다. 개발 빌드 `8f91794d`(versionCode **1**)는 그 전까지 쓰던 것이다
  - ⚠ **안드로이드는 versionCode 가 낮은 APK 로 덮어쓰기를 거부한다**("앱이 설치되지 않았습니다"). 모든 빌드가 같은 키스토어(`wl-nED5HQt`)를 쓰므로 서명 문제가 아니다 — Phase 3 에서 preview(2) 위에 개발 빌드(1)가 안 깔린 것도 이것이었다. 개발 빌드로 돌아가려면 **preview 를 삭제하고** 설치하거나, `eas build --profile development` 로 새 개발 빌드를 만든다(development 는 autoIncrement 가 꺼져 있어 여전히 1 이다 — 결국 삭제가 필요하다)
  - 개발 빌드는 Metro 에 붙어야 JS 가 돈다(`yarn start --clear`). preview 는 JS 가 APK 안에 있어 Metro 가 필요 없고 붙을 수도 없다
- **네이티브 모듈 현황**(APK 안에 있는가):
  | 패키지 | `8f91794d` 안에 | 비고 |
  |---|---|---|
  | `react-native-gesture-handler` ~2.32 · `react-native-reanimated` 4.5.1 · `react-native-worklets` | ✅ Phase 0 부터 | **스와이프에 쓸 수 있다. 재빌드 불필요** |
  | `expo-clipboard` ~57.0.2 | ❌ (빌드 후 설치) | `requireOptionalNativeModule` 로 방어돼 있어 안 죽는다. 다음 빌드부터 포함 |
  | 새로 넣을 패키지 | ❌ | ⚠ **설치 전에 네이티브인지 확인**하고, 네이티브면 사용자에게 "재빌드(EAS 20분) vs 없어도 안 죽게"를 먼저 묻는다(4편 6-9) |
- ⚠ **`GestureHandlerRootView` 가 앱 어디에도 없다.** gesture-handler 는 설치만 돼 있고 쓴 적이 없다. 스와이프를 쓰려면 루트(`app/_layout.tsx`)를 감싸야 한다 — 안 감싸면 제스처가 조용히 동작하지 않는다
- **로컬 DB 의 분석 행**: `ok` 3건(gemini-3.1-flash-lite) + `parse_failed` 2건(`model='simulated'`). **DoD 의 "평가 10건"에 재료가 모자란다**(아래 결정 ②)
- **Sentry 24h 인시던트**는 2~3건 수준이다. 분석 대상을 넓히려면 기간을 늘리거나 같은 이슈를 재분석해 행을 늘려야 한다
- 로컬 DB 관리자 `demo-admin@portfolio.local`(루트 `.env` `DEMO_ADMIN_PASSWORD`). 운영 관리자 `kirianir@naver.com`. **로컬·운영은 별개 DB**

---

## 이번 범위 (설계 §9 Phase 4)

- **DB** — `ops_reviews`(§5.3): id · analysisId(FK) · reviewerId(FK userId) · verdict(`approved`|`rejected`) · rating(1~5, nullable) · comment(text, nullable) · createdAt · **UNIQUE(analysisId, reviewerId)**. 마이그레이션으로만
- **백엔드**
  - `GET /v1/ops/analyses/pending` — 이 평가자가 아직 채점하지 않은 분석 목록
  - `POST /v1/ops/analyses/:id/review` — verdict·rating·comment 저장(같은 평가자 재평가는 upsert 인지 409 인지 **결정 필요**)
  - **few-shot 주입** — 승인된 분석 상위 N개를 프롬프트에 예시로 넣는다 → `PROMPT_VERSION = 'v2'`
  - **승인율 집계** — promptVersion 별 approved / (approved + rejected). 엔드포인트든 스크립트든 **숫자가 나오는 경로**가 있어야 DoD 를 증명할 수 있다
- **앱 S5 ReviewScreen**(§4.3 S5) — 하단 **탭 2 추가**(`(tabs)/_layout.tsx` 주석이 "평가 탭은 Phase 4" 라고 예약해 뒀다). 카드 스택, 오른쪽 스와이프=승인 · 왼쪽=반려, 별점 1~5, 진행 표시 "3 / 12". **낙관적 업데이트**(다음 카드 즉시, 저장은 백그라운드, 실패 시 롤백 + 토스트)
- **S4 → S5 연결** — 분석 화면 하단 "이 분석 평가하기" CTA(§4.3 S4 마지막 줄)
- **DoD** — 평가 **10건 이상** 축적 후, few-shot 적용 **전/후** 분석 품질 차이를 **스크린샷 또는 승인율 수치**로 비교할 수 있음

### 착수 전에 사용자와 정할 결정 (설계에 답이 없다)

코드를 쓰기 전에 이 넷을 사용자에게 묻고 설계 §9 Phase 4 에 기록하라. 각자 한 줄 추천을 붙여 물어라.

1. **비교 방법이 공정한가** — "v1 분석들의 승인율 vs v2 분석들의 승인율"을 서로 **다른 인시던트**로 재면 인시던트 난이도가 섞여 차이의 원인을 가릴 수 없다. 대안: **같은 인시던트 세트**를 v1·v2 로 각각 분석하고 평가자가 **버전을 모른 채**(블라인드) 채점. 카드에 promptVersion 을 숨길지도 이 결정에 달려 있다. 관리자 어시스턴트의 eval(골든셋 고정 → 프롬프트만 바꿔 재측정)과 같은 원리다
2. **평가 10건의 재료** — 24h 인시던트가 2~3건뿐이다. 선택지: (a) 인시던트 조회 기간을 늘린 분석 대상 목록 (b) 같은 이슈를 재분석해 행을 늘림(모델 비결정성으로 답이 매번 다르다 — 실측) (c) 과거 Sentry 이슈를 모은 **고정 평가 세트**. (c) 가 결정 ① 과도 맞물린다. Gemini **RPM 15** · 분당 상한 5 를 계산에 넣어라
3. **캐시와 버전** — 지금은 최신 행을 버전 무관하게 준다. v2 를 켠 뒤 v1 행이 있는 이슈를 열면 여전히 v1 이 보인다. "현재 PROMPT_VERSION 행이 없으면 새로 분석" 으로 바꿀지, 그대로 두고 재분석 버튼에 맡길지
4. **few-shot 선정과 누수** — "상위 N개"의 기준(별점? 최신? severity 다양성?), N 의 크기(토큰 비용), 그리고 **평가 대상 인시던트 자신의 승인 분석을 예시에 넣지 않는 것**(정답을 보여주고 시험 보는 셈). 예시도 LLM 입력이므로 `scrubText` 를 거쳐라. `parse_failed` 행은 평가 대상에서 뺄지(구조화 실패 자체를 "반려"로 셀지)

### 재사용할 기존 자산 (새로 짜지 마라)

| 자산 | 위치 | 쓸모 |
|---|---|---|
| 분석 파이프라인 · 파서 · span | `backend/src/ops/ops-analysis.service.ts` · `dto/analysis.dto.ts` | few-shot 은 `buildUserPrompt`/`SYSTEM` 에 예시 블록을 더하는 것. 나머지는 그대로 |
| `LlmClient` | `backend/src/intrastructure/ai/` | 그대로. `generate` 의 system `{static, dynamic}` — few-shot 을 static 에 두면 캐싱 친화(어시스턴트 Phase 6) |
| eval 하네스(골든셋 + 규칙 러너 + LLM-judge) | `backend/eval/` | 사람 평가를 **보조**하는 자동 채점. judge 가 사람과 어긋난 사례가 어시스턴트 §8-14 에 있다 — 사람 평가를 대체하지 말고 대조하라 |
| judge 파서·탈취 방어 | `backend/eval/run-judge.ts` | few-shot 예시 속 지시문을 따르지 않게 하는 격리 문구 선례 |
| `useQuery`/`useMutation` 분리 · `setQueryData` | `ops-companion/src/features/analysis/queries.ts` | 낙관적 업데이트는 `onMutate`(스냅샷) → `onError`(롤백) → `onSettled` 로 확장 |
| 카드 컴포넌트 | `ops-companion/src/features/analysis/AnalysisCard.tsx` | 평가 카드 본문에 그대로 쓸 수 있다(방어 렌더링 포함) |
| e2e 하네스 | `backend-e2e/src/backend/mobile-token-and-ops.e2e.spec.ts` | Phase 3 에서 E 절을 붙였다. F 절로 평가 API 를 이어 붙인다 |

---

## 범위 밖

- Phase 3 이후 **보강 후보**(설계 §9 표 — 소스 코드 읽기 tool use · 배포 맥락 · 이벤트 여러 건 · 행동). Phase 4 뒤에 한다
- Slack `#sentry-errors` 복구(설계 §3.3 💡 — 제안만)
- 오프라인 평가 큐(설계 §9 비목표 "확장 항목")
- iOS · 스토어 배포 · EAS Update

---

## 진행 방식

- 사용자는 **RN 초보이자 프론트엔드 개발자**다. 새 개념(Gesture Handler, Reanimated 의 shared value·worklet, 낙관적 업데이트, few-shot, 블라인드 평가)이 처음 나올 때 한 줄로 설명하라. 개념 질문에는 자세히 답하고 **문서와 실제 코드를 짝지어** 설명하라
- 사용자는 **AI 결과를 비판적으로 본다**(Phase 3 에서 "AI 가 하는 일이 빈약하지 않나"를 먼저 물었다). 과장하지 말고, 모델이 틀린 사례를 숨기지 말고 기록하라
- 설계 §10-2 대로 **작게 나눠** 단계마다 실기기로 확인하게 하라. ⚠ **확인 수단이 준비되기 전에 코드를 쌓지 마라**
- **패키지는 `npx expo install`**, 설치 뒤 `npx expo-doctor`. ⚠ **네이티브 패키지면 설치 전에 사용자에게 알리고 결정을 받아라**(4편 6-9 — 이번 세션에서 실제로 화면을 죽였다)
- **DB 스키마는 마이그레이션으로만.** 엔티티 → `nx run @shopping-mall/backend:migration:generate --name=<이름>` → **`src/database/migrations/index.ts` 에 명시적 등록**(글롭은 조용히 실패) → `migration:run`. `string | null` 컬럼은 `type:` 명시
- **커밋 전에 `git branch` 로 브랜치 확인.** Phase 4 는 **main 에서 새 브랜치**를 딴다(Phase 3 PR 머지 후). 커밋 메시지 초안을 먼저 보여주고 승인받아라. `git commit -F <파일>`
- ⚠ **main 에 푸시하면 Vercel 이 프론트를 자동 운영 배포한다**
- ⚠ **Bash 도구 heredoc 안의 파이썬에서 `'\n'` 은 실제 개행으로 바뀐다.** 문자열 리터럴에 백슬래시 시퀀스가 필요하면 `chr(92)` 로 조립하거나 Write 도구를 써라(이번 세션에서 TS 파일에 개행이 박혀 tsc 가 깨졌다)
- ⚠ 아주 긴 heredoc 은 잘린다. 큰 문서는 Write 도구로

---

## 로컬 환경 함정 (메모리에도 있다)

- **`nx serve backend` 는 코드를 바꿔도 node 를 재시작하지 않는다.** 백엔드를 고쳤으면 트리째 죽이고(`taskkill /PID <cmd.exe PID> /T /F`) 다시 띄운 뒤 시작 로그의 `Mapped {…} route` 로 확인. 로그는 **파일로 리다이렉트**(`| tail` 금지)
- 백엔드 jest 는 Node 22 에서 `jest.config.ts` 파싱이 실패한다. 우회: preset 을 인라인한 JSON config 를 스크래치에 만들어 `npx jest --config <json>`(메모리 `backend_jest_local_run`). `testMatch: ['**/src/ops/**/*.spec.ts']` 로 좁히면 7초
- 프론트/앱 jest 는 `--testPathPatterns`(복수형). backend-e2e 는 `yarn nx e2e @shopping-mall/backend-e2e --testPathPatterns=mobile-token-and-ops` 로 돈다
- `tsc -p backend/tsconfig.app.json` 에는 원래 있던 오류가 있다. 바뀐 파일만 걸러 보라(`| grep -E 'src/ops'`)
- 전역 `ValidationPipe` 가 `enableImplicitConversion: true` 다 — `@IsBoolean()` 에 문자열 `'yes'` 가 오면 `true` 로 통과한다. 400 을 기대하는 테스트를 짤 때 주의(4편 6-1)
- `@Inject(TOKEN)` 로 인터페이스 타입을 주입받으면 `import type` 이어야 한다(TS1272, 4편 6-2)
- backend-e2e 는 서버를 띄우지 않는다. postgres·redis + `nx serve backend` 가 떠 있어야 한다. 로그인은 IP 당 10회/5분
- Windows 콘솔(cp949)에서 한글이 깨져 보여도 데이터는 멀쩡할 수 있다. DB 를 직접 조회해 확인(4편 6-7)
- 앱을 로컬 백엔드에 붙일 때: 앱 `.env` 를 PC LAN IP(`172.30.1.85` — `ipconfig` 로 확인)로 → **`yarn start --clear`**(`EXPO_PUBLIC_*` 는 번들 때 박힌다). 폰과 PC 가 같은 Wi-Fi
- ⚠ **로컬 백엔드와 운영 백엔드를 동시에 켜 두지 마라** — 폴러가 둘이라 알림이 두 번 온다
- **QR 이 두 종류다.** expo.dev 빌드 페이지 QR = APK 설치(껍데기), `yarn start` 터미널 QR = Metro 주소(알맹이). 번들 고장 진단: `curl -s -o /dev/null -w "%{http_code}" "http://localhost:8081/ops-companion/node_modules/expo-router/entry.bundle?platform=android&dev=true"` 가 200 인지
- gh CLI 가 없다. GitHub 상태는 공개 API 를 curl 로

---

## Phase 3 에서 확정돼 이번에도 유효한 것

| 항목 | 내용 |
|---|---|
| LLM 호출 | `LlmClient` 인터페이스에 **프로바이더 어휘를 넣지 않는다**(JSON 모드 안 씀). 파서가 관대하게 읽고 엄격하게 검증한다 |
| 재시도 | 같은 질문 반복이 아니라 **교정 요청**(틀린 답 + 사유). 총 2회 — RPM 15 |
| 비싼 동작 | **사용자가 눌렀을 때만.** 화면 진입이 몰래 LLM 을 부르지 않는다 |
| 강제 실패 | `simulate` 는 `NODE_ENV=production` 에서 무시. 운영 DB 에 가짜 행이 쌓이면 통계가 오염된다 — Phase 4 집계는 `model='simulated'` 행을 **반드시 제외**하라 |
| 트랜잭션 샘플링 | `tracesSampler` **이름 필터**(`ops.analysis*` 만). 새 span 을 만들면 이 접두어를 따르거나 필터를 넓혀라 |
| 마스킹 | LLM 에 넣는 텍스트는 전부 `scrubText`. few-shot 예시도 입력이다 |
| 방어 렌더링 | 서버가 검증했어도 앱은 필드마다 없을 수 있다고 보고 그린다 |
| 네이티브 패키지 | 설치 전에 판별(`build/` 에 `requireNativeModule`). 없어도 안 죽게 짜거나 재빌드를 사용자와 정한다 |

Phase 2 에서 확정된 것(Sentry `release` 미지정 · 소스맵은 debug 아닌 빌드만 · beforeSend 상한 · `screen` 태그는 `useSegments` · sessions 조회에 `project`+`interval` 필수 · 생체 잠금은 덮개)도 그대로 유효하다 — 설계 §9 Phase 2 표.

---

## Phase 가 끝나면

1. 학습 노트 **5편** `docs/learning/ops-companion/05-review-loop.md` 를 `docs/learning/ops-companion/README.md` 의 "이어 쓰는 규칙" 대로 쓰고 목차 표를 채운다. 4편과 같은 장 구성, 6장 함정은 실제로 밟은 것만
2. 설계 문서 §9 Phase 4 에 진행·통과 기록(결정·함정·**v1 vs v2 수치**)
3. **`infra-story.md` 를 고쳐 쓴다**(덧붙이지 말고) — 8장 "앞으로 바뀔 것" 의 Phase 4 행: `ops_reviews` 표 추가로 **3-4 · 4-5 표**. 비밀값이 늘면 5장·6장도. 끝낸 항목은 8장에서 지우고 갱신 기록에 한 줄
4. `CLAUDE.md` §5 에 Phase 4 한 줄
5. **이 파일(`_next-session-phase4.md`)은 삭제한다.** v1 의 마지막 Phase 이므로 다음 인수인계 파일은 사용자와 방향(보강 후보 · 새 트랙)을 정한 뒤에 만든다
