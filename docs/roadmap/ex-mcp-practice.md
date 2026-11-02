# MCP 연습 — 어시스턴트 도구를 MCP 로 꺼내고, 바꾼 결과를 eval 로 검증한다

작성일: 2026-11-01. **상태: 1단계 구현 중(`feat/mcp-practice`) — 0단계·서버·curl 확인 완료, Claude Code 연결 확인 대기. 1차 검토(§10)·구현 중 실측(§10 2차) 반영.**

## 0. 목표

관리자 AI 어시스턴트의 도구 6개(`get_sales_summary` · `get_order_stats` · `query_audit_logs` · `get_product_info` · `summarize_reviews` · `summarize_inquiries`)를 세 단계로 다룬다.

| 단계 | 한 줄 | 끝나면 보여줄 수 있는 것 |
|---|---|---|
| 1 | 도구를 **MCP 서버**로 꺼낸다 | Claude Code 에서 "이번 주 매출 알려줘" → 우리 서버의 도구가 호출된다 (두뇌 = Claude) |
| 2 | 어시스턴트가 내부 함수 대신 **MCP 클라이언트**로 도구를 받아 쓴다 | 같은 채팅 화면이 MCP 를 거쳐 동작한다 (두뇌 = Gemini) |
| 3 | 기존 eval 루프로 **바꾸기 전/후를 측정**한다 | "MCP 로 바꿔도 도구 선택·답변 품질이 유지된다(또는 어디서 깨진다)"를 숫자로 |

1·2단계에서 **같은 도구를 서로 다른 두 LLM 이 쓴다** — MCP 의 목적(M×N → M+N)을 이 프로젝트 안에서 직접 보여주는 장면이다.

## 1. 이미 있는 재료 → MCP 에서의 역할

| 이미 있는 것 | 위치 | MCP 에서 맡는 역할 |
|---|---|---|
| 중립 도구 정의 `LlmToolDef`(name·description·JSON Schema) | `admin/assistant/assistant-tools.ts`, `assistant-tool-schemas.ts toolParameters()` | `tools/list` 응답의 `inputSchema` **그대로** |
| 도구 디스패처 `executeTool`(인자 검증·마스킹·실패 구조화) | `assistant.service.ts executeTool` | `tools/call` 처리기 **그대로** — 검증·마스킹을 새로 짜지 않는다 |
| 실행 주체 `ToolExecutionContext`(관리자·평가 구분) | `search/tool-execution-context.ts` | 인증 결과를 도구 실행에 묶는 자리 |
| 프로바이더 비종속 `LlmClient` | `intrastructure/ai/llm-client.interface.ts` | 2단계에서 Gemini 코드가 **무변경**인 근거 (`executeTool` 콜백만 바뀜) |
| 관리자 가드 `JwtAuthGuard + RolesGuard + @Roles(ADMIN)` + `@User('sub')`·`@User('roles')` | `assistant.controller.ts` 와 같은 조합(`DemoAccountGuard` 없음 — 데모 관리자도 채팅을 쓴다, MCP 도 같게) | MCP 엔드포인트 인증 — 새 인증 경로를 만들지 않는다 |
| eval 러너 + 골든셋 20건 + judge | `backend/eval/run-eval.ts` · `golden-set.json` · `run-judge.ts` | 3단계 측정 도구 그대로 |
| 라우트 경계 점검 | `scripts/security/list-api-surface.mjs` · `ex-security-api-boundary.md` §9 | 새 라우트 1개의 근거·검증 |

**새로 만드는 것**은 MCP SDK 연결부(서버 팩토리·컨트롤러·클라이언트 쪽 provider)와 동등성 비교 스크립트 하나뿐이다.

## 2. 설계도

```
[1단계]  Claude Code ──HTTP(MCP)──▶ POST /v1/admin/mcp ─┐
         (MCP 클라이언트)            JwtAuthGuard·Roles   │
                                    McpController        │
                                                         ▼
                                     createShopMcpServer({ listTools, callTool })   ← 1·2단계 공용 팩토리
                                         tools/list → assistantService.availableTools()
                                         tools/call → assistantService.executeTool(call, context)
                                                         ▲
[2단계]  어시스턴트(Gemini 루프)                           │
         generateWithTools({ tools, executeTool })       │
               │                                         │
               └─ openToolSession(context)               │
                    ├─ inprocess : 지금 그대로 ───────────┘(직접 호출)
                    └─ mcp       : MCP Client ──InMemoryTransport──┘

[3단계]  run-eval.ts × ASSISTANT_TOOL_TRANSPORT = inprocess | mcp | mcp-text  (같은 날·같은 모델)
         + check-mcp-equivalence.ts (LLM 없이: 도구 목록·결과가 바이트 단위로 같은가)
```

## 3. 결정

| # | 결정 | 이유 | 버린 대안 |
|---|---|---|---|
| D1 | MCP 서버를 **백엔드 안**(Nest 컨트롤러)에 둔다 | `executeTool`·서비스·DB 연결을 그대로 재사용. 도구 코드가 한 벌이라 1·2·3단계가 같은 것을 잰다 | 별도 stdio 프로세스: Nest 앱 컨텍스트를 띄우면 스케줄러(`@Cron`)·워커가 같이 돌고, Nest 로거가 **stdout 에 찍혀 stdio 프로토콜을 오염**시킨다 |
| D2 | SDK 의 **저수준 `Server`** + `tools/list`·`tools/call` 처리기를 직접 등록, `inputSchema` 는 `toolParameters()` 의 JSON Schema 그대로 | SDK 1.32.2 실물 확인: 고수준 `McpServer.registerTool` 은 ① zod 를 **자기 `toJSONSchema`(target·io 만 지정)로 다시 변환**해 우리 `override`(검색어 `maxLength` 를 코드포인트 기준으로 고친 것)가 빠지고, ② `normalizeObjectSchema` 를 거쳐 union 인 `summarize_reviews`·`summarize_inquiries` 가 그대로 안 들어가며, ③ 인자를 **자기가 먼저 검증**해 실패 시 프로토콜 오류(`InvalidParams`)를 던진다 — 우리 구조화 실패(`invalid_arguments`·code)를 모델이 못 받는다. 셋 다 3단계 비교를 오염시킨다. 단 `Server` 는 `@deprecated`("고급 용도에만") 표시 — 이 이유를 코드 주석에 남긴다 | `McpServer` + zod (예제는 대부분 이 방식 — 3단계를 안 한다면 이쪽이 쉽다) |
| D3 | 결과는 **`structuredContent`(객체) + `content`(같은 JSON 텍스트)** 둘 다. `isError` 는 **쓰지 않는다** | Gemini 클라이언트는 결과를 객체로 `functionResponse.response` 에 넣는다(`gemini.client.ts` 312~315). 텍스트만 넘기면 `{ result: "<JSON 문자열>" }` 로 감싸져 모델 입력이 달라진다. 텍스트는 Claude Code 등 다른 클라이언트용. `isError` 를 안 쓰는 이유: 결과의 `status` 가 도구 실패(`forbidden`·`invalid_arguments`)와 의미 검색 상태(`ok`·`no_data`·`indexing`·`unavailable`)를 함께 쓰고 있어 기계적으로 가르면 정상 결과가 오류로 분류된다. 결과가 이미 자기 상태를 설명한다 | 텍스트만 — 3단계의 `mcp-text` 비교군으로만 남긴다 |
| D4 | Streamable HTTP **stateless**(세션 없음) — 요청마다 서버·전송 객체를 만들고 응답 뒤 닫는다 | 세션 저장소가 필요 없고, 요청마다 그 요청의 인증 결과로 context 를 묶을 수 있다. 도구가 전부 조회라 세션 상태가 없다 | stateful 세션: 서버 알림·재개가 필요할 때의 방식. 지금은 쓸 곳이 없다 |
| D5 | 인증은 **기존 관리자 가드 그대로**. Claude Code 는 `headersHelper`(로그인 스크립트)가 만든 access 토큰을 `Authorization` 헤더로 보낸다 | 새 인증 경로(API 키 등)는 보안 경계를 하나 더 여는 일이다. OAuth 는 원격 MCP 의 정석이지만 연습 범위를 넘는다(§7). 공식 문서 확인: `headersHelper` 는 연결·재연결 때 실행되고, 도구 호출이 **401/403 이면 헬퍼를 다시 돌려 한 번 재시도** → access 15분 만료를 손으로 처리할 필요가 없다 | 정적 API 키 → 고정 관리자 매핑 |
| D6 | 플래그 `MCP_SERVER_ENABLED`(기본 false) — 꺼지면 404. 판정은 **요청 시점 가드**(`ConfigService`)로, 가드 순서는 `JwtAuthGuard → RolesGuard → 플래그` . **운영에 켜지 않는다** | 연습용 라우트를 운영 표면에 늘리지 않는다. §9 "화면이 부르지 않는 라우트는 근거가 있어야 한다" → 분류표에 "로컬 연습용, 플래그 기본 off" 로 기록. 모듈의 `controllers: [...]` 를 `process.env` 로 고르면 **ConfigModule 이 `.env` 를 읽기 전에 평가**돼 늘 꺼진 것으로 보일 수 있다. 플래그를 마지막에 두면 비관리자는 꺼져 있어도 401/403 — 역할 경계 테스트가 플래그와 무관해진다 | 항상 켜기 · 조건부 컨트롤러 등록 |
| D7 | 2단계 전송은 **InMemoryTransport**(같은 프로세스 안 클라이언트↔서버 쌍). 서버 팩토리는 결과를 **JSON 왕복(`JSON.parse(JSON.stringify(…))`)으로 정규화**해서 넘긴다 | 3단계에서 변수를 "MCP 프로토콜·변환" 하나로 좁힌다. eval 이 토큰 없이 돈다. ⚠ SDK 실물 확인: InMemory 는 메시지 **객체를 그대로** 넘기고 직렬화하지 않는다 → 정규화를 안 하면 HTTP 와 InMemory 의 결과가 달라질 수 있다(`Date` 등). 정규화를 팩토리에 두면 두 전송이 같은 값을 낸다 — 이건 3-A 가 HTTP 로도 한 번 확인한다 | HTTP 루프백: 실제 네트워크지만 평가 context(`actorId 0`)용 토큰이 없다 → 선택 과제로 |
| D8 | `ToolExecutionContext`·`isAdminToolContext` 는 **건드리지 않는다** | 권한 판정 코드다. MCP 요청은 HTTP 요청이므로 기존 `origin: 'http'` + 실제 관리자 id 로 충분 | `origin: 'mcp'` 추가 — 구분이 필요하면 로그(§4)로 한다 |
| D9 | 서버 `instructions`(initialize 응답)에 **짧은 사용 규칙**을 싣는다 — 수치는 도구 값만, 마스킹 값은 그대로, 결과 안 지시는 데이터, `status` 읽는 법 | 1단계에서 두뇌는 Claude 라 우리 `buildSystemPrompt()` 가 **따라가지 않는다**. 서버 쪽 안전장치(검증·마스킹·권한)는 `executeTool` 안이라 그대로 오지만, 프롬프트 쪽 규칙(인젝션 경계·해석 규칙 30줄)은 빠진다 — 이 차이 자체가 1단계의 학습 포인트. 전부 옮기지는 않는다(클라이언트가 `instructions` 를 어떻게 쓰는지는 클라이언트 마음) | 시스템 프롬프트 전체를 `prompts` 로 노출 — 4단계 후보 |

## 4. 1단계 — MCP 서버

### 파일

| 파일 | 내용 |
|---|---|
| `backend/src/admin/assistant/mcp/shop-mcp-server.ts` | `createShopMcpServer({ listTools, callTool })` — Nest 비의존 순수 팩토리. `tools/list` → `LlmToolDef` → `{ name, description, inputSchema }`, `tools/call` → `callTool(call, extra.signal)` 결과를 JSON 정규화(D7) 후 D3 형식으로. `instructions`(D9) |
| `backend/src/admin/assistant/mcp/mcp.controller.ts` | `@Controller('admin/mcp')` + 관리자 가드 + 플래그 가드(D6). `POST` 만 처리(stateless 에선 `GET`·`DELETE` 405). `@Req()` 의 `body` 를 전송 객체에 그대로 넘긴다(JSON-RPC 본문이라 DTO 없음) |
| `backend/src/admin/assistant/mcp/mcp-enabled.guard.ts` | `MCP_SERVER_ENABLED !== 'true'` 면 `NotFoundException` |
| `assistant.service.ts` | `assistantTools(…플래그)` 계산을 `availableTools()` 공개 메서드로 추출 — `chatWithTrace`·`streamChat`·MCP 가 **같은 목록**을 쓰게(지금은 515·598 행에 같은 식이 복붙돼 있다) |
| `assistant.module.ts` | 컨트롤러·가드 등록 |
| `scripts/mcp/admin-token-header.mjs` | 로컬 관리자로 로그인해 `{"Authorization":"Bearer …"}` 를 stdout 에 출력 — Claude Code `headersHelper` 용(10초 제한, 문자열 키·값 JSON 객체). 계정은 환경변수(`SHOP_MCP_EMAIL`/`SHOP_MCP_PASSWORD` — local 스코프 헬퍼는 사용자 환경변수를 받는다) |

컨트롤러 골격(개념):

```ts
@Post()
@UseGuards(McpEnabledGuard) // 클래스의 JwtAuthGuard·RolesGuard 뒤에 돈다
async handle(@Req() req: Request, @Res() res: Response, @User('sub') adminUserId: number, @User('roles') roles: Role[] = []) {
  const server = createShopMcpServer({
    listTools: () => this.assistant.availableTools(),
    // Claude Code 가 호출을 취소하면 SDK 가 extra.signal 을 끊는다 → 남은 DB 조회를 멈춘다
    callTool: (call, signal) => this.assistant.executeTool(call, adminToolContext(adminUserId, roles, randomUUID(), signal)),
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
```

### 순서

0. (준비운동) `.mcp.json` 의 `nx-mcp` 가 이 세션에서 `CONNECTION_CLOSED`. 원인부터 본다(`claude mcp list`·`/mcp`). Windows 에서 `npx` 를 stdio 명령으로 직접 띄우면 끊기는 일이 흔해 `"command": "cmd", "args": ["/c", "npx", "nx", "mcp"]` 가 1순위 후보지만 **추정**이다(공식 MCP 문서에서는 이 안내를 찾지 못했다). 설정·연결·디버깅을 남의 서버로 먼저 겪는다. → **결과(§9): 추정은 틀렸다** — 원인은 nx 내부 spawn 이라 `cmd /c` 로 안 고쳐진다.
1. SDK 설치(`@modelcontextprotocol/sdk` — 2026-11-01 npm 최신 1.32.2, zod 피어 `^3.25 || ^4.0` → 루트 zod 4.1 과 맞음. `exports` 에 `require` → `dist/cjs/*` 가 있다) 후 **import 스모크**: 백엔드는 `generatePackageJson` 으로 의존성을 외부화하므로 `…/sdk/server/index.js`·`…/server/streamableHttp.js`·`…/inMemory.js` 서브패스가 런타임 `require` 로 풀리는지 `yarn nx serve backend` 로 먼저 확인.
2. `shop-mcp-server.ts` + 단위 테스트(InMemory 쌍으로 `listTools` 6개 · `inputSchema` 가 `availableTools()` 와 깊은 동등 · `callTool` 성공/실패 결과 형식).
3. 컨트롤러 + 플래그. `curl` 로 `initialize` → `tools/list` JSON-RPC 를 손으로 보내 본다(프로토콜을 눈으로 보는 단계). ⚠ POST 에 **`Accept: application/json, text/event-stream`** 이 없으면 406(SDK 실물). 한국어 인자는 UTF-8 파일 + `--data-binary`.
4. Claude Code 등록 — **local 스코프**(`~/.claude.json` 의 이 프로젝트 항목, 커밋되는 `.mcp.json` 을 더럽히지 않는다):
   `claude mcp add --transport http shop-local http://localhost:4000/v1/admin/mcp --scope local` 후 그 항목에 `"headersHelper": "node C:/…/scripts/mcp/admin-token-header.mjs"`(**절대 경로** — 헬퍼의 작업 폴더는 설정 위치에 따라 다르다).
   한 번에: `claude mcp add-json shop-local '{"type":"http","url":"…","headersHelper":"node …"}' --scope local`. 공식 문서 확인(2026-11-01): local 스코프 헬퍼는 사용자 환경변수를 **지우지 않고** 받는다(project `.mcp.json` 이면 `PASSWORD`·`TOKEN` 류 이름이 지워진다) · 프로젝트 폴더 신뢰(trust) 승인 뒤에만 실행된다.
5. Claude Code 에서 질문 3개: 매출(기간) · 주문 상태 분포 · 승인 대기 상품. 어떤 도구를 어떤 인자로 불렀는지 기록. 같은 질문을 관리자 채팅 화면에도 던져 **두뇌만 다를 때** 답이 어떻게 다른지 비교(D9).

### 완료 기준

- `/mcp` 에 `shop-local` connected, 도구 6개.
- 질문 3개가 각각 맞는 도구로 답한다. 토큰 없음 401 · 비관리자 403 · 관리자 + 플래그 off 404.
- 15분 넘게 켜 둔 뒤 다시 질문해도 동작한다(401 → 헬퍼 재실행 → 재시도).
- `list-api-surface.mjs` 결과에 새 라우트 ~~1개~~ **3개**(`POST`·`GET`·`DELETE /admin/mcp` — §10 2차) + §9 분류표 한 줄.

### 함정 (미리 아는 것)

- 전역 `ValidationPipe(forbidNonWhitelisted)` — `@Body()` 에 DTO 를 붙이면 JSON-RPC 키(`jsonrpc`·`method`…)가 400. `@Req().body` 로 받는다. `check-dto-decorators.mjs` 가 이 라우트를 어떻게 보는지 확인.
- **라우트 수가 포트폴리오 문서의 숫자를 바꾼다** — 보안 문서·이력서 초안이 "59 라우트·역할 경계 36/59" 를 인용한다. 이 브랜치를 main 에 머지하면 그 숫자들이 낡는다 → 머지 여부는 1단계 끝에 따로 정한다(머지한다면 `list-api-surface.mjs` 재실행 + 인용처 갱신을 같은 PR 에).
- 헬퍼가 401 재시도 때마다 로그인한다 — 로그인 레이트리밋(Redis)에 걸리면 헬퍼가 실패한다. 연습 중에는 문제없는 빈도지만, 막히면 `resetLoginRateLimits` 패턴(backend-e2e 하네스) 참고.
- Claude Code 는 도구 결과를 **Anthropic 으로 보낸다**(그게 두뇌니까). 로컬 개발 DB(시드·e2e 계정)에만 붙이고, 마스킹은 서버 쪽 `executeTool` 이 이미 한다.
- `yarn nx serve backend` 는 `backend/.env` 를 읽는다 — `AI_SEARCH_*_ENABLED` 가 true 면 도구 설명·스키마가 의미 검색 버전으로 바뀐다(3단계에서 모든 비교군이 같은 플래그여야 한다).
- 옛 백엔드가 4000 을 쥐고 있으면 새 라우트가 404 로 보인다 — PID 시작 시각 확인.

## 5. 2단계 — 어시스턴트를 MCP 클라이언트로

### 설계

`AssistantService` 안에 도구 세션을 여는 자리 하나를 만든다(별도 provider 클래스로 빼면 provider → `AssistantService.executeTool` → provider 순환 주입이 생긴다).

```ts
interface ToolSession {
  tools: LlmToolDef[];
  execute(call: LlmToolCall): Promise<unknown>;
  close(): Promise<void>;
}

private async openToolSession(context: ToolExecutionContext): Promise<ToolSession>
// ASSISTANT_TOOL_TRANSPORT=inprocess(기본) → { tools: availableTools(), execute: c => executeTool(c, context) }
// =mcp       → InMemoryTransport 쌍: 서버 = createShopMcpServer(위 inprocess 를 context 에 묶어서)
//              클라이언트.listTools() → LlmToolDef[] (inputSchema → parameters)
//              execute = client.callTool({ name, arguments }, undefined, { signal: context.signal }) → structuredContent
//              (SDK 1.32.2: 두 번째 인자는 결과 스키마, 옵션은 세 번째)
// =mcp-text  → 위와 같되 content[0].text 를 그대로(문자열) 반환 — 3단계 비교군 전용
```

`chatWithTrace`·`streamChat` 은 `generateWithTools({ tools: session.tools, executeTool: session.execute })` 로 바뀌고 `finally` 에서 `session.close()`. **Gemini 클라이언트·프런트·SSE 는 무변경.**

### 완료 기준

- `ASSISTANT_TOOL_TRANSPORT=mcp` 로 백엔드를 띄우고 관리자 채팅 화면에서 질문 → 정상 답변, 도구 진행 표시 그대로.
- 중지 버튼(`stream/cancel`)이 MCP 경유에서도 남은 도구를 실행하지 않는다(`signal` 전달 확인).
- 기존 `assistant.service.spec.ts` 통과 + MCP 경로 단위 테스트.

## 6. 3단계 — 바꾼 결과를 측정한다

### A. 결정적 동등성 (LLM 호출 없음, 비용 0)

`backend/eval/mcp/check-mcp-equivalence.ts` — `run-eval.ts` 처럼 앱 컨텍스트를 띄워 두 경로를 직접 비교한다.

| 항목 | 기대 |
|---|---|
| 도구 목록: MCP `listTools()` → `LlmToolDef[]` vs `availableTools()` | 6/6 name·description·parameters 깊은 동등 |
| 결과: 고정 인자 묶음(`eval/mcp/fixtures.json` — 도구별 정상 2 + 잘못된 인자 1 + 없는 도구 1)으로 `execute` | inprocess 결과를 `JSON.parse(JSON.stringify(…))` 한 값과 MCP `structuredContent` 가 깊은 동등 · 실패 code 동일 |
| 같은 묶음을 **HTTP 로도**(떠 있는 4000 + 로컬 관리자 토큰, `StreamableHTTPClientTransport`) | InMemory 결과와 깊은 동등 — InMemory 가 직렬화를 건너뛰어도(D7) 결론이 HTTP 에 그대로 적용된다는 근거 |
| 지연: 같은 호출 N=50 의 p50/p95 | inprocess · InMemory · HTTP 세 경로 수치 기록 (판정 아님) |

⚠ 의미 검색 플래그가 켜져 있으면 `query` 있는 호출이 임베딩 API 를 부른다 — A 는 플래그를 끄고 돌린다(비용 0 유지).

### B. LLM eval (골든셋 20건, 같은 날·같은 모델·같은 플래그)

| 비교군 | 무엇을 보나 |
|---|---|
| `inprocess` | **오늘의 기준선** — 2026-07-25 기록(17/17)은 의미 검색 도구 변경 전이라 그대로 비교하지 않는다 |
| `mcp` | 기준선과 같은가 — 도구 선택 정확도·trap 규칙·왕복 수·토큰 |
| `mcp-text` | D3 가 왜 필요한지 — 결과가 문자열로 감싸졌을 때 정확도·judge 충실성이 변하는가 |

- 실행: `ASSISTANT_TOOL_TRANSPORT=<군> … node -r ts-node/register/transpile-only eval/run-eval.ts` (cwd=backend). `RunReport` 에 `toolTransport` 필드 하나만 추가. 각 결과 파일에 `run-judge.ts`.
- **가설(사전 기록)**: A 는 전부 동등. B 의 `mcp` 는 기준선과 통과 집합이 같다. `mcp-text` 는 도구 선택은 같고(스키마가 같으므로) 수치 인용 충실성에서 차이가 날 수 있다.
- 차이가 나면 해당 케이스만 `--only` 로 2회 더 돌려 **비결정성 vs 변환 차이**를 가른다.
- 비용: 군당 약 40 요청(7월 기록 37~38 왕복) × 3 + judge. 무료티어 RPM 15 → 기본 `--delay 5000` 유지, 하루에 다 못 돌면 **세 군을 같은 날 묶어** 다음 날 다시.
- 결과가 가설과 다르면 그대로 적는다. "차이 없음"도 결과다.

## 7. 하지 않는 것

| 하지 않는 것 | 이유 |
|---|---|
| 운영 배포 | 연습 목적. 운영에 열면 OAuth·레이트리밋·감사를 제대로 설계해야 한다 |
| OAuth(원격 MCP 정식 인증) | 범위 밖. 1단계 후 "운영에 연다면 무엇이 필요한가"를 문서로만 정리 |
| 쓰기 도구 | 6개 모두 조회 전용. 쓰기는 사람 승인 설계가 먼저다 |
| 어시스턴트 대화 저장 방식 변경 | 2단계는 도구 경로만 바꾼다 |
| resources·prompts | 선택 4단계 후보 — 예: `prompts` 로 "주간 운영 리포트" 틀, `resources` 로 도구 사용 안내 |

## 8. 착수 전 확인

- 작업 트리에 **미커밋 주문 만료·결제 변경**(`order.service.ts`·`payment.service.ts`·`order-expiry.integration.spec.ts`)이 있다 — 이 작업과 섞지 않는다. 그 변경을 정리한 뒤 main 에서 새 브랜치(`feat/mcp-practice`).
- SDK 서브패스 CJS import — 패키지 구조는 확인(§10), 번들 런타임은 미확인(§4 순서 1).
- MCP 스펙의 `inputSchema` JSON Schema 방언 — `toolParameters()` 는 draft-7 로 만들고 `$schema` 를 지운다. 쓰는 키워드가 단순해 문제없을 것으로 보지만 Claude Code 연결 때 경고가 없는지 확인.
- 1단계 머지 여부(§4 함정 — 라우트 수 인용).

## 9. 결과 기록 (진행하며 채운다)

| 단계 | 날짜 | 결과 | 비고 |
|---|---|---|---|
| 0 nx-mcp 연결 | 2026-11-01 | **원인 확인, 고치지 않음**(결정: 1단계와 무관 — 원인만 기록). Nx 21.6.3 의 `nx mcp` 는 자체 서버가 아니라 `yarn dlx --quiet nx-mcp@latest` 를 **셸 없이** `spawnSync('yarn')` 하는 래퍼다. Windows 에선 `yarn` 이 `yarn.cmd` 라 `ENOENT` → 래퍼가 오류를 확인하지 않고 `process.exit(0)` → 출력 없이 종료 = `CONNECTION_CLOSED`. 같은 spawn 을 `shell:true` 로 돌리면 정상 | initialize 메시지를 stdin 으로 넣어 실측: `npx nx mcp`·**`cmd /c npx nx mcp`(§4 의 1순위 추정) 모두 2초 만에 출력 없이 exit 0 — 추정은 틀렸다**(실패 지점이 Claude Code→npx 가 아니라 nx 내부 spawn). `cmd /c npx -y nx-mcp@latest`(첫 15초)·`cmd /c yarn dlx --quiet nx-mcp@latest`(9초)는 initialize 응답 정상. Claude Code health check 로는 미확인(임시 폴더 설정은 "승인 대기"라 안 돈다). 고친다면 `.mcp.json` 을 `npx -y nx-mcp@latest` 로(래퍼 우회) |
| 1 SDK 설치·번들 스모크 | 2026-11-01 | 통과 | `@modelcontextprotocol/sdk` 1.32.2(루트 `^1.32.2` + `backend/package.json` `"*"`). `yarn add`·`yarn install` 이 매번 `backend/package.json` 서식을 통째로 다시 써서(약 330줄) 되돌리고 한 줄만 넣음. lockfile 은 추가만(express 5.3.0·hono 등). SDK 의 zod 는 dependency 겸 peer — 런타임은 루트 zod 4.3.6 하나. `main.ts` 임시 스모크(서브패스 5개 import + InMemory 로 `tools/list` 왕복 + Streamable HTTP 생성) → `nx build` 번들에 외부 `require("@modelcontextprotocol/sdk/…")` 5개, `nx serve` 로그 `[MCP-SMOKE] tools=ping` 후 정상 기동. 스모크 코드는 되돌림 |
| 1 팩토리·단위 테스트 | 2026-11-01 | 15/15, 어시스턴트 폴더 6 스위트 95/95 | `shop-mcp-server.spec.ts`(InMemory + 실제 SDK Client): 도구 6개 깊은 동등(의미 검색 off/on) · instructions · 정규화(Date→ISO, undefined 제거) · 텍스트 = structuredContent · 취소 signal 전파 · 실제 `executeTool` 실패 5종이 `isError` 없는 구조화 결과. 변이 확인: 정규화 제거 → 1건 실패(**InMemory 가 직렬화 없이 객체를 넘긴다는 D7 전제를 실측**), `isError: true` → 6건 실패 |
| 1 HTTP 수동 확인(curl) | 2026-11-01 | 통과 | 계정 `e2e-mcp-admin@test.local`(admin)·`e2e-mcp-buyer@test.local`(buyer), 개발 DB 에 하네스 방식으로 생성. 플래그 off: POST·GET 토큰 없음 401 · buyer 403 · admin 404(DELETE 도 404). 플래그 on: initialize 200(세션 헤더 없음, `application/json`) · initialized 202 · tools/list 6개(HTTP 로 받은 정의가 `assistantTools(false,false)` 와 JSON 4,971바이트 동일) · tools/call 매출 `742,900원/14건`, 주문 상태 14건(preparing 3·shipped 1·delivered 1·completed 9 — SQL 대조 일치), 승인 대기 0건(개발 DB 상품 352건 전부 approved) · 스키마 밖 인자 `invalid_arguments` · 없는 도구 `unsupported` · 한국어 카테고리 인자 왕복 · Accept 없음 406 · GET·DELETE 405(`Allow: POST`) · 깨진 JSON 400. 서버 로그 `[mcp] tools/call <이름> argKeys=… admin=1311` |
| 1 Claude Code 연결·질문 3개 | 2026-11-01 | 등록 완료 · CLI health check `✔ Connected` · `/mcp`·질문 3개는 사용자 확인 대기 | `setx SHOP_MCP_EMAIL/PASSWORD`(사용자 환경변수) + `claude mcp add-json shop-local … --scope local` → `~/.claude.json` 의 `C:/Users/kiria/Desktop/fullstack/shopping_mall`(trust: true) 항목. 같은 프로젝트의 다른 표기 항목 `c:/…`(소문자)는 trust: false — 세션이 그쪽을 쓰면 헬퍼가 안 돈다 |
| 2 채팅 화면 MCP 경유 | | | |
| 3-A 동등성 | | | |
| 3-B inprocess / mcp / mcp-text | | | |

## 10. 검토 기록

### 2026-11-01 1차 — SDK 실물(`npm pack @modelcontextprotocol/sdk@1.32.2`, 실행 없이 소스만)·공식 문서·우리 코드로 대조

| 초안 | 확인 결과 | 반영 |
|---|---|---|
| D2 "McpServer 는 zod 를 다시 변환한다" | 맞음. 근거 3개로 구체화(override 누락 · union 정규화 · 자체 인자 검증이 우리 구조화 실패를 가로챔). `Server` 는 `@deprecated` | D2 |
| 결과 실패 객체면 `isError: true` | `status` 를 도구 실패와 의미 검색 상태가 함께 써서 정상 결과(`unavailable`·`no_data`)가 오류로 분류될 수 있음 | D3: `isError` 안 씀 |
| D7 "InMemory 로 변수를 프로토콜·변환 하나로" | InMemory 는 객체를 그대로 넘기고 **직렬화하지 않음** → 변환 차이를 못 잡는다 | D7 정규화 + 3-A 에 HTTP 경로 추가 |
| `client.callTool(params, { signal })` | 실제 시그니처는 `(params, resultSchema?, options?)` | §5 |
| 컨트롤러 `user.id` | 이 프로젝트는 `@User('sub')`·`@User('roles')` | §4 골격 |
| 플래그 off 를 컨트롤러 등록으로 | 모듈 평가가 `.env` 로드보다 먼저일 수 있음 · 역할 경계 테스트와 얽힘 | D6: 요청 시점 가드, 마지막 순서 |
| curl 수동 확인 | POST 는 `Accept: application/json, text/event-stream` 필수(없으면 406) | §4 순서 3 |
| "토큰 15분 만료 → 손으로 재연결" | 공식 문서: 401/403 이면 헬퍼 재실행 + 1회 재시도 | D5, §4 완료 기준 |
| 서버 취소 신호 | 초안은 HTTP 경로에 signal 이 없었음 → `extra.signal` 로 context 생성 | §4 골격 |
| (빠짐) | 1단계에선 우리 시스템 프롬프트가 따라가지 않는다 | D9 신설 |
| (빠짐) | 새 라우트가 포트폴리오 문서의 라우트 수 인용을 낡게 만든다 | §4 함정, §8 |
| nx-mcp `cmd /c` | 공식 MCP 문서에서 근거를 찾지 못함 | §4 순서 0 을 "추정"으로 |

### 2026-11-01 2차 — 구현 중 실측으로 바뀐 것

| 설계 | 실측 | 반영 |
|---|---|---|
| §4 순서 0 "`cmd /c` 가 1순위 후보(추정)" | 틀림 — nx 래퍼 내부의 셸 없는 `spawnSync('yarn')` 이 원인. `cmd /c` 로 감싸도 그대로 | §4 순서 0, §9 |
| "POST 만 처리(GET·DELETE 405)" + "새 라우트 1개" | 둘을 같이 만족할 수 없다. 라우트가 없으면 Nest 404 인데 SDK 클라이언트는 initialize 직후 GET 을 보내 405 만 "SSE 없음"으로 넘기고 404 는 `onerror` 로 올린다. `@All()` 은 `list-api-surface.mjs` 가 세지 않아(Get/Post/Patch/Put/Delete 만) 보안 목록에서 숨는다 | **사용자 결정**: `@Get`·`@Delete` 핸들러(같은 가드 + 405) → 라우트 3개. §4 완료 기준 |
| (빠짐) | `check-dto-decorators.mjs` 는 `@Body`/`@Query` 클래스만 본다 — `@Req().body` 인 MCP 라우트는 점검 대상 밖. 입력 검증은 SDK(JSON-RPC 형식) + `parseToolArguments`(zod strict) | 보안 문서 §9 분류표에 명시 |
| (빠짐) | **헬퍼가 실패하면 OAuth 오류로 보인다** — 환경변수 없이 `claude mcp get shop-local` → 헤더 없이 401 → Claude Code 가 OAuth 로 넘어가 `Dynamic Client Registration rejected (HTTP 404): Cannot POST /register`. 같은 명령에 `SHOP_MCP_*` 를 주면 `✔ Connected`. `setx` 로 넣은 사용자 환경변수는 **이미 떠 있는 VS Code·Claude Code 에는 안 들어간다**(재시작 필요) | 진단 순서: `/register` 404 가 보이면 OAuth 가 아니라 헬퍼(환경변수·로그인)를 먼저 본다 |
| (빠짐) | **VS Code 확장은 프로젝트를 소문자 `c:/…` 경로 키로 연다** — Git Bash 의 `claude mcp add-json --scope local` 은 대문자 `C:/…` 키에 기록해서, 새 VS Code 대화에는 `shop-local` 이 아예 붙지 않았다(그 대화는 숫자를 지어내지 않고 "조회 수단이 없다"고 답함). 터미널 `claude`(대문자 경로)는 Connected. 소문자 키는 `hasTrustDialogAccepted: false` 라 서버 항목만 복사하면 헬퍼가 안 돈다 → 복사 + 신뢰 둘 다 필요. 이 수정은 Claude Code 자기 설정 변경이라 에이전트 권한 검사가 거부 → 사용자가 직접 실행 | §4 순서 4 의 등록은 VS Code 에서 쓸 경로 키를 확인하고 한다 |
| (빠짐) | 백그라운드 `nx serve` 를 멈춰도 Windows 에선 `watch-server.js` 가 살아남아 node 를 다시 띄운다 — 4000 을 다시 잡는다 | 서버 정리는 프로세스 트리째(커맨드라인으로 찾아 종료) |
