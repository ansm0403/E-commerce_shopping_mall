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

### Phase 0 — 준비
- [ ] **Gemini API 키 발급**(Google AI Studio) → `GEMINI_API_KEY` env (백엔드 `.env`, 운영 시 EC2 시크릿).
- [ ] **Gemini SDK 설치** — 공식 패키지명·버전은 문서 확인 후 (백엔드 워크스페이스).
- [ ] `intrastructure/ai/` 모듈 골격 + DI 등록. 키 없으면 no-op 가드.
- [ ] **`LlmClient` 인터페이스 정의 + `GeminiClient` 구현** (프로바이더 추상화 — §3-4). 어시스턴트는 인터페이스에만 의존.
- [ ] (추후) `ClaudeClient` 구현체를 같은 인터페이스로 추가 → env로 전환.

### Phase 1 — 단순 호출 (감 잡기)
- [ ] `messages.create` 1회 호출하는 임시 엔드포인트/스크립트. system + user 1턴.
- [ ] 응답 텍스트 확인. **"외부 API 한 번 호출"임을 체감.**
- 🎯 시연: 고정 질문 → AI 응답.

### Phase 2 — 멀티턴 + 스트리밍 + 프론트 채팅 UI
- [ ] 대화 배열 누적 + DB 저장(또는 메모리 임시).
- [ ] `messages.stream()` 으로 스트리밍, NestJS→프론트 SSE/chunked.
- [ ] `(admin)/admin/assistant` 채팅 UI (입력창 + 스트리밍 렌더).
- 🎯 시연: 멀티턴 대화가 글자 흐르듯 나옴.

### Phase 3 — Tool Use 1개 ★ ("사내 데이터 연동" 증명)
- [ ] `get_sales_summary` tool(중립 정의 → Gemini function calling 포맷으로 변환) + 기존 통계 서비스에 디스패치 연결.
- [ ] 호출→실행→재전달 루프 처리(Gemini function calling 흐름. Claude 전환 시 tool runner로 단순화 가능).
- [ ] "지난달 매출?" → AI가 실제 DB 매출을 가져와 자연어로 답.
- 🎯 시연: **이 순간 "사내 데이터 연동" 성립. DOSSIER 3-17 ❌→⭕의 분기점.**

### Phase 4 — 도구 확장
- [ ] `get_order_stats`, `query_audit_logs`, `get_product_info` 추가.
- [ ] 여러 도구를 AI가 상황에 맞게 선택/연쇄 호출하는지 확인.
- 🎯 시연: "지난주 의심스러운 로그인 분석" → 감사로그 도구 호출 → 요약.

### Phase 5 — RAG (비정형 데이터)
- [ ] `summarize_reviews`/`summarize_inquiries`: 단순 RAG(관련 텍스트 프롬프트 첨부)부터.
- [ ] 데이터 많아지면 임베딩 + 벡터검색(pgvector 등) 검토.
- 🎯 시연: "최근 부정 리뷰 핵심만 요약".

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

**MVP (Phase 0~3):**
- [ ] 관리자가 `(admin)/admin/assistant`에서 멀티턴 대화 (스트리밍).
- [ ] 최소 1개 tool(`get_sales_summary`)이 **실제 DB 데이터**를 가져와 답에 반영됨.
- [ ] 권한: 비-admin 접근 차단. 키 없으면 기능 no-op.
- [ ] 대화 기록 영속화(또는 세션 유지).

**전체 (Phase 4~8): 각 Phase의 🎯 시연 항목 충족 + §7 파일 매핑/§8 트러블슈팅 작성.**

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
- 컨트롤러(`POST /v1/admin/assistant/chat`, `/stream` SSE): `backend/src/admin/assistant/assistant.controller.ts`
- 서비스(시스템 프롬프트·멀티턴 인메모리·도구 디스패처): `backend/src/admin/assistant/assistant.service.ts`
- 도구 정의(LlmToolDef): `backend/src/admin/assistant/assistant-tools.ts` (`get_sales_summary`)
- DTO: `backend/src/admin/assistant/dto/chat-request.dto.ts`
- 모듈: `backend/src/admin/assistant/assistant.module.ts` (AuthModule + AdminModule)
- 매출 도구 대상 메서드: `backend/src/admin/dashboard/dashboard.service.ts` → `getSalesSummary(startDate, endDate)`
  - `AdminModule`이 `DashboardService`를 `exports` 하여 어시스턴트가 주입받음.

**프론트**
- 채팅 UI: `frontend/src/app/(admin)/admin/assistant/page.tsx` + `components/AssistantChat.tsx`
- SSE 파서(fetch + ReadableStream): `frontend/src/service/admin-assistant.ts`
- 사이드바 메뉴: `frontend/src/app/(admin)/admin/components/AdminSidebar.tsx`

**대화 영속화**: 현재 서버 인메모리(Map). DB 엔티티(TypeORM)는 **Phase 2.5 예정**(미구현).

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

### 8-4. (예약) 남은 항목
- ⚠ tool 결과 직렬화 시 민감필드 노출(Phase 4 audit/PII 도구) — §4-2 데이터 등급 게이트.
- ⚠ 프롬프트 인젝션 방어 강화.
- ⚠ 토큰/비용 폭증과 캐싱 적중률(Phase 6).

<br>

---

## 9. 기존 문서 동기화 (MVP 완료 후 — 2026-06-15 반영)

- [x] [PROJECT_DOSSIER.md](../etc/PROJECT_DOSSIER.md) **§3-17 AI 활용** — ❌→⭕, 별점 ★★☆☆☆→★★★★☆, 실제 구현 근거 기재. 자기소개 후킹 카드에 3-17 추가.
- [x] [CLAUDE.md](../../CLAUDE.md) **§5 구현 상태** — "관리자 AI 어시스턴트(MVP 완료)" 추가. **§3 모듈/인프라**에 `intrastructure/ai`·`admin/assistant` 추가.
- [x] [roadmap/README.md](./README.md) — "계획 외 삽입 — AI 통합" 섹션에 본 문서 등재.
- [ ] (다음 컨텍스트) `docs/etc/data-flow/`에 "AI 어시스턴트" 데이터 흐름 문서 작성([DOC_GUIDE](../etc/data-flow/DOC_GUIDE.md) 준수). — Phase 2.5/4 이후로 미룸.
