# 백엔드 (`backend/src`) — 규칙·함정

> 백엔드 파일을 읽을 때 자동 로드된다. 완료 기록·경위는 쓰지 않는다(→ `docs/roadmap/`).

## 구조
- 모듈러 모놀리식: 기능 폴더 = Nest 모듈(`*.module/controller/service.ts` + `dto/` + `entity/`). 모듈: auth, user, seller, category, product, review, cart, order, payment, settlement, inquiry, wish-list, audit, admin(+assistant), ops(RN 운영 앱 전용), common, intrastructure, seed.
- 전역: prefix `/v1`, 포트 4000(`main.ts`), `ValidationPipe({transform:true})` + `ClassSerializerInterceptor`, `ThrottlerModule`(100req/60s), `EventEmitterModule`. 전역 Throttler 가드·예외 필터는 `app/app.module.ts`. 공통 엔티티 `BaseModel`(id/createdAt/updatedAt), 페이지네이션 page/cursor 둘 다(`common/`).
- 이름과 정체가 어긋나는 곳:
  - `intrastructure/`(오타 그대로) = `redis/` · `emailVerify/`(SMTP) · `ai/`(프로바이더 비종속 `LlmClient`, 현재 Gemini `@google/genai`).
  - 가드/데코레이터는 `common/` 이 아니라 `auth/guards`·`auth/decorators`(`JwtAuthGuard`·`RolesGuard`·`DemoAccountGuard`, `@Roles()`·`@User()`) 와 `audit/decorators`(`@Auditable()` — `audit.module` 이 전역 인터셉터 등록).
  - `data/` 는 모듈이 아니라 상품 시드 원본. 시드는 둘: `common/seeds/`(roles·category 부트스트랩 자동, product 는 `POST /products/seed`) vs `seed/`(`NODE_SEED=true` 일 때만 등록).
  - `RedisModule.forRoot()` 는 `auth.module`, `ScheduleModule.forRoot()` 는 `order.module` — ops 폴러 `@Cron` 도 여기에 기댄다(두 번 올리면 잡 중복).

## 인증
- JWT access 15m + refresh 7d(해시 저장 + Redis 검증/블랙리스트). 이메일 인증·비번 재설정·로그인 레이트리밋(Redis).
- access payload 에 **`jti`(uuid) 필수** — 블랙리스트 키가 토큰 문자열이라, 없으면 같은 사용자·같은 초 발급 토큰이 문자열까지 같아져 로그아웃 직후 재발급분이 401.
- 역할 `Role = buyer | seller | admin`(`user/entity/role.entity.ts`, User↔Role 다대다). 인가는 **토큰에 실린 역할** 기준 — 역할 부여 뒤엔 refresh 가 있어야 반영된다.
- 모바일 분기: `X-Client: mobile` 이면 `login`/`refresh` 응답 body 에 refreshToken 동봉, `refresh`/`logout` 은 `쿠키 ?? body.refreshToken`(RN 앱엔 쿠키를 구워줄 BFF 가 없음). 헤더 없으면 웹 동작 불변. `auth.controller.ts buildTokenResponse`.
- 데모 계정 제한은 토큰 `isDemo` 로 **백엔드가** 적용(`DemoAccountGuard` 등). 앱·웹 화면 안내는 보조일 뿐.

## DB 마이그레이션
- 스키마 변경은 마이그레이션으로만(synchronize 전면 off): 엔티티 수정 → `nx run @shopping-mall/backend:migration:generate --name=<이름>` → `src/database/migrations/index.ts` 에 **명시 등록**(글롭은 nx 단일 번들이라 조용히 실패) → `migration:run`. CLI DataSource `src/database/data-source.ts`(cwd=backend 필수). 상세 `docs/roadmap/ex-db-migration.md`.
- 운영 적용은 부팅 시 자동이 아니다(`migrationsRun: false`): EC2 에서 `docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js`(+ `… migrate.js check`) 후 컨테이너 교체(`src/migrate.ts`). 명령 출처는 `ex-db-migration-deploy-runbook.md` §5 — 단 그 런북 §4(DB 리셋)는 2026-08 한 번뿐인 절차라 **따라 하지 않는다**.
- raw SQL 별칭에 camelCase 를 쓰면 **큰따옴표 필수** — Postgres 가 소문자로 접어 매핑이 0 이 된다(mock 단위 테스트는 못 잡고 e2e 가 잡는다). 예 `ops/ops-review.service.ts`.

## 직렬화 함정
- 민감 필드는 엔티티에 `@Exclude()`(예: `UserModel.password` — 없으면 `relations:['user']` 응답에 해시가 샌다. 셀러 은행정보도).
- `@Serialize` 는 `excludeExtraneousValues` — 응답 DTO 가 `BaseModel` 을 상속하면 `@Expose` 없는 id/createdAt/updatedAt 이 **응답에서 빠진다**. 기본 필드는 직접 재선언(예 `settlement/dto/settlement-response.dto.ts`).
- LLM 도구 결과는 직렬화 인터셉터를 거치지 않아 `@Exclude` 가 무력 → 디스패처에서 마스킹/projection/`scrubText`(`common/utils/scrub-text.ts`).

## 도메인 규칙
- 결제: PortOne V2. 웹훅은 발신자를 두 겹으로 확인 — 앱 층 Standard Webhooks 서명(`webhook-signature.ts` + `PortOneWebhookVerifier`, `PORTONE_WEBHOOK_SECRET` 없으면 운영 503·로컬 건너뜀, `main.ts` `rawBody: true` 필수) + nginx `location = /v1/payments/webhook` 발신 IP allow. 본문은 믿지 않고 PortOne 재조회로 대조. 웹훅이 verify 보다 **먼저** 올 수 있다(실측).
- 상품 승인=게시: `approve()` 는 **DRAFT 일 때만** PUBLISHED 로 승격(재승인 시 셀러의 숨김 존중) + Redis 캐시 무효화. `PATCH /products/:id/status` 는 approvalStatus 를 건드리지 않는다(재심사 미발동). 반려 상품은 수정 = 재제출(PENDING).
- `orderItem.sellerId` 가 없으면 `null`(**0 금지** — shipments FK 위반으로 `order.paid` 리스너가 재시도 루프). 정산 생성은 `settlement/listeners`(구매확정 `order.completed` → 셀러별 PENDING, 수수료 10%, 멱등).
- 셀러 승인 = seller.status 변경 + SELLER 역할 부여를 한 트랜잭션.
- Gemini function calling: 다음 턴에 모델이 보낸 **원본 `parts` 를 그대로** 재전송(`thoughtSignature` 보존 — `response.functionCalls` 로 재구성하면 400). `docs/roadmap/ex-ai-assistant.md` §8-1.

## 관측성 / ops
- Sentry: `src/instrument.ts`(`main.ts` 최상단 import, `release: APP_VERSION`). webpack 옵션 이름은 `sourceMap`(`backend/webpack.config.js`), 실행은 루트 `Dockerfile` 의 `node --enable-source-maps`.
- `ops/`(`/v1/ops/*`, admin 전용, RN 앱 전용): Sentry Web API 프록시, 키(`SENTRY_AUTH_TOKEN`/`SENTRY_ORG_SLUG`) 없으면 503 no-op. Release Health 는 `project` 지정·`interval: '1d'` 필수(`sentry-api.client.ts` — 빠지면 웹 세션이 섞이거나 새 릴리즈가 조용히 빠진다). 인시던트 메모(`ops_incident_notes`)는 **LLM 입력 금지** — `OpsAnalysisService` 는 `OpsNoteService` 를 주입받지 않는다(응답 보강은 컨트롤러 `enrichAnalysis`). 상세 `docs/roadmap/ops-companion-design.md`.
- CORS 목록 밖 Origin 은 지금 500(`main.ts`). 새 프론트 도메인은 EC2 `.env` `CORS_ORIGINS` 에 추가 후 재시작.
