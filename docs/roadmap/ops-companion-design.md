# Ops Companion — 설계 문서 (v2.1 · 관측 실측 반영)

> **v1 → v2 (2026-09-15)**: v1 은 쇼핑몰 코드를 보지 못한 상태에서 쓴 설계도였다.
> v2 는 실제 저장소·백엔드 코드와 대조해 `[확인 필요]` **14건 중 10건을 확정**했고,
> nginx/HTTPS 트랙([03-infra-nginx.md](./03-infra-nginx.md) v2 · 2026-09-15 완주)의 결과를 반영했다.
>
> **v2 → v2.1 (2026-09-16)**: 관측 체계 실측([ex-observability-map.md](./ex-observability-map.md))의 결과를 반영했다.
> 변경 셋 — ① **푸시 파이프라인을 webhook 수신에서 API 폴링으로 전환**(§3.3, Sentry 무료 플랜 실측 근거)
> ② **Sentry 무료 플랜 경계선 확정**(§6 — 이 계획에 영향 없음) ③ **§11 에 전제 4건 갱신**(그중 하나는 이미 해소됨).
>
> 남은 `[확인 필요]` 는 **3건**이고 전부 "설치 시점에 공식 문서로 확인해야 하는 것" 이다 —
> ① 라이브러리 버전(§2) ② 내비게이션 라이브러리 선택(§4.1) ③ 소스맵 업로드 가이드(§6).
> *(v2 의 ③ "Sentry webhook 서명 검증" 은 폴링 전환으로 **과제 자체가 사라졌다**.)*
>
> **가장 큰 변경**: refresh token 이 "있으면 연동, 없으면 Phase 2 로 미룸" 이라는 **선택 과제에서
> Phase 0 필수 + 백엔드 변경 동반으로 승격**됐다(**§5.6**). accessToken 수명이 15분이라, refresh 없이는
> Phase 0 의 DoD("앱 재시작 후에도 로그인 유지")를 애초에 만족할 수 없기 때문이다.
>
> **이 문서를 읽는 Claude Code에게**
>
> 1. 구현 전 **§11(물려받은 전제)과 §5.6(모바일 토큰 전략)을 먼저 읽어라.** 백엔드를 먼저 손대야 앱이 성립한다.
> 2. 남은 `[확인 필요]` 3건은 설치 시점에 공식 문서로 확인해 채워라(위 ①~③).
> 3. Phase DoD 게이트를 지켜라 — 이전 Phase 의 DoD 를 만족하기 전에 다음 Phase 코드를 쓰지 않는다.
>
> **사용자 컨텍스트**: 사용자는 React Native 경험이 없는 신입/초보 개발자다.
> 구현 시 각 단계에서 "무엇을 왜 하는지"를 설명하며 진행하고, 한 번에 큰 변경을
> 만들지 말고 작은 단위로 나눠 확인받으며 진행하라.

---

## 1. 프로젝트 정의

### 1.1 한 줄 정의

**"AI가 장애를 분석하고, 사람이 그 분석을 평가하며, 전 과정을 Sentry로 관측하는 모바일 온콜(on-call) 대응 앱"**

### 1.2 목적

- 사용자의 React Native 역량 확보 (첫 RN 프로젝트)
- Sentry 기반 프론트엔드 관측성(observability) 심화 경험
- AI 도메인(구조화 출력, human-in-the-loop 평가) 경험
- 기존 쇼핑몰 백엔드(NestJS) 재사용을 통한 end-to-end 이해 증명

### 1.3 포지셔닝 (무엇이 아닌가)

- 관리자 웹 페이지의 단순 모바일 이식이 **아니다**. 반응형 웹으로 대체 가능한 형태를 피한다.
- 핵심 정체성은 **웹으로 불가능한 네이티브 능력**: 푸시 알림 → 딥링크 진입, 생체 인증, 스와이프 제스처 평가.
- AI는 "챗봇"이 아니라 **"구조화된 분석 생성 + 사람의 평가 루프"**로 쓴다.

### 1.4 핵심 순환 고리 (이 앱의 뼈대 서사)

```
① 인시던트 발생 (Sentry가 쇼핑몰/앱 에러 수집)
        ↓
② AI 분석 (원인·조치를 구조화된 JSON으로 생성)
        ↓
③ 사람 평가 (스와이프 승인/반려 + 별점)
        ↓
④ 평가 데이터 축적 → 프롬프트/few-shot 예시 개선
        ↺ (②로 피드백)

Sentry는 이 전 과정이 도는 동안 "앱 자체의 건강"
(크래시, AI 응답 지연/실패)을 관측한다.
```

**중요한 개념 구분 (구현 시 혼동 금지):**

- Sentry의 역할 A (소비자 관점): 쇼핑몰 에러를 **가져와** AI 분석의 재료로 쓴다.
- Sentry의 역할 B (생산자 관점): 이 RN 앱 **자신의** 크래시/성능도 Sentry에 보고한다.
- "AI 개선"은 모델 재학습이 **아니다**. 외부 AI API를 쓰므로 모델은 못 고친다.
  개선 대상은 **프롬프트, few-shot 예시 선별, 저품질 응답 필터링** 등
  "AI를 다루는 우리 시스템"이다.

---

## 2. 기술 스택

| 영역 | 선택 | 비고 |
|------|------|------|
| 앱 프레임워크 | React Native + **Expo (managed workflow)** | bare RN 금지. 첫 RN 프로젝트이므로 EAS Build/Notifications/OTA를 Expo에 위임 |
| 언어 | TypeScript | 기존 프로젝트와 타입 공유 목표 |
| 서버 상태 | TanStack Query | 기존 웹에서 사용 중. `staleTime` 기반 캐싱 필수 |
| HTTP | axios | 기존 service/ 레이어 재사용. 요청 인터셉터로 JWT 자동 첨부 |
| 인증 저장 | expo-secure-store | JWT는 반드시 SecureStore. AsyncStorage에 토큰 저장 금지 |
| 전역 인증 상태 | React Context (`AuthContext`) | 로그인 상태 정도는 Context가 정석. 상태가 늘면 Zustand 검토 |
| 관측성 | @sentry/react-native | 소스맵, Release Health, beforeSend 포함 |
| 푸시 | Expo Notifications + EAS | Phase 1 |
| 생체 인증 | expo-local-authentication | Phase 2 |
| AI | 외부 AI API (Claude / Gemini 등) | **호출은 반드시 백엔드 경유** (7장 보안 원칙) |
| 백엔드 | 기존 NestJS 재사용 | 신규 엔드포인트만 추가 (6장) |

**확정(2026-09-15)**: 기존 프로젝트는 **Nx 21 + Yarn berry 4.10.3 모노레포**이며, `package.json` 의 workspaces 는
`['packages/*', 'frontend', 'frontend-e2e', 'backend', 'backend-e2e', 'shared', 'mocks']` 다.
공유 타입 패키지 **`@shopping-mall/shared` 는 실재**한다(빌드 산출물 `dist` 를 소비하므로 앱에서 쓰기 전 `nx build shared` 가 선행돼야 한다).

- ⭕ **Metro 에 유리한 조건**: `.yarnrc.yml` 의 `nodeLinker: node-modules` — **Yarn PnP 가 아니다.**
  PnP 였다면 Metro 번들러가 모듈을 못 찾아 초기 세팅이 크게 어려웠을 것이다.
- ⚠ 다만 `nmHoistingLimits: none` 으로 의존성이 루트에 호이스팅되므로, Metro 설정에
  **`watchFolders`(저장소 루트) + `nodeModulesPaths`(앱·루트 양쪽)** 를 명시해야 한다.
- **Nx 타깃 편입 여부 — v1 에서는 하지 않는다.** 워크스페이스에만 추가해 의존성/타입을 공유하고
  실행은 Expo CLI 로 한다(Expo+Metro 와 Nx 조합은 설정 부담이 크고, 첫 RN 프로젝트의 학습 목표와 무관하다).

`[확인 필요: 라이브러리 버전은 문서에 고정하지 않았다. 설치 시점의 Expo SDK 최신
안정 버전과 그에 호환되는 버전을 공식 문서로 확인해 선택하라.]`

---

## 3. 시스템 아키텍처

### 3.1 전체 구조

```
┌─────────────────────────────────────────────────────────────┐
│                      Ops Companion (RN 앱)                   │
│  - 화면/UX 전담. DB·Sentry API·AI API에 직접 접근하지 않는다  │
│  - @sentry/react-native로 자기 자신의 에러/성능을 보고        │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS + JWT (Authorization: Bearer)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   기존 NestJS 백엔드 (재사용 + 확장)          │
│  - 인증(JWT 발급/검증): 기존 로직 그대로                      │
│  - 신규: 인시던트 조회 프록시, AI 분석, 평가 저장, 푸시 발송   │
│  - 모든 외부 비밀키(Sentry 토큰, AI API 키)는 여기에만 존재    │
└───────┬──────────────┬──────────────┬───────────────────────┘
        │              │              │
        ▼              ▼              ▼
   기존 쇼핑몰 DB   Sentry API      외부 AI API
   (기존 그대로)   (인시던트 조회)  (분석 생성)
```

**절대 규칙:**

1. 앱은 DB에 직접 접속하지 않는다. 항상 백엔드 API를 경유한다.
2. Sentry API 토큰, AI API 키를 **앱 코드/환경변수에 절대 넣지 않는다**.
   앱 바이너리는 디컴파일로 노출된다. 키는 백엔드에만 둔다.
3. 앱에 넣어도 되는 것: 백엔드 base URL, Sentry **DSN**.
   **확정(2026-09-15)**: DSN 은 공개돼도 되는 값이고 이미 쇼핑몰 프론트/백엔드에 포함돼 운영 중이다 → **앱에 포함 OK**.

### 3.1-1 백엔드 접속 정보 (2026-09-15 확정)

- **Base URL: `https://api.ansmoon.dev/v1`** — EC2 의 nginx 가 TLS 를 종단하고 `backend:4000` 으로 프록시한다.
  ⚠ 이 문서의 모든 `/ops/*` 경로는 **실제로 `/v1/ops/*`** 다(NestJS 전역 prefix `v1`).
- **앱은 Vercel 을 거치지 않고 nginx 에 직접 붙는다.** 여기서 따라오는 3가지:
  - **CORS 는 앱과 무관하다** — 모바일은 `Origin` 헤더를 보내지 않으므로 백엔드 `CORS_ORIGINS` 검사에 걸리지 않는다(웹 전용 이슈).
  - **클라이언트 IP 가 정확히 기록된다** — 앱은 nginx 기준 1홉이라 `TRUST_PROXY_HOPS=1` 에서 진짜 IP 가 남는다(웹 경로의 IP 복원 과제와 무관).
  - **Android 평문 차단이 해소됐다** — 백엔드 HTTPS 확보가 이 앱의 선행조건이었고, Phase 0 DoD 의 "실기기(안드로이드)" 가 성립하는 근거다.

### 3.2 백엔드가 프록시(중개자)여야 하는 이유 (구현 근거)

- 보안: 키 은닉.
- rate limit 완충: 앱의 잦은 새로고침이 Sentry API rate limit을 직접 때리지 않게
  백엔드에서 캐싱/집계 가능.
- 데이터 가공: Sentry의 raw JSON을 앱이 쓰기 좋은 형태로 축약해 응답 크기 절감.

### 3.3 푸시 알림 파이프라인 (Phase 1)

```
NestJS 스케줄러 (1~2분 간격)
   │  GET https://sentry.io/api/0/organizations/<slug>/issues/?statsPeriod=…
   │  마지막으로 본 lastSeen 커서 이후의 새 이슈만 골라낸다
   ▼
NestJS: 인시던트 요약 저장 → 푸시 발송
   ▼
Expo Push Service ──→ 사용자 기기
   │  알림 payload에 딥링크 데이터 포함: { incidentId: "..." }
   ▼
알림 탭 → 앱이 딥링크 해석 → 인시던트 상세 화면 직행
```

**⚠ 설계 변경 — webhook 수신에서 폴링으로 (2026-09-16)**

v2 까지는 `POST /ops/webhooks/sentry` 로 **Sentry 가 우리를 호출**하는 구조였다. 이를 **우리가 Sentry API 를 조회**하는 폴링으로 바꾼다. 근거는 [ex-observability-map.md §5-1](./ex-observability-map.md) 의 실측이다.

| 항목 | 실측 결과 |
|---|---|
| Sentry **Web API** 조회 | ✅ **무료 플랜에서 동작**(`/organizations/` 200, `/organizations/<slug>/issues/` 200) |
| Sentry **Slack 통합** | ❌ Team 플랜 이상 — 2026-07 체험 기간에만 동작했고 현재 **끊겨 있다** |
| 알림 룰의 **webhook 액션** | `확인 필요` — 폴링으로 대체하므로 막지 않는다 |

폴링으로 바꾸면서 얻는 것이 더 많다.

- **서명 검증 과제가 통째로 사라진다.** §5.1 에 `[확인 필요]` 로 남아 있던 "Sentry webhook 서명 검증 방식"을 조사할 필요가 없고, `api.ansmoon.dev` 에 전 세계로 열리는 엔드포인트를 하나 덜 만든다.
- **이슈 그룹핑·중복 제거를 직접 만들 필요가 없다.** Sentry 가 이미 묶어 둔 이슈를 그대로 읽는다. 자체 지문 설계와 upsert 를 구현하는 1.5~2 일치 작업이 빠진다.
- **Sentry 플랜 정책 변화에 덜 흔들린다.** 이번에 Slack 통합이 조용히 끊긴 것이 그 사례다.

잃는 것은 폴링 주기만큼의 지연뿐이고, 단일 개발자용 운영 앱에서 1~2 분은 의미가 없다. 무료 플랜의 API 레이트리밋도 백엔드 한 대의 분당 1회 조회로는 닿지 않는다.

> 💡 `#sentry-errors` Slack 알림을 되살리는 것도 이 폴링 루프에 얹으면 된다. Slack **Incoming Webhook** 은 무료이고 이미 두 채널(`#deployments`·`#claude-hooks`)에서 쓰고 있다. Sentry 의 Slack 통합을 다시 사는 대신 **우리가 직접 쏜다**([ex-observability-map.md §7 ②](./ex-observability-map.md)).

### 3.4 AI 분석 파이프라인 (Phase 3)

```
앱: POST /ops/incidents/:id/analysis 요청
   ▼
NestJS:
  1) Sentry API에서 해당 인시던트의 상세(스택트레이스, 태그, 발생 빈도) 조회
  2) 프롬프트 조립:
     - 시스템 지시: "아래 JSON 스키마로만 응답하라" (스키마는 5.4절)
     - few-shot: 평가에서 '승인'된 과거 분석 상위 N개 (Phase 4 이후 활성화)
     - 인시던트 데이터
  3) AI API 호출 — **기존 인프라 재사용**(아래 "재사용 가능한 기존 자산" 표).
     스트리밍이 필요하면 `POST /v1/admin/assistant/stream` 의 SSE-over-POST 방식을 그대로 쓴다
     Phase 5: `read_source` 도구를 주고 `generateWithTools` 로 부른다 — 모델이 스택의 파일:줄을 GitHub 에서 읽고 답한다(§9 Phase 5)
  4) 응답 JSON 파싱 + 스키마 검증 (zod 등). 실패 시 1회 재시도 → 그래도 실패면
     구조화 실패 상태로 응답 (앱은 fallback UI 표시)
  5) 분석 결과 저장 (5.4 데이터 모델)
   ▼
앱: 구조화된 카드 UI로 렌더링 (심각도 뱃지 / 원인 / 추천 조치 / 관련 파일)
```

**AI 응답 방어 처리(중요)**: AI는 스키마를 어길 수 있다. 파싱 실패 시 앱 화면이
깨지지 않도록 (a) 백엔드에서 검증, (b) 앱에서 optional 필드 방어 렌더링,
(c) 실패 상태 전용 UI를 반드시 구현한다. 이 방어 처리 자체가 포트폴리오 어필 포인트다.

**재사용 가능한 기존 자산 (2026-09-15 확인)** — Phase 3·4 가 크게 단축된다:

| 자산 | 위치 | 이 앱에서의 쓸모 |
|---|---|---|
| 프로바이더 비종속 `LlmClient` | `backend/src/intrastructure/ai/` | AI 호출부를 새로 짤 필요 없음(현재 Gemini, 교체 가능) |
| SSE 스트리밍 | `POST /v1/admin/assistant/stream` | **nginx 통과 검증 완료** — 백엔드가 `X-Accel-Buffering: no` 를 보내고 nginx 는 `proxy_read_timeout 300s` 다 |
| tool use(구조화 호출) · PII 스크럽 | `backend/src/admin/assistant/` | 스키마 강제·민감정보 마스킹 선례 |
| eval 하네스(골든셋 + LLM-judge) | `backend/eval/` | **Phase 4 의 "few-shot 전/후 품질 비교" 를 이 하네스로 수치화**할 수 있다 |

⚠ **제약**: 현재 LLM 은 Gemini 무료티어라 **RPM 15** 제한이 있다. 분석 요청 빈도·재시도 설계에 반영할 것.

---

## 4. 화면 흐름 및 내비게이션

### 4.1 내비게이션 트리

```
RootNavigator (AuthContext의 user 유무로 분기)
│
├── [user 없음] AuthStack
│     └── LoginScreen ── (Phase 2: 생체 인증 재로그인 옵션)
│
└── [user 있음] AppTabs (하단 탭 3개)
      ├── Tab 1: IncidentsStack
      │     ├── IncidentListScreen   (홈. crash-free 요약 카드 + 인시던트 목록)
      │     └── IncidentDetailScreen (딥링크 도착지)
      │           └── AnalysisScreen (Phase 3. AI 분석 카드)
      ├── Tab 2: ReviewStack (Phase 4)
      │     └── ReviewScreen  (평가 카드 스택, 스와이프)
      └── Tab 3: ProfileStack
            └── ProfileScreen (로그아웃, 생체 인증 토글, 앱 버전)
```

- 내비게이션 라이브러리: Expo Router 또는 React Navigation.
  `[확인 필요: 설치 시점 Expo 공식 권장을 확인해 선택. 신규 프로젝트라면
  Expo Router(파일 기반)가 기본값일 가능성이 높다.]`
- 로그인 분기는 화면 이동 명령이 아니라 **상태 기반 렌더 분기**로 구현한다
  (user가 null이면 AuthStack 자체를 렌더).

### 4.2 딥링크 명세 (Phase 1의 핵심)

- 스킴 예시: `opscompanion://incidents/:incidentId`
- 처리해야 하는 3가지 앱 상태 (전부 테스트 필수):
  1. **포그라운드**: 인앱 배너/토스트 → 탭 시 상세로 push
  2. **백그라운드**: 알림 탭 → 상세로 직행
  3. **종료(cold start)**: 알림 탭 → 앱 부팅 → 인증 확인 → 상세로 직행
     (초기 라우팅 대기 처리 필요. 이 케이스가 가장 함정이 많으므로
     트러블슈팅 기록을 남길 것)
- 미로그인 상태에서 딥링크 진입 시: 로그인 화면 → 성공 후 원래 목적지로 리다이렉트
  (pending deep link 보관).

### 4.3 화면별 상세 스펙

#### S1. LoginScreen (Phase 0)
- 이메일/비밀번호 → **`POST /v1/auth/login`**.
  **확정된 계약(2026-09-15)**: 응답 body 는 `{ accessToken, expiresIn, tokenType, user }` 이고
  refreshToken 은 기본적으로 **httpOnly 쿠키로만** 내려온다. 앱은 **`X-Client: mobile` 헤더**를 붙여
  body 로도 refreshToken 을 받는다(§5.6 — 백엔드 변경 동반).
- 성공 시: **accessToken·refreshToken 을 모두 SecureStore 에 저장** → AuthContext.user 세팅 → 자동으로 AppTabs 전환.
- Phase 2 추가: 저장된 세션이 있으면 생체 인증(Face ID/지문)으로 잠금 해제.
  - **생체 인증은 서버/DB와 무관하다.** 지문·얼굴 대조는 기기 보안 칩 안에서만
    일어나고, 앱은 성공/실패(true/false) 결과만 받는다. 생체 데이터는 서버로
    전송되지 않으며 백엔드/DB는 이 과정에 관여하지 않는다.
  - 동작 원리: 생체 인증은 "서버에 재로그인"이 아니라, 이미 SecureStore에 저장된
    JWT를 꺼내기 위한 **로컬 잠금 해제** 절차다. 인증 성공 시 저장된 토큰으로
    로그인 상태를 복원할 뿐, 새 인증 요청을 서버로 보내지 않는다.
  - 따라서 생체 인증 구현을 위한 **DB 컬럼/테이블 추가는 필요 없다.** "생체 인증
    사용 여부" 설정 값은 기기 로컬(예: SecureStore)에만 저장한다. 이 설정을 서버에도
    동기화할 특별한 요구가 생기면 그때 별도로 검토하되, v1 범위에서는 하지 않는다.

#### S2. IncidentListScreen (Phase 0~2)
- 상단: crash-free sessions 요약 카드 (Phase 2에서 실데이터 연결. 그 전엔 미표시)
- 목록: 인시던트 제목 / 심각도 색 점 / 발생 횟수 / 마지막 발생 시각
- 데이터: `GET /ops/incidents` (TanStack Query, staleTime 60~300초,
  pull-to-refresh 시 invalidate)
- 빈 상태/로딩/에러 상태 UI 각각 구현.

#### S3. IncidentDetailScreen (Phase 1)
- 심각도 뱃지, 이벤트 수, 최근 발생 시각
- 스택트레이스 표시. 소스맵 복원 여부 뱃지(Phase 2 이후 실제 복원 확인)
- breadcrumbs(직전 사용자 행동) 목록
- CTA 버튼: "AI에게 원인 물어보기" → AnalysisScreen (Phase 3 전까지는 비활성/숨김)

#### S4. AnalysisScreen (Phase 3)
- AI 분석 결과를 **구조화 카드**로 렌더:
  심각도(뱃지) / 원인(본문) / 추천 조치(코드 예시 포함 가능, 모노스페이스) /
  관련 파일(칩)
- 상태: 로딩(스켈레톤) / 성공 / **구조화 실패 fallback**(원문 텍스트 + 재시도 버튼)
- 하단 CTA: "이 분석 평가하기" → ReviewScreen의 해당 항목으로

#### S5. ReviewScreen (Phase 4)
- 카드 스택 UI. 제스처: 오른쪽 스와이프=승인, 왼쪽=반려
- 카드 내 별점(1~5) 선택 가능. 스와이프 시 낙관적 업데이트
  (다음 카드 즉시 표시, 서버 저장은 백그라운드, 실패 시 롤백+토스트)
- 진행 표시: "3 / 12"
- 오프라인 대응(선택 확장): 평가를 로컬 큐에 쌓고 온라인 복귀 시 동기화

#### S6. ProfileScreen (Phase 0)
- 사용자 정보, 로그아웃(SecureStore 토큰 삭제 + user null),
  생체 인증 사용 토글(Phase 2), 앱 버전/릴리즈 표시

---

## 5. 데이터 모델 및 API 설계

### 5.1 신규 백엔드 엔드포인트 (NestJS에 `ops` 모듈로 추가 권장)

| 메서드/경로 | 용도 | Phase |
|---|---|---|
| `GET /v1/ops/incidents` | Sentry API 프록시. 인시던트 목록(축약형) — ✅ **구현 완료(2026-09-17)**: `backend/src/ops/`, admin 전용, Redis 60s 캐시(`X-Cache` HIT·MISS 헤더), 키 미설정 시 503 | 0 |
| `GET /v1/ops/incidents/:id` | 인시던트 상세 — ✅ **구현 완료(2026-09-20, `0cc8301`)**: issue 단건 + 최신 event 를 합쳐 예외·스택(최근 호출이 앞, 30 프레임)·breadcrumbs(30개) 만 남긴다. request/user entry(헤더·쿠키·IP)는 읽지 않고 자유 텍스트는 `scrubText`. id 는 숫자만 받아 경로 조작 차단, 없는 이슈 404, Redis 60s 캐시 | 1 |
| `POST /v1/ops/devices` | 기기 Expo push token 등록 — ✅ **구현 완료(2026-09-20)**: `(userId, 토큰)` upsert + Expo 토큰 정규식 검증. `DemoAccountGuard` 는 걸지 않는다(저장되는 것이 본인 기기 주소뿐이고, 막으면 데모 로그인으로 앱이 못 돈다) | 1 |
| ~~`POST /v1/ops/webhooks/sentry`~~ | ~~Sentry webhook 수신~~ → **폐기(2026-09-16)**. §3.3 의 폴링 스케줄러로 대체 | 1 |
| `POST /v1/ops/incidents/:id/analysis` | AI 분석 생성(또는 캐시된 분석 반환) — ✅ **구현 완료(2026-09-21)**: `ops-analysis.service.ts`. `getIncident` 재사용 → 프롬프트 조립(`scrubText`) → `LlmClient.generate` → `parseAnalysis` 검증, 위반 시 사유를 실어 **1회 교정 재시도** → `ops_analyses` 저장. body 없이 부르면 최근 행(상태 무관, `X-Cache: HIT`), `{force:true}` 면 재분석, `{simulate:'parse_failed'}` 는 **비운영 전용** 강제 실패. LLM 키 없음 503 · 분당 상한(`OPS_ANALYSIS_MAX_PER_MIN`, 기본 5) 초과 429 · 같은 이슈 동시 409. 실제 LLM 호출은 단위 테스트 15건이 모킹으로 고정, e2e 는 시뮬레이션 경로만. **Phase 5(2026-09-22)**: `read_source` 도구(`source-reader.service.ts`, GitHub raw + Redis 캐시, 폴더 허용 목록·80줄·3회) → `generateWithTools` → 교정 재시도는 도구 없이. 응답에 `toolCalls`(읽은 파일 기록). body `readSource:false` 가 도구 없는 팔. 상한은 `OPS_ANALYSIS_MAX_LLM_PER_MIN`(분당 LLM 호출 수, 기본 12) 예약형으로 교체 | 3 · 5 |
| `GET /v1/ops/analyses/pending` | 평가 대기 중인 분석 목록 — ✅ **구현(2026-09-22, `ops-review.service.ts`)**: 이 평가자가 아직 채점하지 않은 `status=ok`·비시뮬레이션 행. **promptVersion 을 응답에서 뺀다**(블라인드). 순서는 `md5(id:reviewerId)` — 평가자별 고정 뒤섞기(시간순이면 v1·v2 가 번갈아 나와 패턴이 읽히고, 난수면 새로고침마다 재배열). 상한 50 | 4 |
| `POST /v1/ops/analyses/:id/review` | 평가 저장 (verdict, rating) — ✅ **구현(2026-09-22)**: `{verdict, rating?, comment?}` → `ops_reviews` **upsert**(같은 평가자 재평가는 통째로 덮어씀, `X-Review: CREATED|UPDATED`). parse_failed·simulated 행 400, 없는 분석 404 | 4 |
| `GET /v1/ops/analyses/stats` | (설계에 없던 추가) promptVersion 별 분석 수·구조화 실패율·승인율·평균 별점 — DoD 의 숫자가 나오는 경로. 앱 화면은 없다(채점 중에 보면 블라인드가 깨진다). `model='simulated'` 제외 | 4 |

- **인증 확정(2026-09-15)**: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(Role.ADMIN)`.
  `Role` 은 `buyer | seller | admin`(`backend/src/user/entity/role.entity.ts`).
  ⚠ **데모 관리자 계정 주의** — 쓰기성 동작에는 `DemoAccountGuard` 가 걸려 차단될 수 있으니,
  앱 테스트는 데모 계정이 아닌 실제 관리자 계정으로 한다.
- ~~webhook 엔드포인트는 JWT 대신 서명/시크릿 검증~~ → **불필요해졌다(2026-09-16)**. 폴링으로 바꾸면서
  공개 수신 엔드포인트 자체가 없어졌으므로 서명 검증 조사도, `ThrottlerModule` 예외 고민도 사라진다(§3.3).
  대신 **Sentry API 토큰이 새 비밀값으로 늘어난다** — 백엔드 환경변수에만 두고 앱에는 절대 내려보내지 않는다(§7).

### 5.2 응답 축약 원칙

Sentry raw 응답을 그대로 넘기지 말 것. 앱 목록 화면에는 아래 축약형이면 충분하다:

```ts
// GET /ops/incidents 응답 항목
interface IncidentSummary {
  id: string;
  title: string;          // 예: "TypeError: cannot read property 'name'"
  level: 'error' | 'warning' | 'info';
  count: number;          // 발생 횟수
  lastSeen: string;       // ISO 8601
}
```

### 5.3 신규 DB 테이블 (기존 쇼핑몰 DB에 추가)

**확정(2026-09-15)**: **TypeORM** 이며 `synchronize` 는 전면 off — 스키마는 **마이그레이션으로만** 바꾼다.
절차: 엔티티 작성 → `nx run @shopping-mall/backend:migration:generate --name=<이름>` →
⚠ **`backend/src/database/migrations/index.ts` 에 명시적으로 등록**(글롭은 nx 단일 번들이라 **조용히 실패**한다) → `migration:run`.
운영 반영은 `docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js`
(기존 컨테이너 `exec` 가 아니다 — migrate.js 는 **새 이미지 안**에 있다). 상세: [ex-db-migration.md](./ex-db-migration.md)

> **생체 인증 관련 주의:** 생체 인증(Phase 2)을 위한 신규 컬럼/테이블은 추가하지
> 않는다. 생체 대조는 기기 내에서만 처리되고 서버로 어떤 생체 데이터도 전송되지
> 않으며, "생체 인증 사용 여부" 설정은 기기 로컬에만 저장한다. 아래 3개 테이블은
> 푸시(device tokens)·AI 분석·평가를 위한 것이지 생체 인증과 무관하다. (상세 근거는
> 4.3절 S1 화면 스펙 참고.)

```
ops_device_tokens
  - id, userId(FK), expoPushToken, platform('ios'|'android'), createdAt
  - (userId, expoPushToken) 유니크

ops_analyses
  - id, incidentId(Sentry issue id, string), status('ok'|'parse_failed')
  - resultJson(jsonb: 5.4 스키마), promptVersion(string), model(string)
  - latencyMs(int), createdAt

ops_reviews
  - id, analysisId(FK), reviewerId(FK userId)
  - verdict('approved'|'rejected'), rating(int 1~5, nullable)
  - comment(text, nullable), createdAt
  - (analysisId, reviewerId) 유니크

ops_poll_state                       ← v2.1 추가 (§3.3 폴링 전환에 따른 필수 테이블)
  - id, source('sentry'), lastSeenAt(timestamp), lastIssueId(string, nullable)
  - updatedAt
  - source 유니크 (행 1개만 존재)

ops_push_log                         ← v2.2 추가 (2026-09-20 구현 시점, 아래 멱등 요구의 실체)
  - id, incidentId(string), userId(int), lastPushedAt(timestamptz), pushCount(int)
  - (incidentId, userId) 유니크
```

> **구현 완료(2026-09-20)**: 위 3개 중 푸시 관련 3개를 마이그레이션 `OpsPushTables1789877464959` 로 만들었다
> (`ops_device_tokens`·`ops_poll_state`·`ops_push_log`. `ops_analyses`·`ops_reviews` 는 Phase 3·4 몫).
> `ops_device_tokens` 에는 설계에 없던 `disabledAt` 을 더했다 — Expo 가 `DeviceNotRegistered` 를 돌려준
> 기기(앱 삭제)를 지우지 않고 표시만 해 두면, 재등록으로 되살아나고 발송 대상에서는 빠진다.

> **구현 완료(2026-09-21, Phase 3)**: `ops_analyses` 를 마이그레이션 `OpsAnalyses1789968335669` 로 만들었다. 설계에 없던
> `raw_text`(text, nullable) 를 더했다 — parse_failed 일 때 모델 원문(마스킹·4,000자 절단)을 앱의 fallback 화면이 보여준다.
> `incident_id` 에 UNIQUE 를 걸지 않는다: 재시도·프롬프트 버전 변경으로 한 이슈에 여러 행이 쌓이고, "지금 보여줄 것"은
> 최신 행이다. 옛 행을 지우지 않아야 Phase 4 의 v1 vs v2 비교가 성립한다. `ops_reviews` 는 Phase 4 몫.

> **구현(2026-09-22, Phase 5)**: `ops_analyses` 에 `tool_calls`(jsonb, nullable) — 마이그레이션 `OpsToolCalls1790026688606`. `null`=도구 미제공(v1/v2·옛 행) · `[]`=제공했으나 미호출 · `[{path, ref, startLine, endLine, ok, lines|reason}]`=읽은 것. 코드 원문은 저장하지 않는다.

> ⚠ **`ops_poll_state` 를 빠뜨리면 폴링이 성립하지 않는다.** "어디까지 봤는지"를 기억하지 못하면
> 매 주기마다 같은 이슈를 새 인시던트로 오인해 **푸시가 무한 반복된다.** 커서를 Redis 에만 두는 것도
> 위험하다 — Redis 가 재시작되면 커서를 잃고 같은 사고가 난다. **DB 에 둬야 한다.**
> 푸시 발송 자체도 `(incidentId, userId)` 기준으로 멱등하게 만들어, 커서가 틀어져도 중복 발송이
> 한 번으로 눌리게 하는 것이 안전하다(쇼핑몰의 정산 리스너가 쓰는 멱등 패턴과 같은 접근).

`promptVersion`을 저장하는 이유: Phase 4에서 "프롬프트 v1 vs v2의 승인율"을
비교할 수 있게 하기 위함. 이것이 "평가 데이터로 시스템을 개선했다"는 서사의
증거 데이터가 된다.

### 5.4 AI 분석 결과 스키마 (백엔드에서 zod 등으로 검증)

```ts
interface AiAnalysis {
  severity: 'critical' | 'high' | 'medium' | 'low';
  rootCause: string;        // 원인 요약 (2~4문장)
  suggestedFix: string;     // 구체적 조치. 코드 예시 포함 권장
  relatedFiles: string[];   // 스택트레이스에서 추정한 파일들
  confidence: 'high' | 'medium' | 'low';  // AI 스스로의 확신도
}
```

프롬프트 시스템 지시 요지: "위 JSON 스키마로만, 마크다운 코드펜스 없이 응답.
suggestedFix에는 반드시 구체적 코드 수정 예시 포함."

### 5.5 앱 쪽 데이터 레이어 규칙

- 모든 서버 데이터는 TanStack Query 경유. 직접 fetch 금지.
- queryKey 규칙: `['incidents']`, `['incident', id]`, `['analysis', incidentId]`,
  `['reviews', 'pending']`
- staleTime 기본 5분. 인시던트 목록은 1분(실시간성 높음).
- axios 인스턴스 1개를 `src/lib/api.ts` 에 두고, 요청 인터셉터에서 SecureStore 의
  accessToken 을 `Authorization: Bearer` 로 자동 첨부. **401 응답 시에는 곧바로 로그아웃하지 말고
  refresh 를 1회 시도**한 뒤, 그것도 실패하면 로그아웃한다(아래 토큰 전략).

### 5.6 모바일 토큰 전략 — **Phase 0 필수 · 백엔드 변경 동반** (2026-09-15 확정)

**문제**: 백엔드에 `POST /v1/auth/refresh` 가 **있지만 httpOnly 쿠키만 읽는다**
(`backend/src/auth/auth.controller.ts:151` — `req.cookies?.refreshToken`). 웹은 Vercel 의 BFF 가
백엔드의 `Set-Cookie` 를 받아 자기 도메인 쿠키로 다시 구워주지만, **앱에는 그 중간 서버가 없다.**
accessToken 수명이 **15분**이므로 refresh 없이는 앱이 15분마다 로그아웃되고, Phase 0 의 DoD
("앱 재시작 후에도 로그인 유지")를 만족할 수 없다.

**확정안 — ① 헤더 분기** (대안이었던 ② 앱 전용 엔드포인트, ③ 전면 body 반환은 기각):

```
앱 → 요청 헤더에 X-Client: mobile
백엔드 → 그 헤더가 있으면 login / refresh 응답 body 에 refreshToken 을 함께 담는다
         (헤더가 없으면 지금 그대로 = 웹 동작 100% 불변)
앱 → accessToken · refreshToken 을 expo-secure-store(OS Keychain/Keystore)에 저장
     401 → refreshToken 으로 /v1/auth/refresh 호출 → 새 토큰 쌍 저장 → 원요청 재시도
```

선정 이유: 엔드포인트를 한 벌로 유지해 로직 중복이 없고, **웹 코드를 한 줄도 건드리지 않으며**,
백엔드가 이미 `x-device-id` 헤더를 받아 기기별 토큰을 관리하는 전례가 있어 구조가 자연스럽다
(`auth.controller.ts:148`, CORS `allowedHeaders` 에도 등록되어 있다).

**백엔드 작업 항목** (앱 코드보다 **먼저** 해야 한다) — ✅ **전부 완료(2026-09-17, 0-A)**. 구현 메모:
`register` 는 토큰을 발급하지 않아(이메일 인증 후 로그인) 분기 대상이 아니었고, 대신 **`logout` 도 `쿠키 ?? body.refreshToken`** 을 받도록 맞췄다 — 앱이 body 로 넘기지 않으면 서버 쪽 refreshToken 이 7일간 살아남기 때문. 회귀 고정: 컨트롤러 단위 테스트 9건 + HTTP e2e `backend-e2e/src/backend/mobile-token-and-ops.e2e.spec.ts`.

1. `login` / `refresh` / (필요 시 `register`) 응답에서 `X-Client: mobile` 이면 body 에 `refreshToken` 추가
2. `refresh` 가 **쿠키가 없으면 body/헤더의 refreshToken 도 받아들이도록** 확장
3. CORS `allowedHeaders` 에 `x-client` 추가(웹에는 영향 없음. 앱은 CORS 무관이지만 일관성을 위해)
4. 회귀 확인: **웹에서 로그인 → 새로고침 유지 → 로그아웃**이 그대로 동작하는지(쿠키 경로 불변)

**보안 노트**: 앱에서 SecureStore 는 웹의 httpOnly 쿠키에 대응하는 보호 수단이다(OS 보안 저장소이므로
일반 앱 코드/디컴파일로 꺼내기 어렵다). **AsyncStorage 에 토큰을 저장하면 안 된다**(평문 저장).
백엔드는 refreshToken 을 해시로만 저장하고 Redis 블랙리스트로 검증하므로, 앱도 이 구조를 그대로 재사용한다.

---

## 6. Sentry 계측 계획 (역할 B: 이 앱 자신의 관측)

| 항목 | 내용 | Phase |
|---|---|---|
| 기본 설치 | `@sentry/react-native` init (앱 전용 Sentry 프로젝트를 새로 만들 것. 쇼핑몰 프로젝트와 분리) | 0 |
| beforeSend | 노이즈 필터(개발 중 의도적 에러 태그 제외) + PII 마스킹(이메일 등) | 2 |
| 소스맵 | Hermes 소스맵 업로드. EAS Build와 연동해 자동화 `[확인 필요: 설치 시점의 sentry-expo/@sentry/react-native 공식 가이드 확인]` | 2 |
| Release Health | 릴리즈 태깅 → crash-free sessions 추적. S2 요약 카드의 데이터 원천 | 2 |
| AI 호출 계측 | `POST /analysis` 요청을 커스텀 span으로 감싸 지연/실패율 추적. "AI를 관측한다"는 차별화 포인트 — ✅ **구현(2026-09-21)** 양쪽에: 앱 `ops.analysis.request`(체감 지연, `tracesSampler` 가 **이 이름만 100%**, 나머지 트랜잭션 0% = 쿼터 방어) · 백엔드 `ops.analysis.llm`(LLM 왕복, 시도 횟수·status 속성) | 3 |
| 태그 | `screen`, `appVersion`, 로그인 사용자 id(마스킹 규칙 적용) | 2 |

**요금 안전장치 (필수 설정):** 무료 Developer 플랜 사용. 조직 설정에서
pay-as-you-go/spend limit을 0으로 두어 한도 초과 시 과금 대신 수집 중단되게 한다.
무한 루프성 에러(렌더 루프 안 throw 등)를 조심한다.

**무료 플랜 경계선 (2026-09-16 실측 — 이 계획에 영향 없음)**

| 기능 | 무료 | 이 앱에서 |
|---|---|---|
| SDK 수집·그룹핑·소스맵·Release Health·커스텀 span | ✅ | **위 표 전부 그대로 가능**. 역할 B 는 영향 없음 |
| Web API 조회 | ✅ | 역할 A(§3.3·§5.1) 그대로 |
| 이메일·앱 내 알림 | ✅ | 앱 푸시가 붙기 전까지의 보조 통로 |
| Slack 등 서드파티 통합 | ❌ Team 이상 | 안 쓴다. Slack 은 백엔드가 Incoming Webhook 으로 직접 쏜다 |

⚠ **쿼터는 두 프로젝트가 나눠 쓴다.** 앱 전용 프로젝트를 새로 만들어도 월 5,000 errors 는
조직 전체 한도다. 쇼핑몰과 앱이 같은 5K 를 나눠 쓰므로, 앱의 `beforeSend` 노이즈 필터(Phase 2)는
"있으면 좋은 것"이 아니라 **쿼터 방어 장치**다.

전체 관측 체계에서 이 앱이 놓이는 자리는 [ex-observability-map.md §6](./ex-observability-map.md) 참조.

---

## 7. 보안 원칙 (전 Phase 공통)

1. Sentry API 토큰·AI API 키는 백엔드 환경변수에만 존재. 앱 코드·app.json·
   EAS secrets 어디에도 넣지 않는다 (앱은 디컴파일로 노출됨).
2. JWT는 SecureStore에만 저장. AsyncStorage 금지.
3. 로그아웃 시 SecureStore 토큰 삭제 확인.
4. beforeSend에서 이벤트 내 PII(이메일/전화번호) 마스킹.
5. ~~webhook은 서명 검증 없이는 처리하지 않는다.~~ → **이 앱에는 수신 webhook 이 없다**(v2.1 폴링 전환, §3.3).
   대신 지켜야 할 것: **Sentry API 토큰을 응답에 실어 보내지 않는다.** 백엔드가 Sentry 응답을 §5.2 의
   축약형으로 가공해 내려보내므로, raw JSON 을 그대로 프록시하지 말 것(토큰은 아니어도 불필요한 내부 정보가 샌다).
   원칙 자체는 쇼핑몰의 PortOne 웹훅에 여전히 유효하다([03-infra-nginx.md §10 의 12-3](./03-infra-nginx.md)).

---

## 8. 폴더 구조 제안 (앱)

**확정(2026-09-15)**: 기존 저장소는 **루트 레벨 디렉터리 컨벤션**이다
(`backend/` `frontend/` `shared/` `backend-e2e/` — `apps/` 는 없고 `packages/` 는 `.gitkeep` 만 있는 빈 디렉터리).
→ 앱은 **루트에 `ops-companion/`** 으로 두고 `package.json` 의 workspaces 배열에 `'ops-companion'` 을 추가한다.
아래는 앱 내부 구조 제안이며, Expo Router 채택 시 `app/` 디렉토리 규칙이 우선한다.

```
ops-companion/
├── app/                        # Expo Router 화면 (라우트 파일)
│   ├── (auth)/login.tsx
│   ├── (tabs)/
│   │   ├── incidents/index.tsx        # S2
│   │   ├── incidents/[id]/index.tsx   # S3
│   │   ├── incidents/[id]/analysis.tsx # S4
│   │   ├── review.tsx                 # S5
│   │   └── profile.tsx                # S6
│   └── _layout.tsx             # RootNavigator + AuthProvider + Sentry init
├── src/
│   ├── lib/
│   │   ├── api.ts              # axios 인스턴스 + 인터셉터
│   │   ├── sentry.ts           # Sentry init/헬퍼
│   │   └── notifications.ts    # 푸시 등록/딥링크 파싱
│   ├── contexts/AuthContext.tsx
│   ├── features/
│   │   ├── incidents/          # 쿼리 훅 + 컴포넌트
│   │   ├── analysis/
│   │   └── review/             # 스와이프 카드 스택
│   ├── components/             # 공용 UI (Badge, Card, Skeleton...)
│   └── types/                  # 앱 전용 타입만. 백·프론트 공용은 @shopping-mall/shared 로
└── app.json / eas.json
```

백엔드는 기존 NestJS에 `src/ops/` 모듈 하나로 응집
(controller / service / sentry-client / ai-client / dto).

---

## 9. Phase별 로드맵과 완료 기준 (Definition of Done)

**절대 원칙: 각 Phase는 그 자체로 완결된 데모다. 이전 Phase의 DoD를 만족하기
전에 다음 Phase 코드를 작성하지 않는다.** (사용자가 범위 욕심으로 미완성이 되는
것을 막는 것이 이 문서의 최우선 목표 중 하나다.)

### Phase 0 — 뼈대 (RN 기본기 + 백엔드 재사용)
- **0-A. 백엔드 먼저** (§5.6): `X-Client: mobile` 헤더 분기로 login/refresh 가 body 에 refreshToken 을
  주도록 확장 + **웹 회귀 확인**. 이것이 안 되면 앱은 15분마다 로그아웃되므로 아래를 시작하지 않는다.
  ✅ **완료(2026-09-18 운영 배포·검증)** — 토큰 분기 + `GET /v1/ops/incidents` 프록시(§5.1). 운영(`c90b51a`)에서 웹 회귀·모바일 경로·ops 200/캐시 HIT 확인.
  ⚠ 운영 검증 중 **기존 버그**를 재현해 함께 고쳤다: access 토큰에 `jti` 가 없어 같은 사용자·같은 초 발급 토큰이 문자열까지 동일 → 웹 로그아웃이 블랙리스트에 넣은 토큰과 겹치면 **앱이 방금 받은 토큰이 401**. 앱은 로그인/갱신이 잦아 이 충돌을 웹보다 자주 만난다. 수정 = `accessPayload.jti = crypto.randomUUID()`.
- **0-B. 앱**: Expo 프로젝트 생성, AuthContext + SecureStore 로그인/자동 refresh, axios 인터셉터,
  `GET /v1/ops/incidents` 백엔드 프록시, S1/S2/S6 화면, Sentry 기본 설치
  ✅ **코드 완료(2026-09-18)** — `ops-companion/`(워크스페이스 추가).
  ✅ **실기기 DoD 통과(2026-09-19~20, `f54ba5e`)** — 안드로이드 Expo Go. 아래 DoD 전 항목을 화면 + 운영 nginx 로그로 대조했다(자동 갱신 = 로그인 15분 22초 뒤 `/auth/me 401 → /auth/refresh 201 → 재시도 304` 같은 초). Sentry 는 앱 전용 프로젝트 `ops-companion` 을 만들고 `--no-dev` 모드에서 테스트 이벤트 도착 확인.
  실기기 전 코드 재검토로 **버그 2건**을 잡았다: ① 조건부 `<Stack.Screen>` 은 Expo Router 에서 라우트를 빼지 못해 로그인 후에도 화면이 안 바뀜 → `Stack.Protected guard` ② `/auth/me` 의 roles 가 객체 배열(login 은 문자열 배열) → 재시작 후 권한 표시 깨짐 → 앱 `fetchMe` 에서 정규화. 경위는 학습 노트 1편 6-5~6-9.
  **설치 시점 실측으로 확정된 `[확인 필요]` 3건**: Expo SDK **57**(expo 57.0.23 / RN 0.86.3 / React 19.2.3) · 내비게이션 = **Expo Router 57**(파일 기반, 예상대로 기본값) · Sentry = **@sentry/react-native 7.11.x**(`expo install` 이 SDK 호환 버전으로 고정 — npm `latest` 8.27 을 쓰면 안 된다).
  구현 메모: Reanimated 4 는 `react-native-worklets` 를 peer 로 요구해 따로 설치해야 했다. Metro 는 모노레포용으로 `watchFolders`(루트) + `nodeModulesPaths`(앱·루트) 만 지정한다 — `disableHierarchicalLookup` 은 expo-doctor 가 권장값 위반으로 잡아 뺐다.
- DoD: 실기기(안드로이드)에서 로그인 → 인시던트 목록 조회 → **accessToken 만료(15분) 후에도 자동 갱신으로 계속 사용** →
  앱 재시작 후에도 로그인 유지 → 로그아웃이 전부 동작. 의도적 에러 1건이 Sentry 대시보드에 보임.
  **웹 쇼핑몰의 로그인/로그아웃도 변함없이 동작**(0-A 회귀 확인).

### Phase 1 — "웹이 아닌 진짜 앱" (푸시 + 딥링크)
- 구현: push token 등록, **Sentry API 폴링 스케줄러**(§3.3 — webhook 아님) → 백엔드 → Expo 푸시,
  딥링크 3상태(포그라운드/백그라운드/종료) 처리, S3 상세 화면
- DoD: 쇼핑몰에서 에러 발생 → 폰 푸시 수신 → 탭 → (앱이 꺼져 있어도) 해당
  인시던트 상세로 진입. 이 데모가 영상으로 녹화 가능해야 함.

**⛔ 착수 시 확인된 전제 — Expo Go 로는 이 Phase 를 검증할 수 없다(2026-09-20)**

SDK 53 부터 **안드로이드 Expo Go 에서 원격 푸시가 빠졌다**(공식 문서: *"Push notifications (remote
notifications) functionality provided by expo-notifications is unavailable in Expo Go on Android from
SDK 53. A development build is required"*). 로컬 알림과 권한·채널까지는 Expo Go 에서도 된다.
→ **개발 빌드(EAS) 가 Phase 1 의 선행조건**이고, 거기에 Expo 계정·`eas init`·Firebase 프로젝트·
FCM V1 서비스 계정 키 등록이 따라온다(사용자가 콘솔에서 직접 해야 하는 일). 절차는
[ops-companion/README.md](../../ops-companion/README.md) "푸시 알림".

**진행(2026-09-20)** — 작은 단계로 쪼개 진행 중이다.

| 단계 | 내용 | 상태 |
|---|---|---|
| ① 상세 | `GET /ops/incidents/:id` + S3 화면 + 목록→상세 스택 | ✅ 실기기 확인(`0cc8301`, Expo Go 로 가능한 마지막 단계) |
| ② 등록 | 표 3개 마이그레이션 + `POST /ops/devices` + 앱의 권한·채널·토큰 등록 | ✅ 코드·백엔드 e2e. 앱 쪽 실기기 확인은 개발 빌드 대기 |
| ③ 발송 | 폴링 스케줄러(2분) + Expo Push + 멱등/쿨다운 | ✅ 코드·단위. **실데이터 스모크 통과**(가짜 토큰으로 후보 4건 → 발송 4통 → `DeviceNotRegistered` → 토큰 자동 비활성 + 선점 되돌림) |
| ④ 딥링크 | 3상태 + 미로그인 시 pending deep link | ✅ 코드 + **실기기 통과**(포그라운드·백그라운드). cold start 는 preview 빌드 대기 |
| ⑤ 쿼터 | 프론트 리포터 중복 억제 | ✅ 코드·단위(다운 재현 16건 → 2건) |

**실기기 통과(2026-09-20)** — 개발 빌드 + 로컬 백엔드 + 실제 안드로이드 기기. 로그인 → 알림 권한 허용 →
기기 토큰 등록(프로필 "푸시 알림 켜짐") → 커서를 되돌려 후보 1건 유도 → `푸시 발송: 이슈 1건 → 알림 1통` →
폰 알림 수신(`🚨 e-commerse-backend` / `Error: listen EADDRINUSE …`) → **탭 → 인시던트 상세 진입**.
`ops_push_log` 에 (incident 7736291868, user 1) 1건, 커서 04:14:00 → 04:14:53 전진 확인.

**DoD 전 항목 통과(2026-09-20).** 위에 더해 ① **앱 완전 종료 상태에서도** 알림 탭 → 상세 직행
② **로그아웃 상태**에서 탭 → 로그인 화면 → 로그인 후 그 상세로 이동(pending deep link)
③ 쿨다운 실측(후보 2건 → 발송 1통)까지 확인했다.
데모 영상은 번들이 내장된 **preview 빌드**로 찍는 것이 정직하다 — 개발 빌드의 cold start 는
PC 의 Metro 에 의존한다(`eas build -p android --profile preview`, 키스토어 재생성 탓에 기존 앱 삭제 후 설치).

**운영 배포 완료(2026-09-20, main `6a609a9`)**: 이미지 2태그 → EC2 pull → 마이그레이션
`OpsPushTables1789877464959` 1건 적용(운영 DB 에 표 3개 생성 확인) → `up -d` → `nginx -t && -s reload` →
검증(health `version=6a609a9`, `/v1/ops/incidents/:id`·`POST /v1/ops/devices` 401=라우트 존재,
`/products`·`/categories` 200). 운영 폴러는 첫 주기에 커서만 심었다(설계대로 발송 없음).
⚠ 운영 DB 에는 기기 토큰이 없다 — 앱을 운영에 붙이고 `kirianir@naver.com` 으로 한 번 로그인해야 등록된다.
⚠ 로컬·운영 백엔드를 동시에 켜 두면 같은 Sentry 를 각자 폴링해 알림이 두 번 올 수 있다(커서·push_log 가 DB 별).

**개발 빌드 착수에서 실제로 걸린 것 4건**(학습 노트 2편 6-8~6-11):
① Expo Go 는 초기 경로를 빈 문자열로, 개발 빌드는 `/` 로 준다 → 루트 `app/index.tsx` 가 없어 Unmatched Route.
② `.yarn/cache` 2.9GB 때문에 Metro 파일 감시가 240초 제한을 넘겨 실패 → 번들 500 → 앱은 **흰 화면**만.
   `metro.config.js` 의 `blockList` 로 해소(모듈 해석과 파일맵 크롤링 양쪽에서 제외된다).
③ expo.dev 의 키스토어 업로드 폼은 채우지 않는다 — `eas credentials` 에서 생성하게 하면 EAS 가 만든다.
   Firebase 콘솔의 build.gradle 플러그인 안내도 CNG 프로젝트에는 해당 없다(`android.googleServicesFile` 로 끝).
④ 알림 채널의 `sound` 는 번들된 파일 이름 자리다. `'default'` 를 주면 에러 로그가 남는다(키를 빼면 기본 소리).

**확정한 푸시 기준**(대화로 합의, 2026-09-20)

| 항목 | 결정 | 이유 |
|---|---|---|
| 레벨 | `error`·`fatal` 만 | warning·info 로 새벽에 폰이 울릴 이유가 없다 |
| 프로젝트 | 쇼핑몰 프론트·백엔드만(`OPS_PUSH_PROJECTS`). **앱 자신 제외** | 앱이 죽어 푸시가 오고 그 푸시로 앱을 열어 또 죽는 되먹임 차단 |
| 새 이슈 | 즉시 | — |
| 재발 | 쿨다운 6시간(`OPS_PUSH_COOLDOWN_HOURS`) | "새 이슈만" 이면 같은 에러로 데모를 두 번 찍을 수 없고, 쿨다운이 없으면 514회 발생한 CORS 이슈가 주기마다 울린다 |
| 멱등 | `ops_push_log` 의 `(incidentId, userId)` 유니크. `INSERT … ON CONFLICT … DO UPDATE … WHERE last_pushed_at < 기준` 한 문장으로 선점 | 커서가 틀어져도 중복 발송이 한 번으로 눌린다. 전송이 통째로 실패하면 선점을 되돌려 다음 주기에 재시도 |
| 리포터 | 같은 fingerprint 60초 1건 + 탭당 10건 | 무작위 샘플링은 기각 — 새 이슈의 **첫 이벤트**가 버려지면 그 이슈로 도는 푸시를 놓친다 |

**구현 중 밟은 함정 3건**

1. 토큰 payload 의 사용자 id 는 `@User('sub')` 다(`@User('id')` 는 undefined → NOT NULL 위반 500).
2. `string | null` 컬럼은 `type:` 을 명시해야 한다 — 리플렉션이 Object 로 보고 `migration:generate` 가 거부한다.
3. **한 기기가 한 주기에 여러 알림을 받는다.** 발송 선점을 토큰으로 짝지었더니 마지막 이슈만
   되돌려지고 앞의 것들은 기록이 남아 6시간 동안 다시 울리지 않았다(실데이터 스모크에서 발견).
   메시지 **인덱스**로 짝짓는 것으로 고치고 회귀 테스트를 남겼다.

### Phase 2 — 관측성 심화 + 보안 UX
- 구현: 소스맵 업로드(EAS 연동), Release Health, beforeSend(필터+PII),
  crash-free 요약 카드, 생체 인증
- DoD: 프로덕션 빌드의 에러가 Sentry에서 원본 파일:라인으로 복원되어 보임.
  릴리즈별 crash-free 수치가 대시보드와 앱 카드 양쪽에 표시.

**✅ 완료(2026-09-21, `4ead4ca`)** — DoD 전 항목 통과. 학습 노트 3편
[03-observability-and-biometrics.md](../learning/ops-companion/03-observability-and-biometrics.md).

| 단계 | 내용 | 상태 |
|---|---|---|
| ① 소스맵 | `app.json` org·project + `metro.config.js` **Debug ID** + Gradle 업로드 | ✅ 실기기(preview). `sentry.ts:48:43`(= `new Error(` 의 여는 괄호)·`profile.tsx:38:40` 까지 **칸 단위 복원** |
| ② beforeSend | 같은 에러 60초 1건 + 실행당 20건 상한, PII·자격증명 마스킹 | ✅ 실기기. 테스트 3건이 이슈 1개로 묶임, `user = id:1`(이메일 없음) |
| ③ 태그 | `screen`(useSegments) · `appVersion` · navigation breadcrumb | ✅ 실기기. `screen = (tabs)/profile` (**패턴**, 실제 경로 아님) |
| ④ Release Health | `GET /v1/ops/release-health` + S2 상단 카드 | ✅ 백엔드 단위 27건 + 실기기 카드 **두 줄**(`1.0.0+2` 1세션이 위, `1.0.0+1` 16세션이 아래 — 정렬 기준이 세션 수가 아님을 같이 증명) |
| ⑤ 생체 인증 | 덮개 방식 잠금 + 프로필 토글 | ✅ 실기기. **앱 종료 → 푸시 탭 → 잠금 → 지문 → 상세 직행** |

**설계대로 지켜진 것**: DB 테이블·컬럼 **0개**, 마이그레이션 **0건**, 생체 인증 과정의 서버 요청 **0건**(§5.3 주의 문단·§4.3 S1).

**확정한 결정 4건**

| 항목 | 결정 | 이유 |
|---|---|---|
| `release` 옵션 | **적지 않는다**(네이티브 기본값 `패키지@버전+versionCode` 사용) | Gradle 이 소스맵을 올릴 때 쓰는 `--release` 가 네이티브 값이다. `'1.0.0'` 으로 덮으면 에러와 소스맵이 짝이 안 맞아 **복원이 조용히 실패**한다 |
| `autoIncrement` | preview·production 에 **켠다**(development 는 제외) | RN 앱은 커밋 SHA 를 모르고 versionCode 에만 의존한다. 고정이면 모든 빌드가 한 릴리즈로 뭉쳐 "릴리즈별 crash-free" 자체가 성립하지 않는다 |
| 카드 정렬 | 세션 수가 아니라 **`+N` 내림차순** | 새 빌드는 배포 직후라 세션이 적다. 세션 순이면 비교하려고 만든 카드가 **항상 옛 빌드를 크게** 보여준다 |
| `disableDeviceFallback` | **false**(기기 PIN 대체 허용) | 센서가 안 읽혀 온콜 담당자가 장애 알림을 못 보는 쪽이 더 큰 위험. 잠금 화면에 로그아웃 버튼도 함께 뒀다 |

**§7-1 문구 정정.** "Sentry API 토큰·AI API 키는 ... EAS secrets 어디에도 넣지 않는다" 는
**"APK 안에 들어가는 곳에 넣지 않는다"** 로 읽어야 한다. 소스맵은 EAS 빌드 서버에서 만들어지므로
업로드 토큰이 빌드 시점에 반드시 필요하고, 다른 방법이 없다. 이번에 추가한 토큰은 원칙의 취지에
어긋나지 않는다 — ① 이슈 조회가 불가능한 **Organization Token**(`sntrys_`)이고 ② `EXPO_PUBLIC_`
접두어가 없어 번들에 박히지 않는다(실측: APK 번들에서 DSN·API 주소는 평문으로 발견되지만
이 토큰은 0회). ⚠ 플러그인 옵션 `authToken` 에는 **절대 적지 않는다** — app.json 은 커밋되고
prebuild 때 APK 안으로 들어간다(SDK 자신이 경고한다).

**구현 중 밟은 함정 5건**(학습 노트 3편 6장)

1. **EAS 빌드에서 Sentry 가 통째로 꺼져 있었다.** `.easignore` 가 `.env` 를 제외해 DSN 이 빈 채로
   빌드됐고 `if (!SENTRY_DSN) return;` 에 걸렸다. 소스맵을 올려도 복원할 에러가 안 온다 →
   DSN 을 `eas.json` 의 preview·production `env` 로 옮겼다.
2. **개발 빌드는 소스맵을 올리지 않는다.** `sentry.gradle` 이 `if (!v.name...contains("debug"))`
   로 막는다. 복원 확인은 preview 빌드에서만 가능하다.
3. **`nx serve` 는 코드를 바꿔도 node 를 재시작하지 않는다.** node 시작 12:38:12 → `main.js` 기록
   12:38:27 로, 서버가 옛 코드를 메모리에 올린 채 404 를 냈다. 확인은 시작 로그의
   `Mapped {/v1/ops/release-health, GET}`.
4. **sessions API 의 `project` 는 slug 도 받는다.** "숫자 id 만 받는다"는 추정으로 `/projects/`
   해석 단계를 넣었다가, 둘 다 200·동일 결과임을 실측하고 들어냈다(호출 1회·캐시 필드·404 경로 제거).
   단 `project` 자체를 빼면 조직 전체가 합산된다(그룹 1개 → 9개).
5. **기기 토큰이 화면에서 잘려 읽을 수 없었다**(`numberOfLines={1}`). 손으로 옮겨 적다 `l`↔`I` 를
   혼동해 `DeviceNotRegistered` 가 났다 → `Field` 에 `full`(줄바꿈+복사) 추가 + `__DEV__` 콘솔 출력.
6. **sessions 조회가 새 릴리즈를 조용히 빠뜨린다.** 두 번째 빌드(`+2`)를 올렸는데 카드에 `+1` 만
   떴다. Sentry 에 릴리즈도 세션도 있었지만 우리 질의에서만 안 보였다. 실측(3회 재현):
   `14d`(interval 미지정·`1h`) → `+1` 만 / `14d`+`6h`·`1d` → 둘 다 / `7d`(미지정) → 둘 다.
   기간 × interval 로 포인트가 많아지면(14d×1h=336) Sentry 가 결과 크기를 맞추려 **작은 그룹부터
   떨구는** 것으로 보이고, **새 릴리즈가 항상 가장 작다**(배포 직후라 세션이 몇 건뿐) →
   `interval: '1d'` 고정. 시계열을 그리지 않고 totals 만 쓰므로 손해가 없고 응답도 336→14 포인트로
   준다. 기간 14일은 유지 — 7일로 줄이면 지금은 되지만 릴리즈가 늘면 같은 방식으로 재발한다.

### Phase 3 — AI 분석
- 구현: 백엔드 분석 파이프라인(3.4), 스키마 검증 + 재시도 + 실패 fallback,
  S4 화면, AI 호출 Sentry span 계측
- DoD: 실제 인시던트에 대해 구조화 카드가 렌더됨. AI가 스키마를 어긴 경우에도
  앱이 깨지지 않고 fallback UI가 표시됨(강제 실패 테스트 포함).

**✅ 완료(2026-09-21, main `89a02bc` = PR #33)** — 실기기 DoD · 운영 배포 · Sentry span 확인 — 학습 노트 4편
[04-ai-analysis.md](../learning/ops-companion/04-ai-analysis.md).

| 단계 | 내용 | 상태 |
|---|---|---|
| ① 백엔드 파이프라인 | `OpsAnalysisService`: 상세 재사용 → 프롬프트 → `LlmClient.generate` → `parseAnalysis` → 교정 재시도 1회 → `ops_analyses` | ✅ 단위 15건 + 파서 단위 14건. **로컬 실인시던트로 `ok` 1건 실측**(Gemini flash-lite, 1회 시도, 2.4초, 스키마 준수) |
| ② DB | `ops_analyses` 마이그레이션(+`raw_text`) · index.ts 등록 · 로컬 적용 | ✅ 로컬 · **운영 적용**(`run --rm … migrate.js`, 2026-09-21) |
| ③ S4 AnalysisScreen | `/incidents/analysis/[id]` — 스켈레톤 / 구조화 카드 / fallback(원문+다시 분석) / HTTP 에러 6종 문구 | ✅ **실기기**(개발 빌드 `8f91794d` + 로컬 백엔드) 카드 렌더 |
| ④ S3 CTA | "AI에게 원인 물어보기" 버튼 활성 | ✅ 실기기 |
| ⑤ span 계측 | 앱 `tracesSampler` 이름 필터 + `ops.analysis.request` · 백엔드 `ops.analysis.llm` | ✅ **preview `aad289d2` + 운영**: 누른 횟수만큼 트랜잭션, `ops.analysis.status=ok`, 자식 `POST`. 앱 시작·화면 이동 트랜잭션 없음(`app.start.warm` 은 첫 트랜잭션의 자식 span — 4편 6-10). 백엔드 span 은 운영 샘플 0.1 |
| ⑥ 강제 실패 | `simulate:'parse_failed'`(비운영) + 개발 빌드 전용 `[DEV]` 버튼 | ✅ **실기기**: fallback 원문 표시, 앱 생존, "다시 분석"으로 카드 복귀 |

**DoD 통과가 "분석이 맞다"는 뜻은 아니다.** 첫 실기기 분석(CORS 이슈)은 문장이 매끄러웠지만 판단이 틀렸다 — 차단한 서버 자신을 허용 목록에 넣으라고 했다(학습 노트 4편 6-8). 옳고 그름을 가리는 장치가 Phase 4 이고, 근거를 늘리는 것이 아래 보강 후보다.

**확정한 결정**

| 항목 | 결정 | 이유 |
|---|---|---|
| 캐시 의미 | force 없는 요청은 **최근 행을 상태 무관하게** 준다(parse_failed 포함) | 화면을 다시 열 때마다 몰래 재시도하면 무료티어 쿼터가 샌다. 재분석은 사용자가 버튼을 눌러 명시적으로 |
| 재시도 방식 | 같은 질문 반복이 아니라 **교정 요청**(틀린 응답 + 위반 사유 + "JSON 만 다시") | 무엇을 고칠지 알려 주는 쪽이 성공률이 높다. 시도는 총 2회 — RPM 15 |
| JSON 강제 | 프로바이더의 JSON 모드(Gemini `responseMimeType`)를 **쓰지 않는다** | `LlmClient` 인터페이스에 프로바이더 어휘를 넣지 않는다는 원칙. 대신 파서가 관대하게 읽고 엄격하게 검증한다 — "AI 가 어겨도 안 깨진다"는 서사가 실제 경로가 된다 |
| 검증 라이브러리 | zod 없이 **직접 검증**(필드 5개) | 백엔드 번들에 의존성 하나를 늘릴 만큼의 스키마가 아니다 |
| 경로 | `incidents/analysis/[id]`(상세의 **형제**) | `[id]/analysis` 로 하려면 상세를 `[id]/index.tsx` 로 옮겨야 하고, 그러면 딥링크 문서·학습 노트 링크가 전부 바뀐다 |
| 트랜잭션 샘플링 | `tracesSampleRate` 대신 **`tracesSampler` 이름 필터** | 비율을 0 보다 크게 주면 SDK 기본 통합이 앱 시작·화면 이동 트랜잭션까지 만들어 에러 쿼터를 나눠 먹는다 |
| DemoAccountGuard | **걸지 않는다** | 로컬 DB 관리자가 데모 계정이라 걸면 앱 개발이 막힌다. 대신 분당 상한이 쿼터를 지킨다 |

**Phase 3 이후 보강 후보(2026-09-21 합의, 지금은 하지 않는다)** — 현재 분석은 스택트레이스·breadcrumb 만 보고 추측한다.
AI 의 가치는 모델이 아니라 **컨텍스트 · 도구 · 피드백 루프**에서 나오는데 셋 다 얇다. 순서는 Phase 4(피드백 루프) 를
먼저 끝내고, 그 다음 아래를 얹는다. 도구 왕복이 붙으면 분석 하나가 LLM 3~4회 호출이 되므로 무료티어 RPM 15 를 다시 계산해야 한다.

| 우선 | 보강 | 지금 | 채우면 | 재사용 자산 |
|---|---|---|---|---|
| **1** | **소스 코드 읽기**(tool use) | 파일명만 추측(`relatedFiles`) | 스택의 파일:줄을 GitHub 에서 읽어 **실제 코드 줄**을 보고 고침을 제안. 쇼핑몰 프로젝트는 Sentry release = 커밋 SHA 라 정확한 시점의 코드를 읽을 수 있다 | `LlmClient.generateWithTools`(어시스턴트 Phase 3) |
| 2 | 배포 맥락 | 없음 | "이 이슈는 릴리즈 X 부터" → 그 커밋의 변경 파일이 용의자. Sentry issue 응답에 `firstRelease` 가 이미 있다 | `sentry-api.client.ts` 필드 추가 |
| 3 | 이벤트 여러 건·태그 분포 | 최신 이벤트 1건 | 한 브라우저·한 사용자에만 나는지로 심각도 근거 확보 | `getLatestEvent` → events 목록 |
| 4 | 행동 | 분석만 | Slack 초안·GitHub 이슈 생성 | Slack Incoming Webhook(이미 2채널 사용) |

체감이 가장 큰 것은 1번이다 — "추측"이 "근거 있는 지적"으로 바뀐다.

### Phase 4 — 평가 루프 (human-in-the-loop)
- 구현: S5 스와이프 카드 + 별점 + 낙관적 업데이트, 평가 저장, few-shot 주입
  (승인된 분석 상위 N개를 프롬프트에 포함), promptVersion 관리
- DoD: 평가 10건 이상 축적 후, few-shot 적용 전/후 분석 품질 차이를 스크린샷
  또는 승인율 수치로 비교할 수 있음.

**✅ 완료(2026-09-22, 브랜치 `feat/ops-review-loop` — 실기기 채점 18장 · v1 vs v2 수치 · **운영 배포(main `8610aca` = PR #35, 2026-09-22, 마이그레이션 1건)** 까지)** — 학습 노트 5편 [05-review-loop.md](../learning/ops-companion/05-review-loop.md). 착수 전 결정 4건(+재평가 1건)을 사용자와 확정했다.

**실측 수치(2026-09-22, 로컬 DB, 평가자 1명, gemini-3.1-flash-lite)**

| 집합 | v1 승인율 | v2 승인율 | 평균 별점 v1 / v2 | 구조화 실패 |
|---|---|---|---|---|
| test 6건(같은 인시던트 × 두 버전, 블라인드) | **5/6 = 83.3%** | **4/6 = 66.7%** | 3.60 / 3.75 | 0 / 0 |
| test 중 쌍둥이 2건 제외 | 3/4 | 3/4 | — | — |
| 전체(`stats` 출력 — Phase 3 옛 행·seed 포함) | 8/12 = 66.7% | 4/6 = 66.7% | 3.88 / 3.75 | 0 / 0 |

**few-shot 은 승인율을 올리지 못했다.** 표본이 6건이라(한 건 = 16.7%p) 어느 쪽도 단정할 수 없고, 이 표의 뜻은 "측정 장치가 생겼고 첫 측정이 기대와 달랐다"다. v1 도 v2 도 CORS 이슈에는 같은 오답을 냈다(seed #14) — 예시로는 못 고치는 종류의 오류라 보강 후보 1번(소스 코드 읽기)의 근거가 됐다. 오염 요소(쌍둥이 2건 · 옛 행 #1 이 test 인시던트와 겹쳐 그 건의 v2 는 예시 2개 · 반려에 별점 5 인 행 1건)는 5편 6-6.

| 항목 | 결정 | 이유 |
|---|---|---|
| ① 비교 방법 | **고정 평가 세트 + 블라인드.** Sentry 30일 이슈에서 seed(3건)·test(5~6건)를 **서로 다른 인시던트**로 나눈다. seed 를 v1 로 분석·채점해 승인 풀을 만든 뒤, test 를 v1·v2 로 **각각** 분석해 섞어서 채점한다. 평가 화면은 promptVersion 을 **응답에서 아예 내려주지 않는다**(카드에서 숨기는 게 아니라). 총 평가 ≈ 3 + 2×6 = 15건 | 서로 다른 인시던트로 v1·v2 를 재면 난이도가 섞여 차이의 원인을 가릴 수 없다. 어시스턴트 eval(골든셋 고정 → 프롬프트만 변경)과 같은 원리. seed/test 를 나누면 누수(④)가 구조적으로 막힌다 |
| ② 평가 재료 | 24h 가 아니라 **`listIssues('30d')`** 로 후보를 모은 뒤 사용자가 id 를 고른다. 생성은 `backend/eval/ops-review-set.ts` 스크립트(Nest 컨텍스트 부팅, 어시스턴트 eval 러너와 같은 방식) | 24h 인시던트는 2~3건뿐이다. 같은 이슈 재분석은 다양성이 없고, 자연 발생분은 언제 10건이 모일지 모른다 |
| ③ 캐시와 버전 | **그대로 둔다.** 화면 진입은 최신 행(버전 무관), 재분석은 "다시 분석" 버튼뿐. 평가 세트는 스크립트가 `force` 로 만든다 | Phase 3 결정 "비싼 동작은 사용자가 눌렀을 때만"을 지킨다. 버전이 다르다고 화면 진입이 LLM 을 부르면 쿼터 예측이 깨진다 |
| ④ few-shot | **N=3**, 승인(`approved`) + `status=ok` + `model≠simulated` 행에서 **rating 높은 순 → 최신순**. **분석 대상 인시던트 자신의 행은 제외**(정답 보고 시험 방지). 예시도 `scrubText` 를 거쳐 system static 에 넣고, **어떤 예시(analysis id)를 썼는지 행에 기록**(`few_shot_ids`). `parse_failed` 는 평가 대상에서 빼고 버전별 구조화 실패율로 따로 센다 | 예시 3개면 입력이 약 1.5배. 별점이 있으니 "사람이 높이 산 것"을 먼저 쓴다. 기록이 있어야 "왜 이렇게 답했나"를 되짚을 수 있다(어시스턴트 eval 이 결과 JSON 을 보존한 것과 같은 발상) |
| ⑤ 재평가 | **upsert** — 같은 평가자가 같은 분석을 다시 평가하면 최신 판정으로 덮어쓴다 | 스와이프 실수를 정정할 수 있어야 한다. `UNIQUE(analysisId, reviewerId)` 가 자연스러운 upsert 키 |

**버전 표기 규칙(④의 귀결)**: `promptVersion` 은 상수가 아니라 **"예시가 실제로 들어갔는가"** 로 정한다 — 예시 0개면 `v1`(SYSTEM 이 Phase 3 과 바이트 단위로 같다), 1개 이상이면 `v2`. 승인 풀이 비어 있을 때 `v2` 라고 적으면 v1 과 같은 프롬프트에 다른 이름표를 붙이는 셈이라 비교가 오염된다. 스크립트의 대조군(v1)은 body `fewShot: false` 로 만든다.

**진행(2026-09-22)**

| 단계 | 내용 | 상태 |
|---|---|---|
| ① DB | `ops_reviews`(UNIQUE(analysis_id, reviewer_id), FK CASCADE 2개) + `ops_analyses` 에 `incident_title`·`exception_text`·`few_shot_ids` — 마이그레이션 `OpsReviews1790001959888`, index.ts 등록, 로컬 적용 | ✅ 로컬 · ✅ 운영(`run --rm … migrate.js`, 2026-09-22) |
| ② 백엔드 평가 API | `OpsReviewService` — pending(블라인드·해시 셔플) · review(upsert) · stats(버전별 집계) · `selectFewShot`(별점순, 대상 인시던트 제외) | ✅ 단위 9건 |
| ③ few-shot 주입 | `OpsAnalysisService.generate`: 승인 예시 → system static 뒤 예시 블록(격리 문구·scrubText·필드 1,500자 절단) → 예시 있으면 v2 + `few_shot_ids` 저장. `fewShot:false` 로 v1 대조군 | ✅ 단위 5건 추가(합 94) |
| ④ e2e | F 절: 픽스처 행으로 pending 형태(promptVersion 없음)·400/404·CREATED→UPDATED·stats 숫자까지 | ✅ 22/22 |
| ⑤ 평가 세트 스크립트 | `backend/eval/ops-review-set.ts` — list(30d 후보) / seed(v1) / test(v1+v2 번갈아) / stats. Nest 컨텍스트 부팅, 폴러 off, 상한 429 대기 | ✅ seed 3건(#14·#15·#16, v1) · test 12건(#17~#28, v1·v2 번갈아, 12/12 ok) · stats 실측 |
| ⑥ 앱 S5 | `(tabs)/review.tsx` + `features/review/{queries,SwipeCard,StarRating}` — Pan 제스처(가로 16px 활성·세로 12px 실패로 카드 안 스크롤 양보) · Reanimated 회전/판정 스탬프 · 버튼 대체 경로 · 낙관적 업데이트(실패한 카드 한 장만 복귀) · 진행 "n / N" · `GestureHandlerRootView` 루트 감쌈 · 탭 추가 · S4 CTA "이 분석 평가하기"(`/review?analysisId=`) | ✅ tsc · ✅ **실기기**(개발 빌드 + 로컬 백엔드, 2026-09-22 — 18장 채점) |
| ⑦ DoD | seed 3건 채점 → test 6건 × v1·v2 블라인드 채점 → stats 로 v1 vs v2 승인율 | ✅ 위 수치 표 |

**평가 세트(2026-09-22 확정, 사용자 승인)** — Sentry 30일 이슈가 **9건뿐**이라 전부 쓴다(로컬 DB, 로컬 백엔드 + 새 개발 빌드로 채점).

| 역할 | id | 프로젝트 | 횟수 | 제목 |
|---|---|---|---|---|
| seed | 7732523858 | backend | 778 | Not allowed by CORS — Phase 3 의 오답 사례(4편 6-8). 첫 반려 건 후보 |
| seed | 7742806116 | frontend | 12 | AxiosError: Network Error |
| seed | 7744504775 | ops-companion | 5 | Sentry 연결 테스트 |
| test | 7742806178 | frontend | 4 | AxiosError: Network Error — ⚠ seed 와 **쌍둥이**(같은 제목) |
| test | 7742712093 | ops-companion | 3 | Sentry 연결 테스트 — ⚠ seed 와 **쌍둥이** |
| test | 7734495591 | frontend | 3 | probe-uncaught |
| test | 7743410873 | backend | 2 | QueryFailedError: user_id null (ops_device_tokens) |
| test | 7736291868 | backend | 2 | EADDRINUSE :4000 |
| test | 7734451568 | backend | 1 | AggregateError |

seed 첫 실측(2026-09-22, analysis #14, flash-lite 3.4초): CORS 이슈에 대해 **Phase 3 과 똑같은 오답**을 냈다 — "`api.ansmoon.dev` 를 허용 목록에 추가하라", confidence **high**. 같은 프롬프트(v1)는 같은 함정에 빠진다는 재현이고, 이 행이 평가 세트의 첫 반려 건이다. 첫 실행에서 나머지 2건은 Gemini 503(high demand, 일시적)으로 실패해 스크립트에 LLM 일시 장애 재시도(30초)를 더하고 다시 돌렸다.

쌍둥이 2건은 v2 가 "거의 같은 인시던트의 승인 답"을 예시로 받으므로 유리하다. 운영에서는 정당한 효과(비슷한 과거 장애의 승인 분석이 도움이 되는 것)지만, 공정 비교로는 오염이라 **수치를 쌍둥이 2건 / 비쌍둥이 4건으로 나눠 본다.** 재료를 더 모으려면 90일로 늘리거나 실제 장애가 쌓이길 기다려야 한다.

⚠ 실기기 확인의 전제: 폰에는 preview `aad289d2`(운영 API, Metro 불가)가 깔려 있다. 새 앱 코드를 보려면 **개발 빌드를 다시 만들어 설치**(preview 를 지우고 — versionCode 역행 거부)하고 로컬 백엔드에 붙이거나, 백엔드를 운영 배포한 뒤 **새 preview 빌드**로 운영 DB 를 상대로 채점해야 한다. 어느 쪽이든 EAS 빌드 1회(약 20분)가 필요하다. 네이티브 패키지는 **새로 넣지 않았다**(gesture-handler·reanimated 는 Phase 0 부터 APK 안에 있다) — 그래도 JS 가 바뀌었으니 preview 는 재빌드가 필요하고, 개발 빌드는 Metro 로 바로 본다.

### Phase 5 — 소스 코드를 읽는 분석 (tool use)
- 구현: `read_source` 도구(저장소 경로 + 줄 범위 → 코드 조각, GitHub raw 읽기 + Redis 캐시) · 분석 파이프라인을
  `LlmClient.generateWithTools` 로 전환(도구 결과를 받아 최종 JSON, 교정 재시도는 도구 없이) · 읽은 파일 기록(`tool_calls`) ·
  promptVersion `v3` · 백엔드 스택을 원본 좌표로(webpack `sourceMap` + `node --enable-source-maps`) · Sentry `release` 를
  커밋 SHA 로 · 이벤트의 release/firstRelease 를 프롬프트에(보강 후보 2번)
- 앱: 분석 카드에 "AI 가 읽은 코드" 섹션(파일:줄 칩). 새 네이티브 패키지 없이
- DoD: ① CORS 이슈(7732523858)에 대해 v3 가 `main.ts` 의 CORS 설정을 **실제로 읽고**(`tool_calls` 기록으로 확인)
  "서버 자신을 허용하라"는 오답을 내지 않는다 ② Phase 4 test 세트를 v3 로 분석해 블라인드 채점 → v1·v2·v3 승인율 표
  ③ 도구 호출 실패(파일 없음·범위 밖·GitHub 장애)에도 분석이 v1 처럼 끝난다(깨지지 않는다)

**착수 전 결정(2026-09-22, 사용자 승인)** — 코드에서 확인한 사실이 §9 보강 후보 표의 전제와 달랐다(아래 "확인한 사실").

| 항목 | 결정 | 이유 |
|---|---|---|
| ① 백엔드 번들 좌표 | **(a) 이미지 안에서 변환** — webpack 옵션 오타(`sourceMaps`→`sourceMap`) 수정으로 운영 빌드에 `.map` 을 만들고, `CMD` 에 `node --enable-source-maps`. 배포 후 **새 이벤트부터** 원본 좌표 | Dockerfile 한 단어. 로컬 실험(2026-09-22)에서 `/app/backend/dist/main.js:17026` → `webpack://shopping-mall/backend/src/main.ts:60` 확인. (b) Sentry 업로드는 CI 절차·토큰이 늘고, (c) 프론트만은 소스맵 미업로드라 성립하지 않는다 |
| ② 어느 시점의 코드 | **(b) `release: APP_VERSION`** 을 `instrument.ts` 에 더해 새 백엔드 이벤트에 커밋을 남기고, 이벤트 release 가 커밋 SHA 꼴이면 그 커밋을, 아니면(앱 `1.0.0+N`·옛 이벤트) `main` HEAD 를 읽되 프롬프트에 "발생 시점과 다를 수 있음" 명시 | 이슈 이후 코드가 바뀌면 HEAD 의 같은 줄은 엉뚱하다. 프론트는 Vercel 이 이미 SHA 를 적는다 |
| ③ GitHub 접근 | **(a) 무인증 raw + Redis 캐시**(`ops:src:<ref>:<path>`, 커밋은 7일·main 은 10분) | public 저장소(API 200). 시간당 60회 상한이지만 분석당 최대 3회 + 캐시. 새 비밀값 0. private 전환 시 fine-grained 토큰 |
| ④ 도구·안전장치 | 도구 **하나** `read_source({path,startLine,endLine})`. 허용 경로 `backend/src/`·`frontend/src/`·`ops-companion/(app|src)/` 만, `..`·절대경로·`.env*`·`*.pem`·`google-services.json`·`*firebase-adminsdk*` 거부. 80줄/회 · 3회/분석 · 결과 `scrubText` + 격리 문구 | 스택에 파일:줄이 이미 있어 검색 도구는 왕복만 늘린다. public 이어도 "LLM 이 아무 파일이나 읽는 구조"는 만들지 않는다. 도구 결과는 직렬화 인터셉터를 안 거친다(어시스턴트 §8-4) |
| ⑤ 버전·기록 | **v3 = 도구가 프롬프트에 들어간 분석**(few-shot 끔). 실제 호출 여부는 `tool_calls`(jsonb, `[]`=제공했으나 미사용 · `null`=미제공)로 남긴다. 원문 코드는 저장하지 않는다 | Phase 4 규칙("프롬프트가 실제로 달라졌을 때만 버전이 바뀐다")과 같은 원리 — 도구 안내와 선언은 호출 여부와 무관하게 프롬프트에 들어간다. v3 에 few-shot 을 같이 켜면 v1 과의 차이가 "도구인지 예시인지" 가릴 수 없다 |
| ⑥ 호출 예산 | 상한을 "분당 분석 건수"에서 **"분당 LLM 호출 수"**(`OPS_ANALYSIS_MAX_LLM_PER_MIN`, 기본 12)로. 분석 시작 시 최악 호출 수(도구 켬 5 = 1+3+1 · 끔 2)를 **예약**, 넘치면 429 + 예약 취소. 교정 재시도는 도구 없이 형식만 | 도구 루프가 붙으면 한 건이 2~5회라 기존 상한(5건)으로는 RPM 15 를 넘긴다. 어시스턴트 몫 3 을 남긴다 |

**코드에서 확인한 사실(2026-09-22)** — 보강 후보 표의 전제와 다른 것

| 표의 전제 | 실제 |
|---|---|
| "이미지에 `*.js.map` 이 들어 있다" | **없다.** `webpack.config.js` 의 `sourceMaps: true` 가 오타라 무시됐고 `--prod` 빌드에 `.map` 0개. 개발 빌드만 만들고 있었다 |
| "Sentry release = 커밋 SHA" | 프론트만 그렇다(Vercel 자동). 백엔드 `instrument.ts` 에 `release` 없음, 앱은 `패키지@1.0.0+N` |
| "프론트 프레임은 소스맵으로 원본 경로" | **아니다.** Vercel 에 업로드 토큰이 없어 릴리즈 파일 0개, 프레임은 `_next/static/chunks/8577-….js:12:123490`. 이번 범위 밖 |
| — | **앱(ops-companion) 프레임은 이미 원본 경로**(`ops-companion/app/(tabs)/profile.tsx:38`, Phase 2 소스맵 업로드) — 배포 전에도 도구가 읽을 수 있는 유일한 프로젝트 |

**🔶 코드·로컬 실측 완료(2026-09-22, 브랜치 `feat/ops-source-reading`) — 운영 배포·실기기 채점 미완.** 학습 노트 6편 [06-source-reading.md](../learning/ops-companion/06-source-reading.md).

| 단계 | 내용 | 상태 |
|---|---|---|
| ① 도구 단독 | `SourceReaderService`(`source-reader.service.ts`): 경로 허용 목록·비밀값 이름 거절·프레임→저장소 경로 정규화·raw 읽기·Redis 캐시(커밋 7일/main 10분·404 부정 캐시 60초)·80줄·실패는 `{ok:false, reason}` | ✅ 단위 39건 · **실제 GitHub 스모크**(`main.ts@8610aca` 55~72줄 387ms, 캐시 HIT, 404·`.env` 거절) |
| ② 파이프라인 | `OpsAnalysisService`: `READ_SOURCE_TOOL`·`TOOL_GUIDE`·`[소스 코드]` 절(커밋·릴리즈·읽을 수 있는 파일) → `generateWithTools`(마지막 라운드 텍스트만) → `executeTool`(3회 상한·기록·span `ops.analysis.tool`) → 교정 재시도는 `generate`. `tool_calls` 컬럼(마이그레이션 `OpsToolCalls1790026688606`, 로컬 적용). 상한을 `reserveRateLimit`(LLM 호출 수, 기본 12)로 교체. 상세에 `release`·`firstRelease` | ✅ 단위 30건(도구 9건) · e2e 22/22 · **로컬 실인시던트 7744504775: v3, 2회 읽음(`sentry.ts`·`profile.tsx`@main), low/high, 6.0초** |
| ③ 소스맵·릴리즈 | `webpack.config.js` `sourceMaps`→`sourceMap`(오타로 운영 빌드에 .map 이 없었다) · Dockerfile `CMD node --enable-source-maps` · `instrument.ts` `release: APP_VERSION` | ✅ 로컬 실험(운영 번들 + 옵션 → `webpack://shopping-mall/backend/src/main.ts:60`) · ⏳ 운영은 배포 후 새 이벤트부터 |
| ④ 앱 | `AnalysisCard` "AI 가 읽은 코드" 섹션(칩 `path:start-end`, 실패는 ✗+사유, `[]` 는 "읽지 않고 답했다", `null` 은 섹션 없음) · 메타 "(코드 n)" · pending 은 블라인드 유지(`toolCalls` 없음) | ✅ tsc · ⏳ 실기기 |
| ⑤ 평가 세트 | 스크립트 `--arms v1,v2,v3` · `stats` 에 `toolCalled` | ✅ test 6건 × v3 생성(#30·31·35·39·40·41, 6/6 ok) · ⏳ 채점 |
| ⑥ 문서 | 6편 · infra-story(GitHub 노드·3-4·5장·6장·7장·용어) · §3.4·§5.1·§5.3 | ✅ |
| ⑦ 배포·DoD | PR → main → 이미지(`.map` 8개 + 새 CMD) → 마이그레이션 1건 → CORS 새 이벤트 확인 → v3 분석 → 채점 → v1·v2·v3 표 | ⏳ `_next-session-phase5-close.md` |

**결정 ⑤의 변경(구현 중)**: "도구를 실제로 호출했을 때만 v3" → **"도구가 프롬프트에 들어갔으면 v3"**. Phase 4 규칙의 원리는 "프롬프트가 실제로 달라졌는가"이고, 도구 안내·선언은 호출 여부와 무관하게 프롬프트에 들어간다. 실제로 test 6건은 호출 0회였는데도 v1 과 답이 달랐다(확신도 전부 하락 — 6편 6-5). 호출로 가르면 그 6건이 v1 로 섞여 v1 이 오염된다. 호출 여부는 `tool_calls`(`[]` vs `null`)와 `stats.toolCalled` 가 말한다.

**실측에서 확인한 것(2026-09-22)**
- **test 세트 6건은 전부 "읽을 수 있는 파일 없음"이었다**(프론트 2 = 청크, 앱 1 = 소스맵 이전 빌드 `1.0.0+1`, 백엔드 2 = 로컬 dist 번들, 백엔드 1 = `node:net` 프레임뿐). Phase 4 의 평가 세트로는 도구의 효과를 잴 수 없다 — 배포 이후 새 이벤트로 새 세트가 필요하다.
- 도구 호출 0회여도 v3 는 확신도를 낮췄다(v1 high/medium → v3 low/medium). 좋은 변화인지는 채점 후.
- v3 연속 실행은 분당 2건(5×3 > 12) — 스크립트 `--delay 31000`.

### 명시적 비목표 (v1에서 하지 않는 것)
- iOS 스토어 배포(EAS 내부 배포 링크로 충분), 다국어, 다크모드 완성도,
  오프라인 평가 큐(확장 항목), 음성 입력(대화 중 언급되었으나 v1 범위 밖. Phase 4 완료 후 별도 검토).
  ※ refresh token 은 **비목표에서 제외됐다** — Phase 0 필수로 승격(§5.6).

---

## 10. Claude Code 작업 지침 요약

1. ~~**먼저 탐색**~~ → **완료(2026-09-15)**: 저장소 구조·백엔드 인증 코드·Sentry 설정·공유 타입 패키지를
   대조해 이 문서를 만들었다. 다시 탐색할 필요는 없고, **§11(물려받은 전제) → §5.6(토큰 전략) →
   Phase 0 순서로 읽고 바로 착수**하면 된다. 남은 `[확인 필요]` **3건**만 설치 시점에 확인한다.
2. **작게 진행**: Phase 0 안에서도 "Expo 생성 → 로그인 → 목록" 단위로 나눠
   각 단계마다 사용자가 실기기로 확인하게 하라.
3. **설명하며 진행**: 사용자는 RN 초보다. 새 개념(예: Expo Router, SecureStore)이
   처음 등장할 때 한 줄 설명을 곁들여라.
4. **버전은 문서를 믿지 말 것**: Expo/Sentry/내비게이션 라이브러리의 설치 방법과
   버전 호환은 반드시 설치 시점의 공식 문서로 확인하라.
5. **DoD 게이트**: 각 Phase의 DoD를 사용자와 함께 체크한 후에만 다음 Phase로
   넘어가라.
6. **백엔드 배포 절차를 지켜라**: `ops` 모듈 등 백엔드를 고치면
   로컬 이미지 빌드(`:latest` + `:<sha>` 2태그) → push → EC2 `pull` →
   (마이그레이션이 있으면 `run --rm ... migrate.js`) → `up -d` →
   **`nginx -t && nginx -s reload` (필수)** → `/v1/health` 의 `version` 단언.
   **마지막 reload 를 빠뜨리면 502 가 난다**(nginx 가 backend 이름→IP 를 시작 시 1회만 캐시하기 때문).
   전체 절차: [03-infra-nginx-runbook.md](./03-infra-nginx-runbook.md) §10

---

## 11. nginx/HTTPS 트랙에서 물려받은 전제 (2026-09-15)

> 이 앱의 **선행조건이었던 백엔드 HTTPS 가 확보된 상태**다. 배경은 [03-infra-nginx.md](./03-infra-nginx.md)(v2).

| 항목 | 값 / 주의 |
|---|---|
| Base URL | **`https://api.ansmoon.dev/v1`** (Let's Encrypt 인증서, 자동 갱신 구성 완료) |
| 서버 | EC2 `15.164.185.156`(새 AWS 계정, 서울). 컨테이너 5개: postgres · redis · backend · nginx · certbot |
| 포트 | 외부 공개는 **22(내 IP만) / 80 / 443** 뿐. **4000 은 열려 있지 않다** — 앱은 반드시 도메인으로 접속 |
| 업로드 크기 | nginx `client_max_body_size 10m` — 앱에서 이미지 업로드 시 상한 |
| SSE | `proxy_read_timeout 300s` + 백엔드의 `X-Accel-Buffering: no` → **스트리밍 응답이 프록시를 통과함이 검증됨** |
| 배포 | 백엔드 변경 시 **마지막에 nginx reload 필수**(§10-6) |

**레이트리밋 주의 (앱 설계에 영향)**

- 전역 `ThrottlerModule`: **100 req / 60초**. 인시던트 목록 폴링 주기·pull-to-refresh 연타를 이 한도 안에서 설계할 것.
- 로그인 IP 제한: **10회 / 5분**. 앱은 nginx 기준 1홉이라 **진짜 IP 로 기록**되므로,
  개발 중 로그인 실패를 반복하면 **본인 IP 가 5분간 잠긴다**(웹과 달리 Vercel IP 뒤에 숨지 않는다).

**앱과 무관한 것** — 웹 전용 이슈라 신경 쓸 필요 없다: CORS(`Origin` 미전송), Vercel rewrites/BFF,
웹 경로의 클라이언트 IP 복원 과제([03-infra-nginx.md](./03-infra-nginx.md) §10 의 12-1).

---

## 11-1. 관측 트랙에서 물려받은 전제 (2026-09-16 실측 갱신)

> 근거는 전부 [ex-observability-map.md](./ex-observability-map.md) 의 실측이다. 네 건 중 하나는 **이미 해소**됐고, 둘은 **착수 전에 처리**해야 하며, 하나는 **설계 자체의 한계**다.

### ✅ 해소됨 — `PROTOCOL` / `HOST` 지뢰

v2 에서 "RN 이 먼저 밟을 지뢰"로 지목했던 항목이다. 구 `.env` 의 `PROTOCOL=http` / `HOST=localhost:4000` 잔재 때문에 커서 페이지네이션의 `next` URL 이 `http://localhost:4000/...` 로 만들어지는 문제였다([common.service.ts:397](../../backend/src/common/common.service.ts#L397)). 웹은 `nextCursor` 만 쓰고 `next` 를 따라가지 않아 드러나지 않았다.

**EC2 환경변수 실측 결과 이미 교정돼 있다**: `PROTOCOL=https`, `HOST=api.ansmoon.dev`. 앱이 `next` 를 따라가도 안전하다. [03-infra-nginx.md §10 의 12-8](./03-infra-nginx.md) 은 완료로 봐도 된다.

### ⚠ 착수 전 처리 — 앱이 볼 인시던트가 반쪽이다

| 문제 | 앱에 미치는 영향 | 선행 작업 |
|---|---|---|
| **쇼핑몰 프론트의 API 실패가 Sentry 에 안 잡힌다** | 백엔드가 죽어도 **프론트 쪽 인시던트가 0건**이라 앱 피드에 아무것도 안 뜬다. 대조군 실험 2회 재현 | [블로그 글 §7](../blog/sentry-axios-silent-failure.md) 의 axios 리포터 적용 |
| **`/v1/health` 가 DB·Redis 를 안 본다** | postgres 만 죽는 장애를 앱이 인지할 수단이 없다. health 는 200 을 유지한다(실측) | health 에 readiness 추가([관측 지도 §7 ⑤](./ex-observability-map.md)) |

즉 **앱을 먼저 만들면 앱이 볼 것이 백엔드 예외뿐이다.** 관측 지도 §7 의 ④·⑤ 를 Phase 0 착수 전에 처리하는 편이 낫다.

> **진행(2026-09-20)**: 두 건 모두 코드 완료, Phase 1 착수 전 **jti 수정(`cedd6e1`)과 한 번의 배포로 묶기로** 했다. ④ 프론트 `reportApiError`(네트워크·5xx 만, 4xx·취소·비axios 에러 제외 — 단위 9건) ⑤ `GET /v1/health` 가 DB `SELECT 1` + Redis `PING`(각 2초 제한, 병렬)을 보고 하나라도 실패하면 **503** + `checks` 필드(단위 5건). 배포 상태는 관측 지도 §7 표를 본다.

### ⚠ 착수 전 처리 — Sentry API 토큰

폴링(§3.3)에 쓸 **Sentry 개인 인증 토큰**이 새 비밀값으로 늘어난다. 필요한 권한은 `org:read` · `project:read` · `event:read` 이고, **백엔드 환경변수에만** 둔다(§3.1 절대 규칙 2). 조직 슬러그도 함께 환경변수로 뺀다.

### ⛔ 설계의 구조적 한계 — 백엔드가 죽으면 이 앱도 죽는다

§3.1 의 절대 규칙 1("앱은 항상 백엔드 API 를 경유한다")은 보안상 옳지만 **대가가 있다.**

```
EC2 다운 → 백엔드 사망 → 폴링 스케줄러 정지 + 앱의 모든 요청 실패
        → 푸시가 나갈 수 없다 → 온콜 앱이 가장 심각한 장애에서 먹통
```

2026-09-16 에 실제로 16분간 이 상황이 있었다. **그래서 UptimeRobot 메일을 P1 통로로 계속 유지해야 한다** — 우리 인프라 밖에 있는 유일한 감시자이기 때문이다([관측 지도 §4-1](./ex-observability-map.md)).

이 한계를 없애려면 앱이 UptimeRobot API 를 **직접** 호출해야 하는데, 그러면 API 키가 앱 바이너리에 들어가 절대 규칙 2 를 위반한다. **v1 에서는 한계를 받아들이고 문서에 명시하는 쪽을 택한다.** 면접에서 "왜 이렇게 했나"를 설명할 수 있는 종류의 트레이드오프이므로, 숨기지 말고 이 문단을 근거로 말하면 된다.

### 📌 폴링 주기와 레이트리밋 — 혼동 주의

§11 의 "전역 `ThrottlerModule` 100 req/60초" 는 **앱이 백엔드를 부를 때**의 한도다. §3.3 의 폴링 스케줄러는 **백엔드가 Sentry 를 부르는** 바깥 방향이라 이 한도와 무관하다. 폴링이 신경 쓸 것은 Sentry 쪽 레이트리밋인데, 백엔드 한 대가 1~2분에 1회 조회하는 정도로는 닿지 않는다.
