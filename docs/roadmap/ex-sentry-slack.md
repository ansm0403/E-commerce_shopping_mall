# 운영/관측성 — Sentry 에러 추적 + Slack 알림 (계획 외 삽입)

> 이 문서는 로드맵의 숫자 시퀀스(`00`~`03`: 셀러 → 관리자 → 인프라) **밖**의 작업이다.
> 그래서 번호 대신 `ex-`(시퀀스 밖 / extra) 프리픽스를 쓴다.
> 원래 계획(기능 전달)과 무관하게, **운영 가시성**을 먼저 확보하려고 중간에 끼어든 트랙이다.
>
> 성격: "무엇을 만들지" 계획서가 아니라, **이미 한 작업의 회고 + 트러블슈팅 로그**다.
> 관련 커밋: `677c5d4`(Slack 연동), `cb943ca`(Sentry 연동), `591757b`(deps 동기화).
> 작성 기준일: 2026-06-14. 인용한 `파일:라인`은 변경 시 달라질 수 있으니 재확인.

---

## 0. 한 줄 결론

- **프론트·백엔드 런타임 에러를 Sentry로 수집**하고, **새 이슈 발생 시 Slack `#sentry-errors`로 알림**이 가도록 연동 완료.
- 그 외 **CI 결과 → `#deployments`**, **Claude Code 작업 훅 → `#claude-hooks`** 까지 Slack 3종 알림 구성.
- 작업 자체보다 **연동 과정에서 만난 엣지케이스 6건**(§2)이 핵심 — 각각 "증상 → 원인 → 해결"로 기록한다.
- **비밀값은 코드에 없다.** 전부 gitignore 파일 / GitHub Secret / 배포 플랫폼 환경변수로 분리(§3).

---

## 1. 무엇을 붙였나 (구성)

### 1-1. Slack 알림 3종

| 채널 | 트리거 | 전달 방식 | 비밀값 위치 |
|---|---|---|---|
| `#deployments` | CI 파이프라인 성공/실패 | GitHub Actions step에서 `curl` POST | repo Secret `SLACK_WEBHOOK_DEPLOYMENTS` |
| `#claude-hooks` | Claude Code `Stop`/`Notification` 훅 | `.claude/notify-slack.mjs`가 stdin 이벤트 → POST | gitignore된 `.claude/.slack-webhook` |
| `#sentry-errors` | Sentry 새 이슈 생성 | **Sentry ↔ Slack OAuth 통합**(웹훅 아님) | Sentry 측 통합에 저장 |

> ⚑ `#sentry-errors`만 **Incoming Webhook이 아니라 Sentry의 Slack 통합(OAuth)**으로 동작한다.
> 나머지 둘은 채널별 Incoming Webhook URL을 직접 POST한다. 이 차이가 초기 혼란 지점이었다.

### 1-2. Sentry SDK

| 영역 | 패키지 | 핵심 파일 |
|---|---|---|
| 백엔드 | `@sentry/nestjs` | `instrument.ts`, `app.module.ts`(전역 필터) |
| 프론트(클라/서버/엣지) | `@sentry/nextjs` | `instrumentation*.ts`, `sentry.*.config.ts`, `global-error.tsx`, `next.config.js` |

- 백엔드: [main.ts:7](../../backend/src/main.ts#L7)에서 `import './instrument'`를 **모든 import보다 먼저** 실행 → NestJS/Express/DB 자동 계측. DSN 미설정 시 자동 no-op이라 로컬 안전([instrument.ts](../../backend/src/instrument.ts#L8)).
- 프론트: 서버/엣지는 [instrumentation.ts](../../frontend/src/instrumentation.ts#L6)의 `register()`가 런타임별 config를 동적 로드, 클라이언트는 [instrumentation-client.ts](../../frontend/src/instrumentation-client.ts#L10)(Session Replay 포함), 렌더 에러는 [global-error.tsx:14](../../frontend/src/app/global-error.tsx#L14)에서 `captureException`.

---

## 2. 트러블슈팅 / 엣지케이스 (이 문서의 핵심)

### ⚠ 2-1. GitHub Push Protection에 푸시가 막힘

- **증상**: `.slack-webhook.example`에 형식 안내용으로 적은 `https://hooks.slack.com/services/T.../B.../...` 가 실제 Slack 웹훅 패턴과 일치 → push가 거부됨.
- **원인**: GitHub의 시크릿 스캐닝이 예시 URL도 "실제 시크릿"으로 탐지.
- **해결**: 예시를 실제 URL 구조가 아닌 **플레이스홀더**(`<TEAM_ID>/<CHANNEL_ID>/<SECRET_TOKEN>`)로 교체. 실제 웹훅은 gitignore된 `.claude/.slack-webhook`에만 둔다.

### ⚠ 2-2. 백엔드 `isHeadersSent` 크래시 (전역 필터 주입)

- **증상**: 에러 발생 시 Sentry 필터가 응답을 처리하다 `applicationRef.isHeadersSent()` 호출에서 `TypeError`(이중 에러).
- **원인**: `SentryGlobalFilter`를 `useClass`로 등록하면 상속한 `BaseExceptionFilter`에 **`httpAdapter`가 주입되지 않음** → `applicationRef`가 undefined.
- **해결**: [app.module.ts:93-98](../../backend/src/app/app.module.ts#L93-L98) — `useClass` 대신 **`useFactory` + `HttpAdapterHost` 주입**으로 `httpAdapter`를 명시 전달.

```ts
{
  provide: APP_FILTER,
  useFactory: (httpAdapterHost: HttpAdapterHost) =>
    new SentryGlobalFilter(httpAdapterHost.httpAdapter),
  inject: [HttpAdapterHost],
}
```

### ⚠ 2-3. 프론트 클라이언트 번들이 `node:async_hooks`에서 깨짐

- **증상**: `@sentry/nextjs` 추가 후 프론트 빌드가 클라이언트 번들에서 `node:async_hooks` 모듈을 찾다 실패.
- **원인**: 모노레포 소스 직접 참조를 위해 커스텀 `conditionNames`를 쓰고 있었는데, 이게 Next.js 기본 조건(`browser`/`edge-light`)을 **덮어써서** Sentry가 클라이언트에서도 **node 빌드**로 resolve됨.
- **해결**: [next.config.js:143-151](../../frontend/next.config.js#L143-L151) — `conditionNames`에 런타임 조건부로 `browser`(클라), `edge-light`(엣지)를 추가하고, webpack 콜백 시그니처를 `{ isServer, nextRuntime }`로 확장.

### ⚠ 2-4. 프론트 이벤트가 Sentry에 안 닿음 (광고차단)

- **증상**: SDK 초기화·`flush=true`인데도 이벤트가 Sentry에 안 보임. 백엔드는 정상.
- **원인**: 브라우저 광고차단/추적방지가 `ingest.sentry.io`로 가는 요청을 **네트워크 레벨에서 차단**.
- **해결**: [next.config.js:222](../../frontend/next.config.js#L222) — `withSentryConfig`에 **`tunnelRoute: '/monitoring'`** 추가. 이벤트를 같은 오리진(`/monitoring`)으로 우회시켜 차단을 회피(운영에서도 이벤트 유실 방지).

### ⚠ 2-5. Slack 알림이 안 오던 진짜 이유 — `A new issue is created`는 지문당 1회

- **증상**: Sentry에 **이슈는 생성되는데** Slack 알림은 안 옴. 환경 필터(`All Environments`)·Slack 연동(테스트 발송 정상) 모두 이상 없음.
- **원인**: 알림 룰 조건이 `A new issue is created`인데, 같은 메시지·같은 코드 위치의 에러는 Sentry가 **같은 지문(fingerprint)으로 묶어** 기존 이슈에 이벤트만 추가 → "새 이슈"가 아니라 발동 안 함. (frontend 룰이 "한 번도 트리거 안 됨"이던 것도 같은 이유.)
- **결론**: **코드/설정 결함이 아니었다.** 운영에선 서로 다른 진짜 에러가 각각 새 이슈가 되므로 정상 작동.
- **검증 방법**: 테스트용으로 **명시적 fingerprint**를 매번 유니크하게 주어 "새 이슈"를 강제 생성 → 알림 발동 확인. (검증용 임시 라우트/페이지는 확인 후 제거.)

### ⚠ 2-6. 성능 — dev TBT 2,200ms vs 운영 200ms

- **증상**: Sentry 추가 후 화면 전환이 느려 보임. Lighthouse(모바일, 빠른 4G, 캐시 미사용)에서 **TBT 2,200ms / Speed Index 8.0s** 빨간불. (이전엔 배너 이미지로 LCP가 문제였음.)
- **원인 분석**: FCP/LCP/CLS는 양호한데 TBT/SI만 빨간불 = **메인 스레드 JS 실행 과부하** 패턴. 1순위 의심은 측정 환경(dev 서버는 비압축 React + dev 경고로 TBT가 5~10배 부풀려짐), 2순위는 Sentry **Session Replay(rrweb)**.
- **해결/결론**: **운영 빌드로 재측정** → **TBT 200ms / LCP 1.5s / FCP 1.1s**로 정상화. 그 빨간불은 **순수 dev 모드 오버헤드**였고, Session Replay는 운영에서 부담이 거의 없음(무혐의). **교훈: 성능 측정은 반드시 운영 빌드에서.**
- 남은 항목: 운영 Speed Index 5.2s는 "개선 여지"(노란불) — 급하지 않음, 후속 과제로 분리.

---

## 3. 시크릿 / 환경변수 관리 (코드에 비밀값 없음)

| 값 | 용도 | 보관 위치 |
|---|---|---|
| `SLACK_WEBHOOK_DEPLOYMENTS` | CI → `#deployments` | GitHub repo Secret |
| Claude 훅 웹훅 | 훅 → `#claude-hooks` | `.claude/.slack-webhook` (gitignore) / 또는 env `SLACK_WEBHOOK_CLAUDE_HOOKS` |
| `SENTRY_DSN` (백엔드) | 에러 전송 | 로컬 `backend/.env`(gitignore) / 운영 EC2 환경변수 |
| `NEXT_PUBLIC_SENTRY_DSN` (프론트) | 에러 전송 | 로컬 `frontend/.env`(gitignore) / 운영 Vercel 환경변수 |

- 훅 스크립트는 웹훅이 없으면 **조용히 종료**해 Claude 작업 흐름을 막지 않는다([notify-slack.mjs:57](../../.claude/notify-slack.mjs#L57)).
- Sentry SDK는 DSN이 없으면 **자동 no-op** → 로컬에서 별도 분기 없이 안전.

---

## 4. 남은 것 / 후속 과제

- ✅ 검증용 임시 스캐폴딩(`backend GET /v1/debug-sentry`, `frontend /sentry-test`) 제거.
- ⏸ **운영 Speed Index 5.2s** 개선(노란불) — 메인 스레드/번들 관점에서 별도 측정 후 판단.
- ⏸ **Session Replay 비용 모니터링** — 현재 무혐의지만, 트래픽 늘면 `replaysSessionSampleRate`(현 0.1) 재검토 여지.
- ℹ️ 운영에서 Sentry가 동작하려면 위 §3의 운영 환경변수(Vercel `NEXT_PUBLIC_SENTRY_DSN`, EC2 `SENTRY_DSN`)가 반드시 설정돼 있어야 함.

---

## 5. 파일 매핑 (조회용)

**Slack 알림**
- 훅 스크립트: [.claude/notify-slack.mjs](../../.claude/notify-slack.mjs) / 훅 등록 [.claude/settings.json](../../.claude/settings.json)
- CI 알림 step: [.github/workflows/ci.yml:96](../../.github/workflows/ci.yml#L96) (수동 실행 트리거 [:10](../../.github/workflows/ci.yml#L10))

**Sentry 백엔드**
- 초기화: [instrument.ts](../../backend/src/instrument.ts) / 최상단 import [main.ts:7](../../backend/src/main.ts#L7)
- 전역 필터: [app.module.ts:34](../../backend/src/app/app.module.ts#L34)(`SentryModule.forRoot`), [:93-98](../../backend/src/app/app.module.ts#L93-L98)(`SentryGlobalFilter`)

**Sentry 프론트**
- 서버/엣지 진입: [instrumentation.ts](../../frontend/src/instrumentation.ts) / [sentry.server.config.ts](../../frontend/src/sentry.server.config.ts) / [sentry.edge.config.ts](../../frontend/src/sentry.edge.config.ts)
- 클라이언트(+Replay): [instrumentation-client.ts](../../frontend/src/instrumentation-client.ts)
- 전역 에러 바운더리: [global-error.tsx](../../frontend/src/app/global-error.tsx)
- 빌드 설정(conditionNames·tunnelRoute): [next.config.js:143-151](../../frontend/next.config.js#L143-L151), [:214-223](../../frontend/next.config.js#L214-L223)
