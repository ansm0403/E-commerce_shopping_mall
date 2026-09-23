# 부록: 외부 배포 — 포트폴리오 방문자가 설치해 써 보게

> 설계 문서 §9 **"외부 배포"**(Phase 가 아니라 이력서 전 마감 작업). 작성 시점: 2026-09-23, 브랜치 `feat/ops-public-demo`.
> 앞 편: [9편 고리 닫기](./09-closing-the-loop.md). 이 부록은 9편까지 만든 앱을 **남이 쓰게 하는** 이야기다 — 새 기능이 아니라 경계와 배포.

## 0-1. 한 문장

안드로이드 폰 하나로 PC 없이 설치해(`preview` APK) 로그인 화면의 **"데모 계정으로 체험하기"** 를 누르면 실제 운영 Sentry 데이터로 인시던트 → AI 분석 → 채점까지 돌아보되, 외부인이 **쿼터를 태우거나·공용 데이터를 덮어쓰거나·운영 장애 푸시를 받는** 길은 백엔드가 토큰 하나(`isDemo`)로 막는다.

## 0-2. 무엇이 문제였나

- 웹 쇼핑몰에는 방문자용 데모 관리자(`DEMO_ADMIN_*`, `is_demo=true`)와 `DemoAccountGuard` 가 있었다. 앱은 관리자 role 만 로그인할 수 있으니 **같은 계정이 앱에도 들어온다.** 그런데 `ops` 컨트롤러는 "로컬 관리자가 데모 계정이라 걸면 개발이 막힌다"는 이유로 `DemoAccountGuard` 를 **한 곳도** 걸지 않았다 — 방문자가 재분석을 연타하면 무료티어 LLM 쿼터가 타고, 스와이프 한 번이 few-shot 예시 풀에 들어가고, 폰을 등록하면 며칠 뒤 운영 장애 푸시가 그 폰으로 간다.
- 지금까지 실기기 확인은 **개발 빌드**(PC 의 Metro 에서 JS 를 받는다)로만 했다. 방문자가 앱을 켜면 "서버를 고르라"는 런처에서 멈춘다.
- 사용자는 RN 이 처음이라 배포 방식 다섯 가지의 차이를 모른다. 설계 결정은 위임돼 있다 — 선택지 나열이 아니라 추천 하나와 이유.

## 0-3. 결과

| 무엇이 되는가 | 검증 |
|---|---|
| **배포**: EAS `preview` 프로필 APK(JS 내장, 소스맵 업로드, versionCode +1) + 내부 배포 링크/QR. **EAS Update** 도입(채널 `preview`) — 화면 코드만 바뀌면 재설치 없이 반영 | ✅ `eas update:configure` · preview 빌드(실기기 설치는 사용자) |
| **계정**: 로그인 화면 "데모 계정으로 체험하기" → `POST /auth/demo-login`(웹 버튼과 같은 경로). 컨트롤러가 `X-Client: mobile` 을 존중해 body 로 refreshToken | ✅ 컨트롤러 단위 2 · e2e G-1 |
| **경계**(표 아래): 목록 14d · 분석은 저장분 + 새 분석 시간당 6건, force/simulate 403 · 채점은 저장되나 집계·few-shot 제외 + 대기 목록 항상 전체 · 메모 PUT 403 · 기기 미저장 + 폴러 제외 | ✅ 단위 239(ops 9 스위트 + auth.controller) · e2e G 절 6건 · 앱 tsc |
| **방문자 경험**: 로그인 화면 한 줄 소개 · 탭 화면 배너 · 빈 목록 문구 · "다시 분석" 버튼 숨김 · 푸시 칸 "꺼짐 — 데모 계정은…" | ✅ 코드 · ⏳ 실기기(사용자) |
| DB 변경 **0** · 새 비밀값 **0** · 새 네이티브 패키지 1(`expo-updates` → 빌드 필요) | — |

## 1. 배포 방식 다섯 가지 — 무엇이 다른가

앱은 두 겹이다(infra-story 1-1): 네이티브 껍데기 ①과 JS 번들 ②. 배포 방식은 **②를 어디서 가져오느냐**로 갈린다.

| 방식 | ② 의 위치 | 방문자가 켜면 | 왜 제외/선택 |
|---|---|---|---|
| Expo Go | 내 PC 의 Metro | QR 을 찍어야 하고 PC 가 켜져 있어야 한다 | ✗ 푸시 불가(SDK 53+), PC 의존 |
| 개발 빌드 | 내 PC 의 Metro | 서버 선택 런처에서 멈춘다 | ✗ PC 의존 — 지금까지의 확인 방식 |
| **preview 빌드** | **APK 안** | 바로 로그인 화면 | **✓** 링크/QR 설치, 소스맵 업로드, 진짜 앱처럼 동작 |
| Play 내부 테스트 | `.aab` 안 | 스토어에서 설치 | ✗ 유료 개발자 계정·심사·테스터 이메일 등록, 스토어는 비목표(설계 §9) |
| EAS Update | expo.dev 의 채널 | 설치된 앱이 다음 실행 때 새 ② 를 받는다 | ✓ preview 의 **동반자** — 설치 링크가 빌드마다 바뀌므로 JS 수정마다 재설치를 시키지 않으려면 필요 |

**EAS Update 를 지금 넣은 이유**는 비용이 지금 가장 싸기 때문이다. `expo-updates` 는 네이티브 모듈이라 넣는 순간 빌드가 필요한데, 어차피 2026-09-21 이후 JS 가 많이 바뀌어 새 preview 빌드를 만들어야 했다. 설정은 `npx expo install expo-updates` + `eas update:configure` 두 명령 — `app.json` 에 `updates.url`·`runtimeVersion:{policy:'appVersion'}`, `eas.json` 프로필마다 `channel` 이 생긴다. 새 비밀값은 없다(expo.dev 가 업데이트도 나르고, 올리는 것은 로그인된 CLI).

> `eas update:configure` 가 `android.permissions` 에 생체 인증 권한을 **중복으로 두 번** 써 넣었다(플러그인이 이미 넣는 값). 지웠다 — 플러그인이 prebuild 때 다시 넣는다.

규칙 두 줄: **네이티브가 바뀌면 빌드**(패키지·플러그인·권한), **화면만 바뀌면 `eas update --channel preview`**. `runtimeVersion` 이 `appVersion` 이라 네이티브를 바꿀 때 `app.json` 의 `version` 을 올려야 옛 APK 가 새 JS 를 받아 죽지 않는다.

## 2. 계정 — 버튼인가, README 의 계정인가

README 에 이메일·비밀번호를 적으면 (1) 봇이 긁어 로그인 레이트리밋(IP 당 10회/5분)을 남의 IP 로 태우고 (2) 비밀번호를 바꾸면 문서·앱이 함께 낡는다. 웹은 이미 **버튼**(`POST /auth/demo-login`, 서버의 `DEMO_LOGIN_ENABLED`)이었다. 앱도 같은 경로를 쓴다.

바꾼 것은 컨트롤러 한 줄이다. `demoLogin` 이 `X-Client` 헤더를 받지 않아 body 에 refreshToken 이 없었고, 그러면 앱은 15분 뒤 갱신에 실패해 로그아웃된다(설계 §5.6). `buildTokenResponse(result, client)` 로 `login`·`refresh` 와 같은 분기를 태웠다 — 헤더가 없으면 웹은 100% 그대로다.

앱 쪽은 `AuthContext.signInDemo` 가 `signIn` 과 같은 `adopt`(토큰 저장 → user → Sentry 태그)를 탄다. 데모 로그인의 실패는 401 이 아니라 **403**(서버가 데모를 껐다)이라 문구를 따로 뒀다.

## 3. 경계 — 엔드포인트마다 무엇을 열고 무엇을 막았나

원칙은 하나였다. **조회는 그대로, 이 앱의 핵심 장면(AI 분석·스와이프 채점)은 되게 하되, 쿼터·공용 데이터·외부 푸시는 막는다.** 통째로 `DemoAccountGuard` 를 건 곳은 메모 PUT 하나뿐이고 나머지는 "데모 전용 분기"다.

| 엔드포인트 | 처리 | 이유 |
|---|---|---|
| `GET /ops/incidents` | 데모 전용 분기 — 기간 24h → **14d**, 응답 헤더 `X-Period` | 온콜 앱의 24h 는 조용한 날 빈 화면이다. 캐시 키가 기간별(`ops:incidents:14d`)이라 관리자 목록과 섞이지 않는다 |
| `GET /ops/incidents/:id` · `release-health` | 그대로 | 조회 전용. 상세는 이미 `scrubText`(이메일·전화) + request/user entry 미전달 + breadcrumb URL 의 쿼리스트링 제거(검색어·토큰) |
| `POST …/analysis` | 데모 전용 분기 — 저장된 분석은 그대로, **아직 없는 인시던트는 새로 분석 가능**(시간당 `OPS_ANALYSIS_DEMO_MAX_PER_HOUR` 기본 6, 방문자 합산 — Redis `checkRateLimit`), `force`·`simulate` 는 **403** | 통째로 막으면 처음 열린 인시던트에서 체험이 끝난다. 상한 두 겹: 분당 LLM 호출(서버 전체 벽, 기존)과 시간당 새 분석(외부인이 **일일** 쿼터를 태우는 것을 막는 벽). 403 검사는 LLM 키·Sentry 확인보다 앞이라 키 없는 서버에서도 같은 답(e2e 결정성) |
| `GET /ops/analyses/pending` | 데모 전용 분기 — `listPending(showAll)`: 판정 유무 조건 두 개를 빼고 항상 전체(최신 1장 규칙은 그대로) | 방문자 모두가 **한 계정**이다. "내가 채점한 카드"를 빼면 두 번째 방문자부터 빈 화면 |
| `POST /ops/analyses/:id/review` | 그대로 저장(upsert) — 단 집계·few-shot·S4 요약에서 **제외** | 저장을 막으면 스와이프가 실패 토스트로 끝난다. 대신 `HUMAN_REVIEWER`(`NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.reviewer_id AND u.is_demo)`)를 stats 의 JOIN 조건·`selectFewShot` 의 WHERE 에 넣었다. DB 변경 없이 `users.is_demo` 로 가른다. `summarizeReviews` 는 `relations: { reviewer }` 로 읽어 데모 행을 걸러 세되, 요청자 자신의 판정(`mine`)은 데모여도 보여준다 |
| `GET /ops/analyses/stats` | 그대로(위 제외가 적용된 숫자) | 앱 화면이 없다 |
| `PUT …/note` | **`DemoAccountGuard`** | 모든 카드와 S4 에 "정답"으로 붙는 공용 데이터. 앱에 편집 화면이 없어 체험에서 잃는 것이 없고, 로컬 seed 는 스크립트가 DB 로 직접 넣는다 |
| `POST /ops/devices` | 데모 전용 분기 — 저장하지 않고 `{registered:false, reason:'demo'}`(201) + **폴러**가 `user.isDemo=false` 인 토큰만 읽는다 | 403 은 앱이 켤 때마다 나는 에러가 된다. 폴러 필터는 이중 방어 — 옛 행이 남아 있어도 외부 폰에는 보내지 않는다 |
| Sentry 테스트 버튼 · 생체 잠금 | 그대로 | 앱 자신의 Sentry 프로젝트(DSN 은 공개값, `beforeSend` 60초 1건) · 기기 안에서만 처리 |

**왜 `DemoAccountGuard` 를 더 걸지 않았나.** 가드는 403 하나만 안다. 분석과 채점은 "되긴 되되 다르게" 여야 했고, 그 "다르게"(기간·상한·집계 제외·전체 카드)는 서비스 안에서만 표현된다. 그리고 로컬 개발 관리자가 데모 계정인 사정은 그대로다 — 이제 막히는 것은 메모 PUT 하나이고 그것은 스크립트가 대신한다.

**밟은 함정.** `listPending` 의 SQL 에서 평가자 조건을 빼자 `$1`(정수)이 어디에도 안 쓰여 `bind message supplies 3 parameters, but prepared statement requires 2` 가 될 자리였다. md5 셔플이 문자열 `$2` 를 따로 받고 있었는데, `$1::text` 로 합쳐 파라미터를 둘로 줄였다(단위 테스트의 `params` 단언도 `[42, 50]` 으로).

## 4. 방문자 경험 — 첫 화면부터 빈 화면까지

1. **로그인 화면**: 제목 아래 한 줄 — "쇼핑몰 운영자용 온콜 앱 — Sentry 장애를 보고, AI 가 소스 코드를 읽어 원인을 분석하고, 사람이 그 답을 채점합니다." 그리고 버튼 두 개(로그인 · 데모 계정으로 체험하기)와 힌트("데모 계정은 … 푸시·메모 저장·재분석은 꺼져 있습니다").
2. **목록**: 실제 운영 Sentry 데이터. 저장소가 public 이라 파일 경로·스택은 공개 정보고, 사람 정보는 백엔드가 지운다(위 표). 헤더가 "최근 14일 · N건". 탭 화면(목록·평가·프로필) 위에 배너 한 줄 — `features/demo/DemoBanner`(`useIsDemo` = `user.isDemo`). 배너는 **안내**다. 권한은 항상 백엔드가 정한다(설계 §7).
3. **조용한 날**: 14d 로도 비면 "조용합니다 … 평가 탭에서 지난 인시던트의 AI 분석은 볼 수 있습니다." 평가 탭은 데모에게 항상 전체 카드라 비지 않는다(분석 행이 0 이 아닌 한).
4. **분석 화면**: "다시 분석" 버튼과 `[DEV]` 버튼을 데모에게는 그리지 않는다. 서버가 403 을 주더라도(예: 옛 앱) 문구는 서버 메시지 그대로("데모 계정에서는 다시 분석할 수 없습니다…"). 시간당 상한 429 도 서버 문구.
5. **프로필**: 푸시 칸 "꺼짐 — 데모 계정은 장애 알림을 받지 않습니다"(백엔드의 `registered:false` 를 `PushRegistration` 의 `unsupported/demo` 로).

> 배너를 탭 레이아웃 위에 한 번만 두려 했다가 접었다. `SafeAreaView(top)` 을 Tabs 밖에 두면 배너가 없어도 상태바 높이만큼 여백이 생기고, 있으면 아래 네이티브 스택 헤더가 상태바 인셋을 한 번 더 넣어 틈이 생긴다. 화면 세 곳의 ScrollView/List 헤더 안에 넣는 것이 레이아웃 함정이 없다.

## 5. 검증

| 무엇 | 어떻게 |
|---|---|
| 백엔드 단위 239(10 스위트) | `ops.service`(14d·캐시 키·기기 미저장) · `ops-analysis.service`(403·상한·env) · `ops-review.service`(showAll SQL·HUMAN_REVIEWER·summarize 제외) · `ops-poller.service`(find where user.isDemo=false) · `auth.controller`(demo-login 웹/모바일) |
| e2e `mobile-token-and-ops` **G 절 6건** | is_demo 사용자를 만들어 실 HTTP 로: demo-login 모바일/웹 분기 · 기기 201+행 없음 · force/simulate 403+행 수 불변 · 메모 403 · `X-Period` 14d/24h · 채점 저장 → pending 그대로 → stats 제외 → 관리자 pending 불변 |
| 앱 | `yarn typecheck` · preview 빌드 실기기(사용자) |
| 운영 확인이 남은 것 | 데모 계정이 운영 DB 에 있고 `DEMO_LOGIN_ENABLED=true` 인지 — 이 세션은 운영 조회(SSH·데모 로그인 호출)가 차단돼 확인하지 못했다. 웹 로그인 화면의 "관리자 페이지 체험하기" 가 되면 앱도 된다(같은 API) |

## 6. 이력서에 쓸 때

- "설치해서 써 볼 수 있다"는 말은 preview 빌드 링크가 살아 있고 백엔드가 이 브랜치 이후 버전일 때만 참이다(데모 로그인의 모바일 분기가 그 이후다).
- 숫자 과장 금지: 시간당 6건·14일은 **정책값**이지 측정치가 아니다.
- 방문자가 만든 분석 행은 관리자의 평가 대기 목록에 그대로 들어온다(정상 — 판정 없는 새 분석은 원래 나온다). 방문자의 판정은 stats 에 없으므로 이력서의 채점 수치는 오염되지 않는다.
