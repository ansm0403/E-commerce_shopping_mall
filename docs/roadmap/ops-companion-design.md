# Ops Companion — 설계 문서 (v1)

> **이 문서를 읽는 Claude Code에게**
>
> 이 문서는 기존 쇼핑몰 프로젝트에 연동되는 새 React Native 앱 "Ops Companion"의 설계도다.
> 작성 시점에 실제 쇼핑몰 프로젝트의 코드 구조를 확인하지 못했으므로, 문서 곳곳에
> `[확인 필요: ...]` 마커가 있다. **작업을 시작하기 전에 반드시 아래 순서를 따라라.**
>
> 1. 현재 저장소(모노레포 여부 포함)의 전체 구조를 파악한다.
> 2. 이 문서의 모든 `[확인 필요]` 마커를 실제 프로젝트와 대조하여 확정하거나 수정한다.
> 3. 수정된 내용을 이 문서에 반영해 v2로 갱신한 뒤, 사용자에게 차이점을 요약 보고한다.
> 4. 그 후에만 Phase 0 구현을 시작한다.
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

`[확인 필요: 기존 프로젝트가 모노레포인지, 패키지 매니저(npm/yarn/pnpm)는 무엇인지,
공유 타입 패키지(예: @shopping-mall/shared)가 실재하는지 확인하고 앱 워크스페이스
추가 방식을 결정하라.]`

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
3. 앱에 넣어도 되는 것: 백엔드 base URL, Sentry **DSN**(이건 공개되어도 되는 값이지만
   `[확인 필요: DSN 취급 정책을 팀 기준으로 확정]`).

### 3.2 백엔드가 프록시(중개자)여야 하는 이유 (구현 근거)

- 보안: 키 은닉.
- rate limit 완충: 앱의 잦은 새로고침이 Sentry API rate limit을 직접 때리지 않게
  백엔드에서 캐싱/집계 가능.
- 데이터 가공: Sentry의 raw JSON을 앱이 쓰기 좋은 형태로 축약해 응답 크기 절감.

### 3.3 푸시 알림 파이프라인 (Phase 1)

```
Sentry (쇼핑몰 프로젝트에 이미 연동됨)
   │  webhook (신규 인시던트/알림 규칙 발동 시)
   ▼
NestJS: POST /ops/webhooks/sentry  ← 신규 엔드포인트
   │  1) payload 검증  2) 인시던트 요약 저장(선택)  3) 푸시 발송
   ▼
Expo Push Service ──→ 사용자 기기
   │  알림 payload에 딥링크 데이터 포함: { incidentId: "..." }
   ▼
알림 탭 → 앱이 딥링크 해석 → 인시던트 상세 화면 직행
```

`[확인 필요: 현재 Sentry 프로젝트에 Slack 연동/알림 규칙이 어떻게 설정되어 있는지
확인. 기존 Slack 알림 규칙을 복제해 webhook 액션을 추가하는 방식을 우선 검토하라.]`

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
  3) AI API 호출 (스트리밍 여부는 [확인 필요: 기존 assistant SSE 인프라 재사용
     가능한지 확인 후 결정])
  4) 응답 JSON 파싱 + 스키마 검증 (zod 등). 실패 시 1회 재시도 → 그래도 실패면
     구조화 실패 상태로 응답 (앱은 fallback UI 표시)
  5) 분석 결과 저장 (5.4 데이터 모델)
   ▼
앱: 구조화된 카드 UI로 렌더링 (심각도 뱃지 / 원인 / 추천 조치 / 관련 파일)
```

**AI 응답 방어 처리(중요)**: AI는 스키마를 어길 수 있다. 파싱 실패 시 앱 화면이
깨지지 않도록 (a) 백엔드에서 검증, (b) 앱에서 optional 필드 방어 렌더링,
(c) 실패 상태 전용 UI를 반드시 구현한다. 이 방어 처리 자체가 포트폴리오 어필 포인트다.

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
- 이메일/비밀번호 → 기존 백엔드 로그인 API 호출.
  `[확인 필요: 기존 로그인 엔드포인트 경로, 요청/응답 필드(accessToken,
  refreshToken 유무)를 실제 코드에서 확인해 반영하라.]`
- 성공 시: SecureStore에 토큰 저장 → AuthContext.user 세팅 → 자동으로 AppTabs 전환.
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
| `GET /ops/incidents` | Sentry API 프록시. 인시던트 목록(축약형) | 0 |
| `GET /ops/incidents/:id` | 인시던트 상세(스택트레이스, breadcrumbs 포함) | 1 |
| `POST /ops/devices` | 기기 Expo push token 등록 | 1 |
| `POST /ops/webhooks/sentry` | Sentry webhook 수신 → 푸시 발송 | 1 |
| `POST /ops/incidents/:id/analysis` | AI 분석 생성(또는 캐시된 분석 반환) | 3 |
| `GET /ops/analyses/pending` | 평가 대기 중인 분석 목록 | 4 |
| `POST /ops/analyses/:id/review` | 평가 저장 (verdict, rating) | 4 |

- 인증: 기존 JWT 가드 재사용. `[확인 필요: 기존 가드/데코레이터 명칭과
  관리자 권한 체크 방식을 확인해 동일하게 적용하라.]`
- webhook 엔드포인트는 JWT 대신 서명/시크릿 검증
  `[확인 필요: Sentry webhook 서명 검증 방식을 공식 문서로 확인하라.]`

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

`[확인 필요: 기존 ORM(TypeORM/Prisma 등)과 마이그레이션 방식을 확인해 동일한
방식으로 작성하라.]`

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
```

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
- axios 인스턴스 1개를 `src/lib/api.ts`에 두고, 요청 인터셉터에서 SecureStore의
  토큰을 Authorization 헤더에 자동 첨부. 401 응답 시 로그아웃 처리
  (refresh token 흐름은 `[확인 필요: 기존 백엔드에 refresh 엔드포인트가 있으면
  연동, 없으면 Phase 2 이후 과제로 미룸]`).

---

## 6. Sentry 계측 계획 (역할 B: 이 앱 자신의 관측)

| 항목 | 내용 | Phase |
|---|---|---|
| 기본 설치 | `@sentry/react-native` init (앱 전용 Sentry 프로젝트를 새로 만들 것. 쇼핑몰 프로젝트와 분리) | 0 |
| beforeSend | 노이즈 필터(개발 중 의도적 에러 태그 제외) + PII 마스킹(이메일 등) | 2 |
| 소스맵 | Hermes 소스맵 업로드. EAS Build와 연동해 자동화 `[확인 필요: 설치 시점의 sentry-expo/@sentry/react-native 공식 가이드 확인]` | 2 |
| Release Health | 릴리즈 태깅 → crash-free sessions 추적. S2 요약 카드의 데이터 원천 | 2 |
| AI 호출 계측 | `POST /analysis` 요청을 커스텀 span으로 감싸 지연/실패율 추적. "AI를 관측한다"는 차별화 포인트 | 3 |
| 태그 | `screen`, `appVersion`, 로그인 사용자 id(마스킹 규칙 적용) | 2 |

**요금 안전장치 (필수 설정):** 무료 Developer 플랜 사용. 조직 설정에서
pay-as-you-go/spend limit을 0으로 두어 한도 초과 시 과금 대신 수집 중단되게 한다.
무한 루프성 에러(렌더 루프 안 throw 등)를 조심한다.

---

## 7. 보안 원칙 (전 Phase 공통)

1. Sentry API 토큰·AI API 키는 백엔드 환경변수에만 존재. 앱 코드·app.json·
   EAS secrets 어디에도 넣지 않는다 (앱은 디컴파일로 노출됨).
2. JWT는 SecureStore에만 저장. AsyncStorage 금지.
3. 로그아웃 시 SecureStore 토큰 삭제 확인.
4. beforeSend에서 이벤트 내 PII(이메일/전화번호) 마스킹.
5. webhook은 서명 검증 없이는 처리하지 않는다.

---

## 8. 폴더 구조 제안 (앱)

`[확인 필요: 모노레포라면 apps/ops-companion 등 기존 컨벤션에 맞춰 위치 결정.
아래는 앱 내부 구조 제안이며, Expo Router 채택 시 app/ 디렉토리 규칙이 우선한다.]`

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
│   └── types/                  # [확인 필요: 공유 패키지 있으면 그쪽으로]
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
- 구현: Expo 프로젝트 생성, AuthContext + SecureStore 로그인, axios 인터셉터,
  `GET /ops/incidents` 백엔드 프록시, S1/S2/S6 화면, Sentry 기본 설치
- DoD: 실기기(안드로이드)에서 로그인 → 인시던트 목록 조회 → 앱 재시작 후에도
  로그인 유지 → 로그아웃이 전부 동작. 의도적 에러 1건이 Sentry 대시보드에 보임.

### Phase 1 — "웹이 아닌 진짜 앱" (푸시 + 딥링크)
- 구현: push token 등록, Sentry webhook → 백엔드 → Expo 푸시, 딥링크 3상태
  (포그라운드/백그라운드/종료) 처리, S3 상세 화면
- DoD: 쇼핑몰에서 에러 발생 → 폰 푸시 수신 → 탭 → (앱이 꺼져 있어도) 해당
  인시던트 상세로 진입. 이 데모가 영상으로 녹화 가능해야 함.

### Phase 2 — 관측성 심화 + 보안 UX
- 구현: 소스맵 업로드(EAS 연동), Release Health, beforeSend(필터+PII),
  crash-free 요약 카드, 생체 인증
- DoD: 프로덕션 빌드의 에러가 Sentry에서 원본 파일:라인으로 복원되어 보임.
  릴리즈별 crash-free 수치가 대시보드와 앱 카드 양쪽에 표시.

### Phase 3 — AI 분석
- 구현: 백엔드 분석 파이프라인(3.4), 스키마 검증 + 재시도 + 실패 fallback,
  S4 화면, AI 호출 Sentry span 계측
- DoD: 실제 인시던트에 대해 구조화 카드가 렌더됨. AI가 스키마를 어긴 경우에도
  앱이 깨지지 않고 fallback UI가 표시됨(강제 실패 테스트 포함).

### Phase 4 — 평가 루프 (human-in-the-loop)
- 구현: S5 스와이프 카드 + 별점 + 낙관적 업데이트, 평가 저장, few-shot 주입
  (승인된 분석 상위 N개를 프롬프트에 포함), promptVersion 관리
- DoD: 평가 10건 이상 축적 후, few-shot 적용 전/후 분석 품질 차이를 스크린샷
  또는 승인율 수치로 비교할 수 있음.

### 명시적 비목표 (v1에서 하지 않는 것)
- iOS 스토어 배포(EAS 내부 배포 링크로 충분), 다국어, 다크모드 완성도,
  오프라인 평가 큐(확장 항목), 음성 입력(대화 중 언급되었으나 v1 범위 밖.
  Phase 4 완료 후 별도 검토), refresh token(기존 백엔드에 있을 때만).

---

## 10. Claude Code 작업 지침 요약

1. **먼저 탐색**: 저장소 구조, 백엔드 인증 코드, 기존 service/ 레이어,
   Sentry 설정, 공유 타입 패키지를 읽고 이 문서의 모든 `[확인 필요]`를 해소한 v2
   문서를 만들어 사용자에게 보고하라.
2. **작게 진행**: Phase 0 안에서도 "Expo 생성 → 로그인 → 목록" 단위로 나눠
   각 단계마다 사용자가 실기기로 확인하게 하라.
3. **설명하며 진행**: 사용자는 RN 초보다. 새 개념(예: Expo Router, SecureStore)이
   처음 등장할 때 한 줄 설명을 곁들여라.
4. **버전은 문서를 믿지 말 것**: Expo/Sentry/내비게이션 라이브러리의 설치 방법과
   버전 호환은 반드시 설치 시점의 공식 문서로 확인하라.
5. **DoD 게이트**: 각 Phase의 DoD를 사용자와 함께 체크한 후에만 다음 Phase로
   넘어가라.
