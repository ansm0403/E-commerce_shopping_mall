# AI 통합 — 관리자 AI 어시스턴트 (사내 데이터 + LLM 연동 · 계획 외 삽입 · ex- 트랙)

> **ex- 트랙**: 메인 시퀀스(셀러 → 관리자 → 인프라) 밖에서 삽입되는 작업.
> 이 문서는 *회고*가 아니라 **착수 전 계획 + 처음 배우는 분야의 학습 노트**다.
> §0~6은 지금 작성(계획·학습), §7~8은 진행하며 채운다(파일 매핑·트러블슈팅).
>
> 관련 문서: [PROJECT_DOSSIER.md](../etc/PROJECT_DOSSIER.md) §3-17(AI 활용 — 현재 공백),
> [ex-sentry-slack.md](./ex-sentry-slack.md), [ex-audit-log-admin.md](./ex-audit-log-admin.md)

<br>

---

## 0. 한 줄 결론

쇼핑몰의 **실제 사내 데이터(매출·주문·감사로그·상품·리뷰)** 위에 **관리자 AI 어시스턴트**를 올린다.
관리자가 자연어로 묻거나("지난달 카테고리별 매출 보여줘", "지난주 의심스러운 로그인 분석해줘"),
AI가 **Tool Use(함수 호출)** 로 **기존 NestJS 서비스 메서드를 호출** → 결과를 받아 분석·요약해 답한다.

- **왜**: 채용 공고 "사내 데이터와 LLM/SLM 연동"의 핵심 역량을 *실데이터*로 증명. DOSSIER §3-17의 유일한 공백(런타임 AI 통합 ❌)을 메움.
- **어디까지(MVP)**: 관리자 어시스턴트(Tool Use 기반). **이후 후속으로 구매자 챗봇**(§5 Phase 8).
- **왜 통합(별도 프로젝트 X)**: 진짜 비즈니스 스키마가 이미 있어 "연동"이 공짜로 증명됨. 인증·DB·배포 배관 재사용. 신입은 깊은 1개 > 얕은 2개.
- **LLM 프로바이더 전략**: `intrastructure/ai/`에 **프로바이더 비종속 LLM 클라이언트 인터페이스**를 두고, **현재는 Gemini(무료 티어)로 구현**, 추후 **Claude로 전환**. 비용 때문이며, Tool Use 아키텍처는 프로바이더가 바뀌어도 동일하다(§4-1).

> **핵심 통찰 — 이 패턴은 회사가 바뀌어도 그대로 쓰인다.**
> "기존 백엔드 서비스를 LLM의 도구로 노출 → AI가 사내 데이터를 질의·분석"은 **도메인 비종속적**이다.
> 쇼핑몰이면 매출/주문, 다른 회사면 CRM·재고·로그 — 데이터 소스만 바뀌고 구조는 동일.
> 즉 쇼핑몰은 *이 역량을 실데이터로 연습하는 연습장*이다.

<br>

---

## 1. 배경 — 왜 쇼핑몰 관리자 AI 어시스턴트인가

### 1-1. 공고 적합성 (왜 지금, 왜 이걸)

대상 직무: **AI SaaS 개발팀** — "사내 AI 기반 SaaS / 챗봇 서비스 고도화 / **사내 데이터와 LLM·SLM 연동**".

| 공고 요구 | 쇼핑몰이 증명하나 |
|---|---|
| 웹 백엔드/프론트엔드 프레임워크 (필수) | ✅ 이미 과증명 (NestJS 11 + Next.js) |
| RESTful API 설계 + DB 활용 (필수) | ✅ 이미 과증명 (TypeORM/PG/Redis) |
| **사내 데이터와 LLM 연동 (직무 핵심)** | ❌ **이 작업이 메우는 유일한 공백** |
| LLM API 활용 경험 (우대) | ❌ → 이 작업으로 충족 |

쇼핑몰은 필수 요건을 다 덮었고 **부족한 건 LLM 연동 하나**다. 노력을 그 공백에만 쓰고 나머지(인증·DB·배포·관측성)는 재활용한다.

### 1-2. 왜 통합인가 (별도 프로젝트 / AID 아님)

- **별도 챗봇 프로젝트 X** — 그린필드 챗봇은 가짜 데이터라 "사내 데이터 연동"을 증명 못 함. 쇼핑몰엔 진짜 스키마(주문·정산·감사로그·KPI)가 이미 있어 "연동"이 공짜로 증명됨.
- **AID(Object Detection Viewer) X** — 데이터가 이미 화면에 전부 시각화돼 있어 LLM이 *유일하게 풀어줄 작업*이 없음. (AID는 멀티카메라/radar·Nest 백엔드로 키우는 게 맞음.)
- **신입 전략** — 얕은 프로젝트 2개보다 깊은 1개. LLM 대표 통합은 쇼핑몰 하나로 못 박는다.

### 1-3. DOSSIER §3-17 현황 (이 작업의 출발점)

> 현재 §3-17: "런타임 AI API 통합 ❌ 부재 / 활용 깊이 ★★☆☆☆ / RAG·임베딩·벡터DB 부재".
> 본인 메모: *"추후 postgres MCP를 연결하여 내부 데이터를 모델이 직접 다루도록 시도할 것임."*

이 작업이 §3-17을 ❌ → ⭕ 로 격상시키고, 자기소개 후킹 카드를 바꾼다. (완료 후 §9에서 갱신)

<br>

---

## 2. LLM API 기초 primer ★ (이 분야 처음이라 핵심)

> 이 섹션은 "지속 참조용 기초"다. 나중에 잊어도 여기만 보면 복기된다.
> 모델 ID·가격은 작성 시점(2026-06) 기준. 변동 시 공식 문서(platform.claude.com) 확인.

### 2-1. 가장 큰 오해 — "LLM API는 그냥 stateless HTTP API다"

- 본질은 엔드포인트 **하나** (`POST /v1/messages`). JSON 보내고 JSON 받는다. PortOne 웹훅 호출과 다르지 않다.
- **완전히 stateless** — 서버는 직전 대화를 기억하지 않는다. "기억하는 챗봇"은 *매 요청마다 지금까지의 대화 전체를 다시 통째로 보내는 것*이다. (PostgreSQL에 대화 저장 → 다음 턴에 다 긁어 전송)
- NestJS 입장에선 "Anthropic이라는 외부 API를 호출하는 service 하나 추가"일 뿐.

### 2-2. 기본 호출 구조 — 필드 4개

```typescript
const res = await client.messages.create({
  model: "claude-sonnet-4-6",     // ① 어떤 모델 (§2-6 참고)
  max_tokens: 1024,               // ② 응답 최대 길이(토큰). 짧으면 문장 중간에 잘림
  system: "너는 쇼핑몰 관리자 어시스턴트다. ...",  // ③ 역할/규칙 (매 요청 보냄)
  messages: [                     // ④ 대화 내용 (user/assistant 번갈아)
    { role: "user", content: "이번 달 매출 알려줘" },
  ],
});
// res.content[0] 의 type 을 확인하고 .text 접근
```

- **토큰(token)**: LLM이 글자를 세는 단위. 한글 1글자 ≈ 1~2토큰. 비용·길이 다 토큰 기준. 정확히는 `count_tokens` API. (OpenAI용 `tiktoken` 쓰지 말 것 — 부정확)

### 2-3. Tool Use (함수 호출) — 이 프로젝트의 핵심 ★

너의 "사내 DB를 검색해 데이터를 찾아온다"에 정확히 대응. **AI가 너의 백엔드 함수를 호출하게** 한다.

```
1. 너 → AI: "이런 도구 쓸 수 있어" (예: get_monthly_sales(month))
2. 사용자 → AI: "지난달 매출 알려줘"
3. AI → 너: "나 get_monthly_sales('2026-05') 호출해줘"   ← 실행 X, 요청만
4. 너의 NestJS 코드가 실제로 기존 통계 서비스 실행 → 결과를 AI에 다시 전달
5. AI → 사용자: 그 결과를 자연어로 정리해 답변
```

```typescript
tools: [{
  name: "get_monthly_sales",
  description: "특정 월의 매출을 조회한다",   // AI는 이 설명 보고 언제 쓸지 판단 — 트리거 조건을 명시
  input_schema: {
    type: "object",
    properties: { month: { type: "string", description: "YYYY-MM" } },
    required: ["month"],
  },
}]
```

**왜 이 방식인가 (raw SQL 대신):**
- AI가 SQL을 직접 짜서 DB를 건드리는 게 아니라, **네가 만든 NestJS 서비스 메서드를 호출**. → 기존 `JwtAuthGuard`/`RolesGuard` 권한·검증이 그대로 적용. SQL 인젝션 위험 없음.
- "에이전트 / tool use" = 요즘 LLM 직무가 실제로 원하는 역량.
- SDK의 **tool runner**가 위 2~4 루프(호출→실행→재전달)를 자동 처리해준다. (세밀한 권한 게이트가 필요하면 수동 루프)

### 2-4. RAG (검색 증강 생성)

"데이터를 넘겨주면 분석해준다"에 대응. 특히 **리뷰/문의 같은 비정형 텍스트**에 적합.

```
사용자 질문 → 관련 문서를 먼저 검색 → 그 문서를 프롬프트에 같이 넣어 "이 자료 근거로 답해"
```

- 가장 단순한 RAG = **관련 데이터를 그냥 텍스트로 붙여 보내는 것**. 벡터DB·임베딩은 데이터가 방대할 때의 고급 버전 (Phase 5).
- **정리**: 정형 데이터(매출/주문 숫자) → **Tool Use**. 비정형 텍스트(리뷰/문의) → **RAG**. 어시스턴트는 둘을 섞어 쓴다.

### 2-5. 스트리밍 / 멀티턴

- **멀티턴** = 직접 누적. `messages` 배열에 user/assistant를 쌓아 DB 저장 → 매 요청 다시 전송. 이게 "기억"의 실체.
- **스트리밍** = ChatGPT처럼 글자가 또르륵. `client.messages.stream()`. 채팅 UX엔 거의 필수. (긴 응답일수록 타임아웃 방지 위해서도 권장)

### 2-6. 모델 / 비용 / 캐싱

> 아래 개념(토큰 과금·캐싱)은 **프로바이더 공통**이다. 모델 표는 프로바이더별로 다르다.

**현재 선택 — Gemini (무료 티어)**
- 학습/개발용으로 **무료 티어**가 후해 비용 0에 가깝다 → 자금 절약기에 적합.
- 모델은 **`gemini-3.1-flash-lite`**(비-thinking, 빠르고 무료 한도 넉넉)로 시작. SDK는 **`@google/genai`**(구 `@google/generative-ai`는 deprecated).
- **무료 티어 한도 — 모델별로 크게 다름(작성 시점, 본인 AI Studio에서 재확인 필수)**:
  - `gemini-3.5-flash`는 **thinking 모델**이라 무료 RPD가 매우 작다(실측 **~20/day**). 답을 큰 덩어리로 내보내 **스트리밍 체감이 약하고** 토큰(thoughts 포함)도 크다. → 정교한 분석이 필요할 때만 한시적으로.
  - `gemini-3.1-flash-lite`/`gemini-2.5-flash-lite`(비-thinking)는 RPD가 훨씬 넉넉하고 토큰을 잘게 흘려 **스트리밍이 또르륵** 흐른다. → **어시스턴트 기본**.
  - ⚠ "1,500 RPD" 같은 수치는 모델·시기마다 다르니 신뢰하지 말고 콘솔에서 확인.
  - 대화형 어시스턴트(admin 1명, human-paced)는 RPD/RPM 모두 여유. 단 **tool use는 질문 1건당 API 왕복 2~3회**(질문→도구요청→도구결과→답)라 누적되므로, **429 발생 시 지수 백오프 재시도**(1→2→4초)를 클라이언트에 넣는다.
- **⚠ 데이터 프라이버시(무료 티어 핵심)**: **AI Studio 무료 티어로 입력한 데이터는 Google의 모델 학습에 활용될 수 있다.** 본 프로젝트는 **시드/데모 데이터** 기준이라 시연상 무해하지만, **실 PII(이메일·IP·고객 텍스트)가 도구 결과에 섞이는 순간 무료 티어로 보내면 안 된다.** → 도구별 데이터 등급은 §3-2, 정책은 §4-2 참조. **유료(Claude·Vertex AI)는 기본적으로 입력을 학습에 쓰지 않으므로 전환 시 해소.**

**추후 전환 대상 — Claude (참고)**

| 모델 | ID | 입력/출력 ($/1M토큰) | 용도 |
|---|---|---|---|
| Opus 4.8 | `claude-opus-4-8` | $5 / $25 | 가장 똑똑, 복잡한 분석/에이전트 |
| Sonnet 4.6 | `claude-sonnet-4-6` | $3 / $15 | 속도·지능 균형 |
| Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | 가장 빠르고 쌈 (Claude 중 최저가) |

- **비용 구조**: 입력 토큰 + 출력 토큰으로 과금. 대화가 길수록 매번 전체 기록을 다시 보내 **입력 토큰이 계속 불어난다.** (프로바이더 공통)
- **프롬프트 캐싱**: 매번 똑같이 보내는 부분(긴 system 프롬프트, 도구 정의)을 캐싱하면 더 싸진다. 비용 최적화 핵심 (Phase 6). *지원 방식·할인율은 프로바이더마다 다름.*
- **키 관리**: 프로바이더 키를 **환경변수**로(현재 `GEMINI_API_KEY`, 추후 `ANTHROPIC_API_KEY`). 코드 하드코딩 절대 금지. 키 없으면 기능 비활성(Sentry DSN no-op 패턴).

<br>

---

## 3. 기능 설계 — 관리자 AI 어시스턴트

### 3-1. 범위 / 왜 admin부터

- **대상**: `admin` 역할 사용자. `(admin)/admin/*` 영역에 어시스턴트 추가.
- **왜 admin부터**: (1) 가장 풍부한 사내 데이터(매출·감사로그·KPI)가 admin 영역에 있음 — "사내 데이터 연동" 서사가 가장 강함. (2) 이미 만든 대시보드·감사로그 위에 AI 레이어를 얹는 자연스러운 확장. (3) 권한이 좁아 안전.
- **이후**: 구매자 챗봇(상품 검색/추천/문의) = Phase 8.

### 3-2. 노출할 tool 목록 (기존 서비스 매핑)

> 착수 시 각 서비스의 **정확한 메서드 시그니처를 소스에서 확인**한 뒤 연결한다(추측 금지).
> 아래는 "어떤 도구가 어떤 기존 모듈에 매핑되는가"의 설계 후보.

| tool (후보) | 하는 일 | 매핑 대상 모듈 | 데이터 성격 | PII / 무료티어 전송 안전? |
|---|---|---|---|---|
| `get_sales_summary` | 기간/카테고리별 매출 집계 | admin 대시보드/통계 서비스 (`DashboardService.getSalesSummary` 신설) | 정형 | ✅ **집계 숫자만(PII 0)** — 무료티어 안전 |
| `get_order_stats` | 주문 추이·상태별 카운트 | order / admin | 정형 | ✅ 집계 카운트 — 안전 |
| `query_audit_logs` | 감사로그 조건 검색·요약 | audit / admin (`GET /v1/admin/audit-logs`) | 정형 | ⚠ **이메일·IP 포함** — 무료티어 시 마스킹/비식별화 |
| `get_product_info` | 상품/재고/승인상태 조회 | product / category | 정형 | ✅ 공개 상품정보 — 안전 |
| `summarize_reviews` | 특정 상품/기간 리뷰 요약 | review | 비정형(RAG 후보) | ⚠ **고객 작성 텍스트** — 무료티어 시 비식별화 |
| `summarize_inquiries` | 미답변/부정 문의 요약 | inquiry | 비정형(RAG 후보) | ⚠ **고객 작성 텍스트** — 무료티어 시 비식별화 |

- MVP는 **`get_sales_summary` 1개**부터 (Phase 3). 나머지는 Phase 4에서 확장.
- 정형 도구 = Tool Use. 비정형(리뷰/문의) = Phase 5에서 RAG로.
- **데이터 등급 게이트**: 위 "PII" 열이 ⚠인 도구(`query_audit_logs`·`summarize_*`)는 무료(Gemini) 단계에서 **마스킹/비식별화 후 전송**하거나, **유료(Claude·Vertex) 전환 후 활성화**한다. **MVP(`get_sales_summary`)는 집계 숫자뿐이라 무료티어에서도 프라이버시 이슈가 없다.**

### 3-3. 데이터 흐름

```
[관리자] 자연어 질문
   │  (프론트: (admin)/admin/assistant, authClient + 스트리밍)
   ▼
[NestJS  ai/ 모듈]  ── messages + tools 정의 ──▶ [Anthropic API]
   ▲                                                  │
   │  ④ tool 실행 결과 재전달                          │ ③ "이 도구 호출해줘"
   │                                                  ▼
   └──── ② 기존 서비스 메서드 실행 (RolesGuard 통과) ◀──┘
            (order/audit/admin/product/review ...)
   ▼
[Anthropic API] ── ⑤ 자연어 답변(스트리밍) ──▶ [관리자]
   │
   └── 대화 기록은 PostgreSQL 저장 (멀티턴)
```

### 3-4. 아키텍처 (모듈 위치)

- **백엔드**: `backend/src/intrastructure/ai/` (Redis/email 모듈과 같은 결의 인프라 모듈). LLM 클라이언트 래퍼 + tool 정의/디스패치 + 대화 영속화.
  - **프로바이더 추상화(핵심)**: `LlmClient` 인터페이스(예: `chat(messages, tools, opts) → 응답/스트림`)를 두고, 그 뒤에 **`GeminiClient`(현재)** 와 **`ClaudeClient`(추후)** 구현을 둔다. 어시스턴트 서비스·tool 디스패처는 인터페이스에만 의존 → 프로바이더 교체 시 구현체 + env만 바꾸면 됨.
  - tool 정의는 프로바이더별 포맷이 조금 다르므로(이름/스키마는 거의 동일, 래핑만 차이), **중립 tool 정의 → 프로바이더 어댑터에서 변환**하는 구조로.
  - 엔드포인트(후보): `POST /v1/admin/assistant/chat` (스트리밍, `@Roles('admin')` + `JwtAuthGuard`).
  - tool 디스패처는 기존 서비스를 **DI로 주입**받아 호출 (권한·검증 재사용).
- **프론트**: `frontend/src/app/(admin)/admin/assistant/` 채팅 UI. `lib/axios`의 `authClient` 또는 fetch 스트리밍. `(admin)/admin/components/AdminGuard` 보호 영역.
- **공용 타입**: 메시지/도구 결과 타입은 `@shopping-mall/shared`에 둘지 검토.

<br>

---

## 4. 기술 결정 사항

### 4-1. 프로바이더 / 모델 선택 ★

**프로바이더 전략 (비용 사유):**
- **현재: Gemini** — 무료 티어로 자금 절약기(개발/학습) 동안 비용 0에 가깝게. **Gemini Flash 계열**로 시작.
- **추후: Claude로 전환** — 자금 여유 시. 전환 비용을 낮추기 위해 **`LlmClient` 인터페이스로 추상화**(§3-4). 전환 시 바뀌는 것: 구현체(`ClaudeClient`) + env 키 + 모델 문자열뿐. tool/권한/DB 로직은 그대로.
- **왜 추상화까지** — Tool Use 아키텍처가 프로바이더 비종속이라(셋 다 chat+function calling+streaming 지원) 인터페이스 한 겹이면 락인이 없다. 포트폴리오에서 "프로바이더 추상화" 자체도 설계 어필.

**모델 tier (프로바이더 내):**
- Gemini: **`gemini-3.1-flash-lite` 기본**(비-thinking, 스트리밍 양호 + 무료 RPD 넉넉). 정교한 분석이 필요하면 `gemini-3.5-flash`(thinking, RPD 작음) 한시 상향.
- Claude(추후): Sonnet 4.6 기본 / Opus 4.8 상향 / Haiku 4.5 저가·라우팅.
- 모델 선택은 **설정값(env `GEMINI_MODEL`)으로** 빼서 교체 가능 — **코드 변경 없이 env 한 줄로 전환**(이번에 thinking 모델→flash-lite 교체로 실증).

> ⚠ 구현 시 Gemini의 정확한 모델 ID·SDK 패키지·tool(function calling) 문법은 **공식 문서에서 직접 확인**. (Claude Code의 학습 지식이 Gemini 최신과 다를 수 있음 — 추측 금지.)

### 4-2. 보안 (가장 중요)
- **API 키**: 프로바이더 키 env (현재 `GEMINI_API_KEY`, 추후 `ANTHROPIC_API_KEY`). 키 없으면 기능 no-op (Sentry 패턴).
- **권한**: 어시스턴트 엔드포인트는 `@Roles('admin')`. tool이 호출하는 기존 서비스도 자체 권한을 갖고 있어 **이중 방어**.
- **프롬프트 인젝션**: 사용자 입력으로 들어온 텍스트를 "명령"이 아니라 "데이터"로 다루도록 system 프롬프트 설계. tool은 **읽기 전용**부터(쓰기/삭제 도구는 신중히, 필요 시 사용자 확인 게이트).
- **민감 데이터**: tool 결과에 `@Exclude()` 대상(은행정보 등)이 섞이지 않게 — 기존 직렬화 정책 확인.
- **⚠ 데이터 프라이버시 (무료 티어 학습 활용) — 가장 구조적인 리스크**:
  - **사실**: Gemini **무료 티어(AI Studio)로 보낸 입력은 Google 모델 학습에 활용될 수 있다.** 우리 어시스턴트는 도구 결과로 사내 데이터를 LLM에 보내므로 "실데이터 위 AI"라는 서사와 정면으로 만난다.
  - **본 프로젝트의 실위험은 낮음**: admin 영역 데이터는 대부분 `seed/dashboard.seed.service`가 생성한 **시드/데모 데이터**이고, 관리자도 `DEMO_ADMIN` 데모 계정. 즉 시연 데이터는 합성이라 학습에 흘러가도 실害가 적다. → 문서의 "실제 사내 데이터" 표현은 **서사적 강조이며 실체는 시드 데이터**임을 전제한다.
  - **정책 (도구 단위 게이트, §3-2 PII 열)**:
    - `get_sales_summary` 등 **집계 숫자만** 반환하는 도구 → 무료티어 그대로 전송 OK. **MVP는 여기까지라 안전.**
    - `query_audit_logs`(이메일·IP)·`summarize_reviews/inquiries`(고객 텍스트) 등 **PII/비정형 텍스트** → 무료티어에선 **마스킹·비식별화 후** 전송하거나, **유료(Claude/Vertex AI) 전환 뒤 활성화**.
  - **운영/실데이터**: 무료티어로 실 PII를 보내지 않는다. 운영은 **학습 미사용이 보장되는 유료 API(Claude·Vertex AI)** 로만.
- **레이트리밋 / 429**: 무료티어 한도(`gemini-3.5-flash` 10 RPM / 1,500 RPD)는 대화형엔 여유지만, tool use는 질문당 API 왕복이 늘어난다. **GeminiClient에 429 지수 백오프 재시도**(1→2→4초)를 둔다. (실구현 Phase 1~2)

### 4-3. 비용 / 프롬프트 캐싱
- 긴 system 프롬프트 + tool 정의는 **prompt caching**으로 ~10% 가격 (Phase 6).
- 대화 길이 상한 / 오래된 턴 요약(compaction)으로 입력 토큰 폭증 제어.

### 4-4. 스트리밍
- 채팅 UX·타임아웃 방지 위해 스트리밍 적용. NestJS에서 SSE 또는 chunked 응답으로 프론트에 흘림.

### 4-5. 대화 영속화
- 대화/메시지 엔티티(TypeORM) 추가 검토. `BaseModel`(id/createdAt/updatedAt) 상속. (스키마는 `synchronize` — 운영 반영 주의, CLAUDE.md §3)
- 최소안: 세션당 메시지 배열만 저장. 멀티턴 복원 시 다시 전송.

<br>

---

## 5. 단계별 실행 로드맵 (각 Phase 그 자체로 시연 가능)

> 원칙: **각 단계가 끝나면 그 자체로 동작/시연**된다. MVP는 Phase 3까지.

### Phase 0 — 준비  ✅ 완료
- [x] **Gemini API 키 발급**(Google AI Studio) → `GEMINI_API_KEY` env (백엔드 `.env`, 운영 시 EC2 시크릿).
- [x] **Gemini SDK 설치** — `@google/genai` (백엔드 워크스페이스).
- [x] `intrastructure/ai/` 모듈 골격 + DI 등록. 키 없으면 no-op 가드.
- [x] **`LlmClient` 인터페이스 정의 + `GeminiClient` 구현** (프로바이더 추상화 — §3-4). 어시스턴트는 인터페이스에만 의존.
- [ ] (추후) `ClaudeClient` 구현체를 같은 인터페이스로 추가 → env로 전환. ← 자금 여유 시(미착수)

### Phase 1 — 단순 호출 (감 잡기)  ✅ 완료
- [x] `messages.create` 1회 호출하는 임시 엔드포인트/스크립트. system + user 1턴.
- [x] 응답 텍스트 확인. **"외부 API 한 번 호출"임을 체감.**
- 🎯 시연: 고정 질문 → AI 응답.

### Phase 2 — 멀티턴 + 스트리밍 + 프론트 채팅 UI  ✅ 완료
- [x] 대화 배열 누적 + DB 저장(또는 메모리 임시). ← Phase 2는 인메모리, Phase 2.5에서 DB로 승격
- [x] `messages.stream()` 으로 스트리밍, NestJS→프론트 SSE/chunked.
- [x] `(admin)/admin/assistant` 채팅 UI (입력창 + 스트리밍 렌더).
- 🎯 시연: 멀티턴 대화가 글자 흐르듯 나옴.

### Phase 2.5 — 대화 DB 영속화 (인메모리 Map → TypeORM)  ✅ 완료(2026-06-15)
- [x] `AssistantConversationEntity`(adminUserId 인덱스, title) + `AssistantMessageEntity`(conversationId, role, content) 신설, 둘 다 `BaseModel` 상속.
- [x] `AssistantService.conversations Map` 제거 → repo 기반. user 메시지는 호출 전, assistant 응답은 완성 후 저장.
- [x] 멀티턴 복원: conversationId 로 최근 `MAX_HISTORY`(20)개 메시지를 시간순 로드해 LLM에 재전송.
- [x] 소유권 검증: conversationId 가 와도 `adminUserId`(JWT sub) 불일치/미존재면 새 대화로 취급(타인 대화 차단). 컨트롤러가 `@User('sub')` 전달.
- [x] `AssistantModule`에 `forFeature([Conversation, Message])`. `autoLoadEntities`로 dev 스키마 자동 생성.
- [x] **UI 복원**(후속 추가): `GET /v1/admin/assistant/conversations/:id/messages`(소유권 필터) + 프론트가 `conversationId`를 localStorage에 저장 → 마운트 시 조회해 새로고침 후 직전 대화 복원 + "새 대화" 버튼. (Phase 2.5 백엔드 영속화만으론 브라우저 새로고침 시 UI가 비어 보였음 — DB엔 있으나 조회 경로/프론트 복원이 없었기 때문.)
- ⚠ **운영 반영**: 마이그레이션 없음(§3) → prod(`synchronize:false`)는 신규 테이블 2개 **수동 DDL** 필요. 기존 컬럼 변경 없음(신규 테이블뿐)이라 위험 낮음.
- 🎯 시연: 서버 재시작 후에도 conversationId로 대화 이어짐 + 브라우저 새로고침 후 직전 대화 UI 복원 + "어떤 admin이 무엇을 물었나"가 DB에 기록(감사 관점). 실 DB 확인: `assistant_conversations`(id=1, adminUserId=1) / `assistant_messages`(user+assistant 2행) 저장 검증됨.

### Phase 3 — Tool Use 1개 ★ ("사내 데이터 연동" 증명)  ✅ 완료
- [x] `get_sales_summary` tool(중립 정의 → Gemini function calling 포맷으로 변환) + 기존 통계 서비스에 디스패치 연결.
- [x] 호출→실행→재전달 루프 처리(Gemini function calling 흐름. Claude 전환 시 tool runner로 단순화 가능).
- [x] "지난달 매출?" → AI가 실제 DB 매출을 가져와 자연어로 답.
- 🎯 시연: **이 순간 "사내 데이터 연동" 성립. DOSSIER 3-17 ❌→⭕의 분기점.**

### Phase 4 — 도구 확장  ✅ 구현 완료(2026-06-15. query_audit_logs e2e 검증됨 / order·product e2e 대기)
- [x] `get_order_stats` → `DashboardService.getOrderStats(start,end)` **신설**(GROUP BY status, 집계만 → 무료티어 안전).
- [x] `query_audit_logs` → `AuditService.getAuditLogs(query)` + **디스패처 비식별화 마스킹**(email `t***@***`, IP 끝옥텟 마스킹, userAgent/metadata 드롭 — §4-2 데이터 등급 게이트). `assistant-masking.ts`.
- [x] `get_product_info` → `ProductService.findAllAdmin` + **안전필드 projection**(seller @Exclude 은행정보 등 raw 제외). findAllAdmin은 status/approvalStatus/sellerId만 필터(keyword/단건id 미지원)라 도구도 그 범위로 정직하게 좁힘.
- [x] system 프롬프트에 4개 도구 사용 가이드 보강. LlmClient 인터페이스 무변경(중립 타입 의존 유지).
- [x] query_audit_logs e2e: "지난주 로그인 실패 분석" → 감사로그 도구 호출 → 마스킹된(`10.0.*.*`) 요약 검증.
- [ ] (검증 대기) get_order_stats / get_product_info e2e + 여러 도구 연쇄 선택. — 무료 RPD 절약 위해 핵심 시나리오만.
- 🎯 시연: "지난주 의심스러운 로그인 분석" → 감사로그 도구 호출 → 마스킹된 요약.

### Phase 5 — RAG (비정형 데이터)  📋 계획 수립됨(2026-06-15) · 구현 다음 컨텍스트
> 소스 조사 완료. 구현 전 아래 "착수 시 확정할 결정"부터 정한 뒤 코딩.
> 메커니즘은 Phase 4와 동일(도구가 데이터 반환 → 모델이 요약). 다른 점은 **반환이 비정형 텍스트**라는 것 = "단순 RAG"(관련 텍스트를 프롬프트에 첨부해 모델이 그 위에서 추론). 임베딩/벡터검색은 5b로 분리.

**5a — 단순 RAG (먼저)**
- [ ] 도구 `summarize_reviews` — 상품/평점 조건으로 리뷰 텍스트를 모아 반환 → 모델이 요약.
- [ ] 도구 `summarize_inquiries` — 상태(미답변 등)/상품 조건으로 문의 텍스트를 모아 반환 → 모델이 요약.
- 🎯 시연: "최근 부정 리뷰 핵심만 요약", "미답변 문의 요약".

**5b — 임베딩/벡터 검색 (나중, 데이터 많아지면)**
- [ ] pgvector 등으로 의미 검색 후 상위 청크만 첨부. (현재 시드 규모엔 5a로 충분)

**소스 조사 결과 (추측 금지 — 실제 시그니처)**
- 리뷰: `ReviewService.getByProduct(productId, query)` 만 존재(productId 필수, relations `['user']`). **"전 상품 최근/부정 리뷰" 메서드 없음.** 엔티티 `ReviewEntity`: `rating(smallint)`, `comment(text)`, `imageUrls`, `userId`, `productId`. ⚠ `ReviewModule`은 `exports: [TypeOrmModule]`만 — **ReviewService 미export.**
- 문의: `InquiryService.getByProduct(productId, userId, query)`(비밀 마스킹은 buyer 기준), `getSellerInquiries(userId, query)`(셀러 한정). **"전 셀러 미답변 문의" 메서드 없음.** 엔티티 `InquiryEntity`: `title`, `content(text)`, `answer(text|null)`, `answeredAt`, `isSecret(bool)`, `status(waiting|answered)`. ⚠ `InquiryModule`은 **exports 없음.**

**실행안 (Phase 4 패턴 재사용)**
1. 읽기 전용 메서드 **신설**(getOrderStats처럼):
   - `ReviewService.getReviewsForAssistant({ productId?, maxRating?, take })` → `where productId?`, `rating <= maxRating?`(부정=≤2), `order createdAt DESC`, `take`(상한 50). 반환 `{ rating, comment, productId, createdAt }` — **user 관계 제외.**
   - `InquiryService.getInquiriesForAssistant({ status?, productId?, take })` → `where status?`(미답변=waiting), `productId?`, `order createdAt DESC`, `take`. 반환 `{ status, title, content, answer, productId, isSecret, createdAt }` — **user/seller 관계 제외.**
2. 모듈 export 추가: `ReviewModule.exports += ReviewService`, `InquiryModule.exports = [InquiryService]`. `AssistantModule`에 `ReviewModule`·`InquiryModule` import.
3. 도구 정의 2개(`assistant-tools.ts`) + 디스패처 case 2개(`assistant.service.ts`) + system 프롬프트 도구 안내 보강. LlmClient 인터페이스 무변경.
4. **비식별화(§4-2)**: 텍스트 자체가 요약 대상이라 통째 마스킹 불가 → **작성자 신원(user 관계) 미반환** + 본문 내 **이메일/전화번호 패턴 스크럽**(`assistant-masking.ts`에 `scrubText` 추가, `maskEmail` 재사용 + 전화 정규식).

**⚠ 착수 시 확정할 결정 (다음 컨텍스트 시작에서 질문)**
- (D1) **비밀 문의(isSecret=true)** 처리: (a) 본문 제외하고 건수만 / (b) 본문 마스킹 후 포함 / (c) 그대로 포함. → 무료티어 안전상 **(a) 권장.**
- (D2) 읽기 전용 메서드 신설 + 서비스 export 추가 OK? (getOrderStats 선례와 동일 — 권장 yes.)
- (D3) 5a(텍스트 첨부)만 이번에, 5b(임베딩)는 보류 — 시드 규모상 권장.

**🔧 Phase 6 프롬프트 캐싱 "준비" 메모(이번에 코드 변경 X, 설계 인지만)**
- 캐싱은 **안정적 prefix**(system 프롬프트 + tool 정의)가 핵심. 현재 `buildSystemPrompt()`에 **오늘 날짜가 섞여** 매일 prefix가 바뀜(하루 안엔 안정 — 캐시 TTL 짧아 실害 적지만), 캐싱 도입 시 **정적부(역할/규칙/도구안내) vs 동적부(날짜) 분리** 고려.
- tool 정의는 정적이라 캐싱 친화적. 도구가 늘수록(현재 4 → Phase5 후 6개) 정의 토큰이 커져 캐싱 이득 증가.
- LlmClient 인터페이스에 **usage(입력/출력/캐시적중 토큰) 노출**을 추가하면 Phase 6에서 적중률 측정 가능 — Phase 5 구현 중 자연스럽게 받아둘지 검토.
- 프로바이더별 캐싱 방식 상이(Gemini context caching vs Claude cache_control breakpoint) → 인터페이스 추상화가 여기서도 유효.

### Phase 6 — 비용 / 캐싱 최적화
- [ ] system 프롬프트·tool 정의에 prompt caching 적용(프로바이더별 지원 방식 확인 — Gemini/Claude 상이). 응답 usage로 캐시 적중 확인.
- [ ] 대화 길이 상한 / 오래된 턴 요약. 모델 tier 분기(단순 라우팅은 저가 모델).

### Phase 7 — 평가 (eval)
- [ ] 대표 질문 셋(golden set) 정의 → 응답 품질/도구 선택 정확도 측정.
- [ ] 회귀 방지: 프롬프트/모델 변경 시 eval 재실행.
- 🎯 산출물: "응답 품질을 어떻게 측정했는가"는 포트폴리오 PAAR의 Result.

### Phase 8 — (후속) 구매자 챗봇
- [ ] `(main)` 영역에 구매자용 챗봇: 상품 검색/추천/문의 응대.
- [ ] admin 도구와 분리된 **구매자 권한 도구 셋** (멀티테넌트/권한 분리 서사).
- 🎯 시연: 구매자가 "20만원대 노트북 추천" → 상품 검색 도구.

<br>

---

## 6. 완료 기준 (DoD)

**MVP (Phase 0~3):  ✅ 충족**
- [x] 관리자가 `(admin)/admin/assistant`에서 멀티턴 대화 (스트리밍).
- [x] 최소 1개 tool(`get_sales_summary`)이 **실제 DB 데이터**를 가져와 답에 반영됨. (Phase 4에서 4개로 확장)
- [x] 권한: 비-admin 접근 차단. 키 없으면 기능 no-op.
- [x] 대화 기록 영속화(Phase 2.5 DB 영속화 + 새로고침 UI 복원).

**전체 (Phase 4~8): 각 Phase의 🎯 시연 항목 충족 + §7 파일 매핑/§8 트러블슈팅 작성.**
- Phase 4 ✅ / Phase 5~8 미착수(5=RAG 다음 차례, 6=캐싱, 7=eval, 8=구매자 챗봇).

<br>

---

## 7. 파일 매핑 (조회용 — Phase 0~3 구현 완료)

**백엔드 — AI 인프라 (프로바이더 비종속)**
- LlmClient 인터페이스(중립 타입): `backend/src/intrastructure/ai/llm-client.interface.ts`
- DI 토큰: `backend/src/intrastructure/ai/ai.constants.ts` (`LLM_CLIENT`)
- 모듈(forRoot, global, LLM_PROVIDER 분기): `backend/src/intrastructure/ai/ai.module.ts`
- GeminiClient 구현(generate/generateStream/**generateWithTools**): `backend/src/intrastructure/ai/providers/gemini.client.ts`
- 앱 등록: `backend/src/app/app.module.ts` (`AiModule.forRoot()`)

**백엔드 — 어시스턴트 도메인 (admin 하위)**
- 컨트롤러(`POST .../chat`, `POST .../stream` SSE, `GET .../conversations/:id/messages` 복원, `@User('sub')` adminUserId): `backend/src/admin/assistant/assistant.controller.ts`
- 서비스(시스템 프롬프트·멀티턴 **DB 영속화**·도구 디스패처·projection): `backend/src/admin/assistant/assistant.service.ts`
- 도구 정의(LlmToolDef): `backend/src/admin/assistant/assistant-tools.ts` (`get_sales_summary`, `get_order_stats`, `query_audit_logs`, `get_product_info`)
- PII 비식별화 헬퍼: `backend/src/admin/assistant/assistant-masking.ts` (`maskEmail`/`maskIp`/`maskAuditLogs`)
- 대화 영속화 엔티티(BaseModel 상속): `backend/src/admin/assistant/entity/conversation.entity.ts`, `entity/message.entity.ts`
- DTO: `backend/src/admin/assistant/dto/chat-request.dto.ts`
- 모듈: `backend/src/admin/assistant/assistant.module.ts` (AuthModule + AdminModule + AuditModule + ProductModule + forFeature[Conversation,Message])
- 도구 대상 메서드:
  - `backend/src/admin/dashboard/dashboard.service.ts` → `getSalesSummary(start,end)`, `getOrderStats(start,end)` (AdminModule exports)
  - `backend/src/audit/audit.service.ts` → `getAuditLogs(query)` (AuditModule exports) — 결과는 `maskAuditLogs`로 비식별화 후 LLM 전송
  - `backend/src/product/product.service.ts` → `findAllAdmin(query)` (ProductModule exports) — `projectProduct`로 안전필드만

**프론트**
- 채팅 UI(새로고침 복원: localStorage conversationId + 마운트 fetch, "새 대화" 버튼): `frontend/src/app/(admin)/admin/assistant/components/AssistantChat.tsx` + `page.tsx`
- SSE 파서(fetch + ReadableStream) + 대화 복원 fetch(`fetchConversationMessages`): `frontend/src/service/admin-assistant.ts`
- 사이드바 메뉴: `frontend/src/app/(admin)/admin/components/AdminSidebar.tsx`

**대화 영속화**: ✅ **Phase 2.5 완료** — `assistant_conversations` / `assistant_messages`(TypeORM). conversationId(=대화 row id)로 멀티턴 복원, adminUserId 소유권 검증.

<br>

---

## 8. 트러블슈팅 / 엣지케이스 (구현 중 누적 — ex- 트랙 핵심)

### 8-1. ⚠ Gemini 3.x function calling — `thought_signature` 누락 400 (Phase 3 핵심)
- **증상**: 매출 질문 시 tool 1라운드(모델이 `get_sales_summary` 호출)는 되는데, 도구 결과를 되돌린 **2라운드에서 즉시 400** `INVALID_ARGUMENT: "Function call is missing a thought_signature in functionCall parts"`.
- **root cause**: Gemini 3.x(thinking 계열)는 `functionCall` part에 **`thoughtSignature`**(불투명 토큰)를 붙여 보낸다. 다음 턴에 그 tool-call 턴을 대화에 다시 넣을 때 **이 서명을 보존**해야 한다. 초기 구현은 `{ functionCall: { name, args } }`로 **재구성**해 서명을 떨궜다.
- **해결**: 재구성하지 말고 **모델이 보낸 원본 `parts`를 그대로** 누적해(`chunk.candidates[0].content.parts`) 대화에 push. → 2라운드 정상, 실 DB 값(7,619,000원/137건)으로 응답 검증.
- **교훈**: `response.functionCalls` getter는 편의용(서명 미포함)이라 **대화 재전송엔 쓰면 안 됨**. 원본 parts를 보존하라. 프로바이더 전환 시 ClaudeClient는 `tool_use` 블록 id로 다른 방식 — 인터페이스 격리가 이래서 유효.

### 8-2. ⚠ 스트리밍 모델 선택 — thinking 모델은 "또르륵"이 약하다
- `gemini-3.5-flash`(thinking)는 먼저 오래 추론(로딩) 후 답을 **1~2개 큰 덩어리**로 방출 → 스트리밍 체감 약함. 무료 RPD도 극소(~20/day).
- → **`gemini-3.1-flash-lite`(비-thinking)** 로 교체하니 토큰이 잘게 흐르고 RPD도 넉넉. **코드 변경 없이 `GEMINI_MODEL` env 한 줄**로 전환(프로바이더 추상화의 이점 실증). 단 `.env` 변경은 **백엔드 재시작** 필요(부팅 시 1회 로딩).

### 8-3. ⚠ SSE-over-POST + NestJS
- 네이티브 `EventSource`는 POST·`Authorization` 헤더 불가 → 프론트는 **fetch + ReadableStream**으로 받고 `data:` 프레임 직접 파싱. 백엔드는 `@Res()`로 `text/event-stream` 수동 write(가드는 핸들러 이전 실행이라 admin 인증 유지). `X-Accel-Buffering: no`로 프록시 버퍼링 방지.
- (테스트 메모) Git Bash(Windows)에서 인라인 한글이 깨진 UTF-8로 전송되어 스트리밍이 실패한 적 — `--data-binary @utf8파일`로 해결. 실제 브라우저는 정상 UTF-8이라 무관.

### 8-4. ⚠ 도구 결과는 직렬화 인터셉터를 거치지 않는다 — @Exclude 무력화 (Phase 4 핵심)
- **함정**: `@Exclude()`/`@Expose()`(class-transformer)는 **HTTP 응답이 `ClassSerializerInterceptor`/`@Serialize`를 탈 때만** 작동한다. 도구 디스패처는 기존 서비스의 **반환값(엔티티)을 그대로 JSON 직렬화해 LLM 프롬프트에 넣으므로** 이 인터셉터를 안 탄다 → `@Exclude`가 무력화되어 민감필드가 LLM(무료티어면 학습)으로 샌다.
- **실제 위험원**: ① `ProductService.findAllAdmin`의 `seller` 관계에 `@Exclude` 은행정보(bankName/bankAccountNumber/bankAccountHolder). ② `AuditService.getAuditLogs`의 이메일·IP·userAgent·metadata.
- **해결**: 디스패처에서 직접 가공한다. ① 상품은 `projectProduct`로 **안전 필드만 화이트리스트 projection**(seller raw 제외). ② 감사로그는 `maskAuditLogs`로 **비식별화**(email `t***@***`, IP 끝옥텟 마스킹, userAgent/metadata 드롭).
- **교훈**: "엔티티에 @Exclude 걸었으니 안전"은 HTTP 경로 한정. 새 소비 경로(LLM 도구·이벤트·큐 등)를 열 땐 직렬화 정책이 그 경로에도 적용되는지 반드시 재확인.

### 8-5. ⚠ findAllAdmin 은 keyword/단건 id 필터가 없다 (get_product_info 설계)
- 후보 메서드 `ProductService.findOne(id)`는 **구매자용**이라 비승인/숨김/단종 상품에 `NotFoundException` → 관리자 정보 조회엔 부적합. `findAllAdmin(query)`는 모든 상태를 보지만 **필터가 categoryId/status/approvalStatus/sellerId 뿐**(keyword·id 미지원).
- 처음엔 도구에 `keyword`·`productId`를 넣었으나, findAllAdmin이 이를 무시 → 모델이 "검색했다"고 오해할 수 있음. **도구 파라미터를 서비스가 실제 지원하는 범위(status/approvalStatus/sellerId)로 정직하게 좁혔다.** (추측 매핑 금지 원칙의 사례.)

### 8-7. ⚠ Phase 4 e2e 후 엣지케이스 검증 (2026-06-15, "지난주 로그인 실패 분석" 답변 점검)
첫 e2e는 성공했으나(마스킹 IP `10.0.*.*` + 요약) 답변을 뜯어보니 4건의 엣지케이스 발견 → 수정.
- **(A) metadata 통째 드롭 → 모델이 원인 추측**: 초기 `maskAuditLogs`가 metadata를 통째로 버렸다. 그런데 FAILED_LOGIN은 `errorMessage`가 없고 실패 원인이 **`metadata.reason`**(`invalid_password`/`user_not_found`)에 있다. 결과적으로 모델은 데이터 없이 "모두 wrong password"라고 **일반화/추측**했다(일부는 user_not_found일 수 있음). metadata 전수 조사 결과 PII는 `email` 키뿐 → **키 단위 비식별화**(`sanitizeMetadata`: email/ip 키만 마스킹, reason·count·orderNumbers 등 비-PII 보존)로 교체. 교훈: 마스킹은 "PII만 정확히" 제거해야지 통째 드롭하면 도구의 분석 가치 자체가 사라지고 환각을 유발한다.
- **(B) 감사 날짜 범위 KST/종료일 누락**: `AuditService.getAuditLogs`는 `Between(new Date(start), new Date(end))`. 모델이 `endDate=2026-06-14`(날짜만) 주면 `new Date()`가 **UTC 자정 1순간**만 잡아 그날 데이터가 거의 누락 + KST와 9h 어긋남. 디스패처에 `normalizeAuditDate`(날짜만이면 시작 `T00:00:00+09:00`/끝 `T23:59:59.999+09:00`)를 넣어 KST 풀데이로 정규화. (대시보드 도구는 `toKstRange`로 이미 처리 — 감사 경로만 raw였음.)
- **(C) history 윈도가 assistant로 시작**: 대화 21턴↑이면 `MAX_HISTORY`(20) 트림 윈도가 assistant 턴으로 시작할 수 있다(대화는 user로 시작해야 자연스러움). `loadHistory`에서 선두 assistant 턴 제거.
- **(D) 첫 페이지만 조회**: `query_audit_logs`는 page=1·take≤100만 본다. 총계는 `meta.total`로 정확하나, total>take면 "모두/전부" 단정은 표본 한정 → 도구 description에 "총계는 meta.total, data는 표본"임을 명시.
- (검증 대기) errorMessage는 현재 고정 문자열('토큰 재사용 감지' 등)뿐이라 PII 없음. userNickName은 마스킹 정책 결정상 유지(관리자 UI 노출값).

### 8-8. ⚠ UI 대화 복원(localStorage) 엣지케이스 (2026-06-15)
새로고침 복원을 붙인 뒤 발견·수정한 3건.
- **복원 레이스(데이터 손실)**: 마운트 복원 fetch가 끝나기 전 사용자가 메시지를 보내면, 뒤늦게 도착한 복원 결과의 `setMessages`가 **진행 중 대화를 덮어쓴다.** → `interactedRef`(전송/새 대화 시 true)로 가드해 늦게 온 복원은 폐기. (conversationId는 useEffect에서 동기 세팅하므로 백엔드는 같은 대화에 정상 append — UI에 과거 턴이 잠깐 안 보일 뿐, 다음 새로고침에 복원.)
- **일시적 401이 유효한 id를 삭제**: 복원 fetch를 "빈 결과=폐기"로 단순화했더니, 만료 토큰 마운트 시 401을 빈 결과로 오인해 **유효한 conversationId를 localStorage에서 지워** 복원이 영구 불가가 됐다. → `fetchConversationMessages` 반환을 **`[]`(200 확정 빈 결과=폐기 가능) vs `null`(네트워크/401 일시 실패=id 유지)** 로 구분.
- **localStorage 접근 미가드**: 시크릿모드/스토리지 차단 시 `getItem/setItem`이 throw → 스트림 루프 catch로 들어가 엉뚱한 에러 표시. → `storage` 안전 래퍼(try/catch, 실패 무시)로 전부 감쌈.
- 정상 동작 확인(수정 불필요): **계정 전환**(B가 A의 id로 마운트 → 백엔드 소유권 체크가 200 빈 결과 → 폐기 후 새 대화, 누수 없음), **잘못된 id**(ParseIntPipe 400 → null → 유지·자가치유), **XSS**(React 텍스트 이스케이프, dangerouslySetInnerHTML 미사용).
- (미수정·낮은 우선순위) `getConversationMessages`는 대화 전체 메시지를 무제한 반환 — 초장기 대화 시 페이로드 큼. 현재 대화 짧아 보류(필요 시 최근 N 캡).

### 8-9. (예약) 남은 항목
- ⚠ 프롬프트 인젝션 방어 강화.
- ⚠ 토큰/비용 폭증과 캐싱 적중률(Phase 6).
- ⚠ 대화 history 길이 상한(현재 최근 20개 메시지) — 긴 대화에서 맥락 손실 vs 토큰 트레이드오프(Phase 6 compaction).

<br>

---

## 9. 기존 문서 동기화 (MVP 완료 후 — 2026-06-15 반영)

- [x] [PROJECT_DOSSIER.md](../etc/PROJECT_DOSSIER.md) **§3-17 AI 활용** — ❌→⭕, 별점 ★★☆☆☆→★★★★☆, 실제 구현 근거 기재. 자기소개 후킹 카드에 3-17 추가.
- [x] [CLAUDE.md](../../CLAUDE.md) **§5 구현 상태** — "관리자 AI 어시스턴트(MVP 완료)" 추가. **§3 모듈/인프라**에 `intrastructure/ai`·`admin/assistant` 추가.
- [x] [roadmap/README.md](./README.md) — "계획 외 삽입 — AI 통합" 섹션에 본 문서 등재.
- [ ] (다음 컨텍스트) `docs/etc/data-flow/`에 "AI 어시스턴트" 데이터 흐름 문서 작성([DOC_GUIDE](../etc/data-flow/DOC_GUIDE.md) 준수). — Phase 2.5/4 이후로 미룸.
