# 운영/관측성 — 모니터링 체계 지도 (ex- 트랙)

> 이 문서는 로드맵 숫자 시퀀스(`00`~`03`) **밖**의 운영 가시성 트랙이다. 그래서 `ex-` 프리픽스를 쓴다.
>
> **역할 분담** — 관측 관련 문서가 넷이다. 겹치지 않게 다음처럼 나눈다.
> - [ex-sentry-slack.md](./ex-sentry-slack.md): Sentry·Slack **연동 과정의 회고**(엣지케이스 6건). 연동 방법·파일 위치는 그쪽이 원본이다.
> - [ex-audit-log-admin.md](./ex-audit-log-admin.md): 감사 로그 **뷰어 구현** 계획·결과.
> - [../blog/sentry-axios-silent-failure.md](../blog/sentry-axios-silent-failure.md): 프론트 Sentry가 API 실패를 못 잡던 문제의 **원인 분석과 수정 코드**(블로그 공개용).
> - **이 문서**: 흩어진 관측 자산을 **한 장의 지도**로 놓고, "무엇을 보고 무엇을 못 보는가", "장애가 나면 누가 먼저 알려주나", "알림은 어디로 보내나"를 정한다.
>
> 작성 기준일: **2026-09-16**. 이 개정판의 수치는 **대부분 추정이 아니라 실측**이다.
> 측정 방법과 원본 로그는 §9에 정리했다. 확인하지 못한 것은 `확인 필요`로 표시했다.

---

## 0. 한 줄 결론

- 관측 자산 8가지가 **4개 층위**(인프라 / 애플리케이션 / 행위·보안 / AI 품질)에 흩어져 있다.
- **2026-09-16 실측으로 사각지대 셋이 확정됐다.** ① 프론트 Sentry는 **API 실패를 단 한 건도 못 잡는다**. ② `/v1/health`는 DB·Redis를 안 봐서 DB만 죽으면 아무도 모른다. ③ 인증서 갱신은 실패해도 **완전히 침묵**한다.
- **알림 통로 둘이 이미 끊겨 있었고 아무도 몰랐다.** Slack `#sentry-errors`는 Sentry 무료 플랜이 Slack 통합을 막으면서 죽었고, UptimeRobot 다운 메일은 **스팸함**으로 갔다. 감시 도구를 감시하는 장치가 없었다는 뜻이다.
- 문서 곳곳의 **"Let's Encrypt 만료 경고 메일"은 2025-06-04 폐지**됐다. 인증서 감시는 "2겹"이 아니라 사실상 0겹이다.
- **Sentry 무료 플랜의 경계선을 실측으로 확정했다**(§5). Web API는 열려 있고 Slack 통합만 유료다. 그래서 **RN 앱 계획은 영향받지 않는다**(§6).
- 남은 과제 10건의 순위는 §7. 1·2순위는 각각 5분과 1시간이면 끝난다.

---

## 1. 왜 보는가 — 4개 층위

> 🎓 "모니터링"은 한 덩어리가 아니다. 무엇이 고장 났는지에 따라 보는 도구가 다르다. 아래 층이 죽으면 위 층이 전부 같이 죽는다.

| 층위 | 질문 | 보는 자산 | 못 보는 것 |
|---|---|---|---|
| **① 인프라** | 서버·컨테이너·프록시·인증서가 살아 있나? | UptimeRobot(5분), compose healthcheck 3종, certbot 갱신 루프, health `version` | **호스트 지표(CPU·메모리·디스크) 없음**, nginx·certbot은 healthcheck 없음 |
| **② 애플리케이션** | 코드가 예외를 던지나? | Sentry 백엔드 + 프론트 | **프론트의 API 실패 전부**(실측), 예외를 삼킨 실패, nginx 502 |
| **③ 행위·보안** | 누가 언제 무엇을 했나? | `audit_logs` + 관리자 뷰어(트리아지 3버킷) | **알림이 없다**. 들어가서 봐야 안다 |
| **④ AI 품질** | AI 응답이 나빠졌나? | `backend/eval/` 골든셋 20문항 + LLM-judge | **운영 중 실시간 감시 없음**. 쿼터 소진을 알려주는 것 없음 |

### 1-1. 반복해서 쓰는 개념 넷

- **liveness vs readiness** — "프로세스가 떠 있다"와 "일을 할 수 있다"는 다르다. [app.controller.ts:14-24](../../backend/src/app/app.controller.ts#L14-L24)의 `/v1/health`는 DB·Redis를 안 본다. **postgres를 완전히 죽인 상태에서도 200을 돌려주는 것을 실측으로 확인했다.** 즉 순수한 liveness 체크다. 이 사실 하나가 §3의 여러 줄을 설명한다.
- **push vs pull** — 알림이 나한테 오는 것(메일·Slack)과 내가 들어가서 봐야 하는 것(감사 로그 화면·Sentry 대시보드·`docker logs`). 이 문서에서 "못 본다"는 대개 "pull만 있다"는 뜻이다.
- **MTTD(탐지까지 걸리는 시간)** — 장애 발생부터 사람이 아는 순간까지. UptimeRobot 실측 **5분 33초**, Sentry는 초 단위, compose healthcheck는 약 90초 뒤 "unhealthy"로 **표시만** 한다.
- **alert fatigue(알림 피로)** — 행동으로 이어지지 않는 알림이 쌓이면 진짜 알림도 무시하게 된다. §4의 라우팅 원칙은 이걸 막으려는 것이다.

---

## 2. 자산별 역할과 사각지대

| # | 자산 | 층 | 방식 | 근거 | 무엇을 보나 | 무엇을 못 보나 |
|---|---|---|---|---|---|---|
| 1 | **Sentry 백엔드** | ② | push(메일) + pull | [instrument.ts](../../backend/src/instrument.ts) 운영 `tracesSampleRate` 0.1, [app.module.ts:99-104](../../backend/src/app/app.module.ts#L99-L104). EC2 `SENTRY_DSN` 설정 확인 | HTTP 핸들러에서 **던져진** 예외. CORS 거부(500)가 메일로 배달된 실적 있음 | catch로 삼킨 예외([assistant.service.ts:534-537](../../backend/src/admin/assistant/assistant.service.ts#L534-L537)), 크론 내부 `logger.error`, nginx 단독 502, 프로세스 부재 |
| 2 | **Sentry 프론트** | ② | push(메일) + pull | [instrumentation-client.ts](../../frontend/src/instrumentation-client.ts), [global-error.tsx](../../frontend/src/app/global-error.tsx), `tunnelRoute:'/monitoring'`([next.config.js:229](../../frontend/next.config.js#L229)) | 렌더 에러, 처리되지 않은 예외. **SDK·터널 정상 작동 실측** | ⚠ **API 실패 전부**. 백엔드가 10분간 완전히 죽어도 이벤트 0건(§3 ②·§9-3). 원인·수정은 [블로그 글](../blog/sentry-axios-silent-failure.md) |
| 3 | **Sentry 알림 룰 ①**(기본) | ② | push(메일) | 조건 = 새 이슈가 high priority가 될 때 **+ 기존 이슈가 high priority로 승격될 때**. 대상 = 추천 담당자 → 최근 활동 멤버 | 새 ERROR 이슈 **및 급증 에스컬레이션**. **실제 배달 확인됨** | **회귀**(resolved → unresolved)는 명시 조건이 없다. WARNING 이하는 우선순위가 낮아 조용히 지나간다 |
| 4 | **Sentry 알림 룰 ②**(Slack) | ② | ❌ **현재 무력** | 조건 = 새 이슈 생성, 필터 = 모든 이벤트, 환경 = All, 동작 = Slack | — | **Slack 통합이 무료 플랜에서 불가**(§5). 2026-07 체험 기간에 연결됐다가 만료로 비활성 → 삭제 후 재연결 불가. **언제 끊겼는지 아무도 몰랐다** |
| 5 | **Slack `#deployments`** | (CI) | push | [ci.yml:96-120](../../.github/workflows/ci.yml#L96-L120) `always()`, PR 제외 | GitHub Actions의 lint/test/build 결과 | **배포 자체**. 백엔드는 수동 ssh, 프론트는 Vercel 자동이라 **둘 다 이 채널과 무관**하다 |
| 6 | **Slack `#claude-hooks`** | (개발) | push | [.claude/settings.json](../../.claude/settings.json) → [notify-slack.mjs](../../.claude/notify-slack.mjs) | Claude Code 작업 완료·입력 대기 | 운영과 무관. **관측 자산이 아니라 개발 워크플로 알림**이다 |
| 7 | **UptimeRobot** | ① | push(메일) + pull | 모니터 1개, `https://api.ansmoon.dev/v1/health`, 5분, 메일 `kirianir@naver.com`. 체크 98건 전부 200 확인 | **외부에서** 도메인→nginx→backend가 200을 주는가. 탐지 **5분 33초** 실측 | DB/Redis 죽음(health가 안 봄), **인증서**(무료는 검사 안 함), **프론트 전체**. ⚠ 메일이 **스팸함**으로 감 |
| 8 | **health `version`** | ① | pull(curl) | [app.controller.ts:22](../../backend/src/app/app.controller.ts#L22) ← Dockerfile `GIT_SHA`. 실측 `5eb23c8` | 지금 어느 커밋이 도는가. 배포 사고 판별 | 자동으로 아무것도 안 한다. **사람 눈 확인용** |
| 9 | **compose healthcheck** | ① | 표시만 | [docker-compose.prod.yaml](../../docker-compose.prod.yaml) postgres·redis·backend 각 30s·3회. **nginx·certbot은 없음** | 기동 순서와 `docker compose ps`의 `(healthy)` 표시 | **unhealthy가 돼도 재시작·알림 없음**. backend 체크가 `/v1/health`라 **DB가 죽어도 healthy로 보인다** |
| 10 | **인증서 갱신 루프** | ① | ❌ 없음(침묵) | certbot 사이드카 `renew --quiet`([compose:95](../../docker-compose.prod.yaml#L95)) + nginx 6h reload. 현재 인증서 **2026-09-14 ~ 2026-12-13** | 정상일 때 조용히 갱신 | **실패해도 조용하다.** `--quiet`라 로그 0바이트(실측). LE 만료 메일은 **폐지**됨 |
| 11 | **감사 로그** | ③ | pull | [AuditAction](../../backend/src/audit/entity/audit-log.entity.ts#L3) 40여 종 + 뷰어(A 보안 / B 시스템오류 / C 관리자행위, 최근 30일) | 로그인 실패·잠금, 결제, 승인·반려, 크론 결과 | **아무것도 알리지 않는다.** 브루트포스 급증도 들어가서 봐야 안다 |
| 12 | **AI eval** | ④ | pull(수동) | [run-eval.ts](../../backend/eval/run-eval.ts) + [run-judge.ts](../../backend/eval/run-judge.ts), 골든셋 20문항 | 프롬프트·모델 변경 시 **회귀** | **운영 중 품질·비용·쿼터**. 무료티어 RPM 15에 묶여 CI 자동화 불가 |

### 2-1. 알림이 실제로 도착하는 통로 (2026-09-16 기준)

| 통로 | 보내는 주체 | 무엇이 | 상태 |
|---|---|---|---|
| **Sentry 이메일** | Sentry 기본 룰 | high priority 이슈 + 급증 | ✅ **배달 확인됨** |
| **UptimeRobot 메일** | UptimeRobot | 다운/복구 | ⚠ **스팸함으로 감** |
| **Slack `#sentry-errors`** | Sentry Slack 통합 | 새 이슈 | ❌ **끊김**(무료 플랜 제한) |
| **Slack `#deployments`** | GitHub Actions | CI 결과 | ✅ |
| **Slack `#claude-hooks`** | Claude Code | 작업 완료 | ✅ (운영 아님) |

이 표에 **없는 것**: Vercel(배포 실패 메일은 `확인 필요`), AWS(CloudWatch 알람 0개), PortOne(웹훅 미등록), Gemini(쿼터 알림 없음).

> ⚑ **이 표가 이 문서의 존재 이유다.** 운영에 쓰이는 push 통로 셋 중 **하나는 죽었고 하나는 스팸함에 있었다.** 둘 다 오늘 실험을 하기 전까지 드러나지 않았다.

---

## 3. 장애 시나리오 → 누가 먼저 알려주나

> 읽는 법: "첫 신호"는 **push로 사람에게 닿는 것**이다. 시간에 굵게 표시한 것은 실측값, 나머지는 설정에서 계산한 상한이다. "—"는 그 도구가 침묵한다는 뜻이다.

| # | 시나리오 | 사용자 영향 | UptimeRobot | Sentry | compose | **첫 신호 · MTTD** |
|---|---|---|---|---|---|---|
| ① | 백엔드 프로세스 크래시 | 수초 API 불가 | 5분 창 안 회복 시 — | 캡처 여부 `확인 필요` | 재시작 | 자가 회복. 아무도 모를 수 있음 |
| ② | 재배포 후 nginx reload 누락 → 502 | **API 전면 불가** | ✅ 메일 | 백엔드 —, **프론트 —**(실측) | backend는 `healthy` | **배포자 본인 curl** → 없으면 UptimeRobot |
| ③ | EC2 다운·정지 | **전면 불가** | ✅ **5분 33초**(실측) | — | — (같이 죽음) | **UptimeRobot**, 단 메일이 스팸함 |
| ④ | 인증서 갱신 실패 → 만료 | **만료일부터 전면 불가** | 만료 전 —, 만료 후 `확인 필요` | — | — | **사용자 신고**. 갱신 실패는 30일간 아무도 모름 |
| ⑤ | 디스크 가득 | 쓰기만 500 | — (health 200) | ✅ 쓰기 시 새 이슈 → 메일 | `pg_isready` 정상 | **Sentry, 간접적으로** |
| ⑥ | postgres만 죽음 | **캐시 만료 순서대로 번짐** | — (**200 실측**) | ✅ 첫 캐시미스에서 | `unhealthy` 표시만 | **Sentry(초)**. 단 캐시가 60초 가림 |
| ⑦ | Redis만 죽음 | 로그인·레이트리밋 영향 | — | `확인 필요` | `unhealthy` 표시만 | `확인 필요`(§9-5) |
| ⑧ | Vercel 빌드 실패 | **없음**(이전 배포 유지) | — (프론트 모니터 없음) | — | — | Vercel 메일 `확인 필요` |
| ⑨ | LLM 쿼터 소진 | 어시스턴트 실패, 요약은 stale 유지 | — | **—**(catch가 삼킴) | — | **관리자가 화면에서 직접 봄** |
| ⑩ | 결제 후 verify 전 이탈 | **돈은 빠지고 주문은 30분 뒤 취소** | — | — (정상 흐름) | — | **고객 문의** |

### 3-1. 시나리오별 근거

**② nginx 502 — 프론트도 못 잡는다(신규 확정).** nginx는 upstream 이름을 시작 시 1회만 해석한다([03-infra-nginx §8 함정 1](./03-infra-nginx.md)). `up -d`로 backend가 재생성되면 IP가 바뀌어 reload 전까지 502다. 이때 backend 자신의 healthcheck는 정상이라 compose는 `healthy`를 표시한다. **그리고 프론트 Sentry도 침묵한다**(§9-3). 1차 방어선은 도구가 아니라 [배포 절차 마지막 줄](./03-infra-nginx.md)의 `nginx -s reload` + `curl health`다.

**③ EC2 다운 — 실측 타임라인.** 2026-09-16 아침, EC2를 의도적으로 내려 측정했다. 시각은 UTC.

| 시각 | 사건 | 출처 |
|---|---|---|
| 21:59:57 | 마지막 성공 체크 | nginx 액세스 로그 |
| 22:00:39 | nginx 종료, 서비스 중단 | nginx `exit` |
| 22:05 경 | 다음 체크 실패(로그에 안 남음) | 체크 간격 5분 5초에서 역산 |
| **22:06:12** | **UptimeRobot 인시던트 확정 + 다운 메일 발송** | 메일 본문 |
| 22:16:16 | nginx 재기동 | nginx 로그 |
| 22:16:29 | 복구 확인, 복구 메일 | 로그와 메일이 **초 단위로 일치** |

**탐지 5분 33초.** 중단 42초 뒤에 이미 체크가 실패했는데 확정이 70초 더 걸린다. 그 사이가 UptimeRobot의 재확인 시간이다. 오탐을 줄이는 대신 탐지가 늦다.

세 가지가 더 드러났다. 첫째, **다운타임 기록이 실제보다 짧다.** 실제 15분 50초인데 기록은 10분 17초로, 탐지 지연분이 통째로 빠진다. 가동률 숫자를 볼 때 알고 봐야 한다. 둘째, **원인 표기가 `Connection Timeout`** 이라 서버 부재와 nginx 502를 메일 제목만으로 구분할 수 있다. 셋째, **메일이 스팸함으로 갔다.** 탐지도 발송도 즉시였으므로 문제는 배달이다.

**④ 인증서 — 감시가 사실상 0겹.** 갱신 루프는 `renew --quiet`라 성공·실패 모두 출력이 없다(certbot 컨테이너 로그 **0바이트** 실측). [03-infra-nginx.md:236](./03-infra-nginx.md#L236)과 [런북 §10](./03-infra-nginx-runbook.md) 결정 15는 "LE 만료 메일 + UptimeRobot = 2겹"이라 적었지만, **Let's Encrypt는 2025-06-04자로 만료 알림 메일을 종료**했다([공지](https://letsencrypt.org/2025/06/26/expiration-notification-service-has-ended)). 남은 1겹인 UptimeRobot도 **무료 플랜은 인증서를 검사하지 않는다**([도움말](https://help.uptimerobot.com/en/articles/11358746-monitor-ssl-certificate-expiration-errors-with-uptimerobot)). 현재 인증서는 2026-12-13 만료, 갱신 시도는 11-13부터다. 그 30일 창에서 실패가 반복돼도 아무도 모른 채 12-13에 API가 죽는다.

**⑤ 디스크.** 루트 19G 중 7.8G 사용(43%). **`/mnt/postgres-data`는 별도 EBS가 아니라 루트 디스크 위 디렉터리**다(`lsblk` 파티션 1개). 로그가 디스크를 채우면 postgres가 같이 죽는다. docker 로그 드라이버는 `json-file`이고 `/etc/docker/daemon.json`이 **없어 로테이션이 없다**. 16시간에 nginx 160K로 지금 속도는 느리지만 에러 폭주 때 급증한다.

**⑥ postgres만 죽음 — 캐시가 장애를 가린다(신규 발견).** 실측 결과가 셋이다.

| 상황 | health | 상품목록(캐시 미스) | 상품목록(캐시 히트) |
|---|---|---|---|
| 정상 | 200 | 200 | 200 |
| postgres 중지 | **200** | **500** | **200** |
| 재시작 10초 후 | 200 | 200 | 200 |

health가 200을 유지하는 것이 실측으로 확정됐다. 그리고 상품 목록은 60초 캐시라([product.service.ts](../../backend/src/product/product.service.ts) `CACHE_TTL_LIST`) **캐시에 있는 조회는 DB가 죽어도 계속 200을 준다.** 장애가 전면적으로 터지는 게 아니라 캐시 만료 순서대로 번지므로 탐지가 더 늦다. 반면 **복구는 빠르다.** postgres가 돌아오고 10초 안에 자동 재연결됐고 백엔드 재시작이 필요 없었다.

**⑨ LLM 쿼터.** [assistant.service.ts:534-537](../../backend/src/admin/assistant/assistant.service.ts#L534-L537)이 스트리밍 예외를 catch해 SSE `error`로 바꾸므로 `SentryGlobalFilter`를 거치지 않는다. 운영 경로에 429 재시도도 없다(백오프는 [eval-utils.ts](../../backend/eval/eval-utils.ts)에만 있음). 무료티어 RPM 15를 넘으면 관리자 화면의 실패 메시지가 유일한 신호다.

**⑩ 결제 이탈.** PortOne 웹훅 **미등록**([03-infra-nginx §10 12-2](./03-infra-nginx.md))이라 [handleWebhook](../../backend/src/payment/payment.service.ts#L389)은 죽은 코드고, 결제 확정은 브라우저가 부르는 [verifyPayment](../../backend/src/payment/payment.service.ts#L139)가 유일한 경로다. 승인 후 탭을 닫으면 주문은 30분 뒤 [expirePendingOrders](../../backend/src/order/order.service.ts#L534)가 취소하지만 **PortOne 쪽은 PAID 그대로**다. 시스템 관점에선 모든 단계가 정상이라 어떤 도구도 울리지 않는다. 해법은 감시가 아니라 웹훅 등록이다.

### 3-2. 매트릭스가 말해주는 것

1. **부팅 복구는 잘 된다.** EC2 재부팅 시 컨테이너 5개가 자동으로 떴고 502도 없었으며 13초 만에 200을 돌려줬다. `restart: unless-stopped`와 `depends_on` 설계가 의도대로 동작한다.
2. **health가 readiness를 안 보는 것 하나가 ⑤⑥⑦ 세 줄을 망친다.** DB·Redis 핑을 넣으면 UptimeRobot이 세 시나리오를 5분 안에 잡는다.
3. **④⑩은 도구가 아니라 구성의 문제다.** 인증서는 `--quiet` 제거와 만료일 체크, 결제는 웹훅 등록이 답이다.
4. **②는 프론트까지 사각이다.** 프론트 Sentry를 고치면(§7 ④) ②·⑤·⑥이 모두 프론트 쪽에서도 보이기 시작한다.

---

## 4. 알림 라우팅 원칙

> 🎓 원칙의 목적은 **알림이 오면 무엇을 할지 정해져 있게** 하는 것이다. 행동이 정해지지 않은 알림은 소음이고, 소음이 쌓이면 진짜 알림도 안 본다.

### 4-1. 심각도 3단계

| 등급 | 정의 | 행동 | 통로 |
|---|---|---|---|
| **P1 · 서비스 불가** | 사용자 전원이 핵심 흐름을 못 씀 | **지금** 확인 | **UptimeRobot 메일** → 추후 RN 푸시 |
| **P2 · 일부 고장** | 특정 기능·사용자만 실패 | **당일** 확인 | **Sentry 메일** + (복구 후) Slack `#sentry-errors` |
| **P3 · 정보** | 사용자 영향 없음 | 다음에 볼 때 | `#deployments`, `#claude-hooks`(운영 아님) |

### 4-2. 원칙 다섯

1. **채널 하나 = 등급 하나 = 보내는 주체 하나.** 새 통로를 더할 때도 기존 등급 채널에 합류시키고 채널을 늘리지 않는다.
2. **P1은 "외부에서 본 사용자 경험"만 만든다.** 내부 지표(CPU 80%, unhealthy 표시)는 P1이 아니다. 새벽에 깨울 가치가 있는 건 "지금 사용자가 못 쓴다"뿐이다.
3. **같은 원인은 한 번만.** 단, 지문을 묶어 그룹핑하면 "새 이슈일 때만" 룰과 충돌해 **엔드포인트당 평생 한 번만** 알림이 온다. 회귀·급증 조건을 함께 걸어야 한다(상세는 [블로그 글 §9](../blog/sentry-axios-silent-failure.md)).
4. **알림 본문에 다음 행동이 있어야 한다.** UptimeRobot 메일은 URL만 온다. 자체 알림을 만들 때는 확인할 런북 항목 번호를 본문에 적는다.
5. **`#deployments`는 이름이 실체보다 크다.** CI 결과만 오고 실제 배포는 오지 않는다. Vercel 알림을 이 채널에 붙이거나 이름을 `#ci`로 바꾸는 것 중 하나를 택한다.

### 4-3. 지금 이 원칙이 깨져 있는 지점

- **P2 통로가 반쪽이다.** Sentry 이메일은 살아 있지만 Slack은 끊겼다. 복구 방법은 §7 ②.
- **P1 통로가 스팸함에 있다.** 발신 주소를 안전한 보낸사람으로 등록하면 즉시 해결된다(§7 ①).
- **통로가 죽은 것을 알아채는 장치가 없다.** 이번에도 의도적으로 이슈를 만들어보기 전까지 몰랐다. **분기마다 한 번씩 각 통로에 테스트 이벤트를 흘려보는 것**을 관례로 둔다.

### 4-4. 단일 개발자와 야간

온콜 로테이션도 SLA도 없다. 그래서 **"야간에는 P1만 폰을 울리고 나머지는 아침에 본다"를 명시적 정책**으로 둔다. 정책이 없으면 모든 알림을 켜두다 결국 전부 끄게 된다. P1이 메일이므로 메일 앱의 중요 발신자 알림을 UptimeRobot에만 켠다. RN Ops Companion이 들어오면 P1은 푸시로 옮긴다.

---

## 5. 비용·쿼터 현황

| 서비스 | 플랜 | 한도 | 초과 시 | 현재 |
|---|---|---|---|---|
| **Sentry** | Developer(무료) | errors 5K/월 · replays 50/월 · spans 5M/월 · 보관 30일 · 1 user | 수집 중단 | 사용량 `확인 필요`. 결제수단 미등록이면 과금 불가 |
| **Slack** | 무료 워크스페이스 | **앱·커스텀 통합 10개**(웹훅 포함) · **채널당 초당 1건** · 메시지 90일 | — | 웹훅 2개 사용 중, 여유 있음 |
| **UptimeRobot** | Free | 모니터 50 · 5분 고정 · 메일 · 보관 3개월 · API 10 req/분 | — | 모니터 1개. **Slack·인증서 검사·1분 간격은 유료** |
| **Gemini** | 무료 티어 | **RPM 15**(실측) · explicit 캐시 storage 0 · RPD `확인 필요` | 429 → 어시스턴트 실패 | `gemini-3.1-flash-lite` |
| **AWS** | 신규 계정 크레딧 | 크레딧으로 충당 중, 월 $20~30 규모 | **크레딧 소진·만료 시 실청구 전환** | 알람 0개. 구 EC2 **아직 과금 중** |
| **Vercel** | Hobby | 비상업 무료 | — | 프론트 1개 |
| **Let's Encrypt** | — | 무료, 90일, 실패 5회/시간 | — | 만료 메일 **없음**(폐지) |
| **Cloudflare** | Registrar | 도메인 연 $12.20 | — | `ansmoon.dev` |

### 5-1. Sentry 무료 플랜의 경계선 (2026-09-16 실측)

RN 앱 계획이 여기 걸려 있어 **직접 호출해 확인했다.**

| 기능 | 무료 플랜 | 확인 방법 |
|---|---|---|
| SDK 에러 수집·그룹핑·중복제거 | ✅ | 운영에서 동작 중 |
| 이메일·앱 내 알림 | ✅ | CORS 에러 메일 수신 실적 |
| 소스맵·Release Health·Session Replay·트레이싱 | ✅ | 프론트에서 replay 전송 확인 |
| **Web API 조회** | ✅ | `GET /api/0/organizations/` **200**, `.../organizations/<slug>/issues/` **200** |
| **Slack 등 서드파티 통합** | ❌ **Team 이상** | 재연결 시도 시 "Requires Team Plan or above" |
| 알림 룰의 웹훅 동작 | `확인 필요` | 폴링으로 대체 가능하므로 막지 않음 |

> **판단: 유료 전환은 보류한다.** Team 플랜(월 $29)이 추가로 여는 것은 사실상 **Slack 연결 버튼 하나**다. 학습 가치가 있는 SDK 계측·지문 설계·API 연동은 전부 무료에서 된다. Slack 알림은 이미 Incoming Webhook 인프라가 있으므로 **백엔드가 직접 쏘면 되고**(§7 ②), 그쪽이 "SaaS를 연결했다"보다 포트폴리오에서 할 말이 많다. 재검토 조건은 **월 쿼터 5K의 절반을 넘길 때**다.

### 5-2. 돈이 나갈 수 있는 곳

무료가 아닌 것은 도메인뿐이고, **실제 리스크는 AWS 크레딧**이다. 크레딧에는 유효기간이 있어 소진·만료 시점부터 월 $20~30이 실청구로 바뀐다. 게다가 [구 EC2가 아직 종료되지 않아](./03-infra-nginx.md) 다른 계정에서 계속 과금된다. Sentry 구독을 고민하기 전에 이 둘을 먼저 정리하는 편이 금액으로 크다.

---

## 6. RN 앱(Ops Companion)이 들어올 자리

[ops-companion-design.md](./ops-companion-design.md) §1.4의 **Sentry 역할 A/B 구분**을 이 지도 위에 얹는다.

| 역할 | 무엇 | 이 지도에서의 위치 | 무료 플랜에서 되는가 |
|---|---|---|---|
| **역할 A · 소비자** | 쇼핑몰 Sentry의 이슈를 **가져와** AI 분석 재료로 쓴다 | §2 #1·#2의 **pull 소비자**가 하나 는다. 백엔드 `ops` 모듈이 API 토큰으로 조회 | ✅ **API 200 실측**. 원안 그대로 |
| **역할 B · 생산자** | RN 앱 **자신의** 크래시·AI 호출 지연을 보고 | §2에 **새 행**(앱 전용 Sentry 프로젝트) | ✅ SDK 수집은 무료의 본체 |
| **푸시 알림** | 새 인시던트 → 백엔드 → Expo 푸시 → 딥링크 | §4의 P1·P2가 메일에서 푸시로 옮겨간다 | ⚠ **웹훅 대신 폴링**으로 설계 변경 |
| **UptimeRobot API** | 다운타임 이력을 앱 요약 카드에 | 무료 API 10 req/분·3개월 보관이면 충분 | ✅ 키는 필요할 때 생성 |
| **AI 분석·평가 루프** | 인시던트 → 분석 → 사람 평가 → 프롬프트 개선 | §1 층위 ④에 **운영 중 평가 데이터**가 처음 생긴다 | ✅ |

### 6-1. 설계 변경 한 가지 — 웹훅을 폴링으로

설계 §3.3·§5.1의 `POST /v1/ops/webhooks/sentry`는 Sentry가 우리 백엔드를 호출하는 구조인데, 알림 룰의 웹훅 동작이 무료 플랜에서 되는지 불확실하다. **백엔드가 Sentry API를 1~2분마다 조회해 새 이슈를 찾는 폴링**으로 바꾸면 이 불확실성이 사라진다.

바뀌는 것은 화살표 방향뿐이고 얻는 것이 더 많다. 공개 웹훅 엔드포인트가 필요 없으니 **서명 검증 과제(§5.1의 `확인 필요`)가 통째로 사라지고**, 전 세계에 열린 엔드포인트를 하나 덜 만든다. 잃는 것은 폴링 주기만큼의 지연인데, 단일 개발자용 운영 앱에서 1~2분은 의미가 없다.

**그룹핑을 직접 만들 필요도 없다.** API가 열려 있으므로 Sentry가 이미 묶어둔 이슈를 그대로 읽으면 된다. 자체 지문 설계와 중복 제거를 구현하는 1.5~2일치 작업이 통째로 빠진다.

### 6-2. 앱이 들어오기 전에 정리할 것

**P1 감지 자체가 지금 부실하다.** 앱은 "알림을 받는 곳"이지 "감지하는 곳"이 아니다. §7의 ①~④가 먼저다. 그렇지 않으면 앱이 받을 인시던트가 백엔드 예외뿐이고, 정작 프론트 장애와 인프라 장애는 앱에도 안 뜬다.

---

## 7. 남은 과제 우선순위

> 기준: (사용자 영향) × (지금 아무도 못 봄) ÷ (비용). 전부 무료 범위 안에서 가능하다.

| 순위 | 과제 | 왜 이 순위인가 | 방법 |
|---|---|---|---|
| **①** | **UptimeRobot 메일 스팸 해제** | **5분.** 유일한 P1 통로가 스팸함에 있다. 탐지·발송은 이미 정상이라 배달만 고치면 된다 | 발신 주소를 안전한 보낸사람으로 등록. 모니터 설정의 알림 지연 옵션도 함께 확인 |
| **②** | **Slack `#sentry-errors` 복구 — 백엔드 직접 발송** | **1시간.** P2 통로가 완전히 끊겨 있다. Sentry 플랜에 다시 묶이지 않는 방식으로 되살린다 | 백엔드 예외 필터·에러 지점에서 Incoming Webhook으로 POST. 채널당 초당 1건이므로 묶음·억제 장치 포함. 무엇을 어떤 기준으로 보낼지 우리가 정한다 |
| **③** | **인증서 감시 복원** | §3 ④. 유일한 감시가 사실상 0겹. 11-13부터 30일이 골든타임 | (a) 사이드카 `--quiet` 제거 (b) cron으로 `openssl x509 -checkend` 돌려 D-20 이하면 알림 (c) [03-infra-nginx.md:236](./03-infra-nginx.md#L236)·런북 결정 15의 "LE 메일" 서술 정정 |
| **④** | **프론트 API 실패를 Sentry로** | §3 ②·§9-3. 가장 큰 사각지대. **수정 코드가 이미 준비돼 있다** | [블로그 글 §7](../blog/sentry-axios-silent-failure.md)의 리포터를 적용하고 §11의 프로브로 재측정. **코드 완료(2026-09-20)** — [report-api-error.ts](../../frontend/src/lib/axios/report-api-error.ts). 블로그 코드에 axios 에러가 아닌 것(로그아웃 중 요청 차단 `Error`) 제외를 더했다. **배포·재측정 완료(2026-09-20, 운영 `f54ba5e`)** — §11 프로브 재측정 결과 정상 0건 / API 차단 시 16건. 16건이라는 이벤트량(푸시 기준과 함께)은 Phase 1 세션이 다룬다 |
| **⑤** | **health에 DB·Redis readiness 추가** | §3 ⑤⑥⑦ 세 줄을 한 번에 UptimeRobot이 잡게 됨 | `SELECT 1` + Redis `PING`, 실패 시 503. compose healthcheck가 같은 URL이라 DB가 죽으면 backend도 unhealthy가 된다. 그게 맞는 표시다. **코드 완료(2026-09-20)** — [app.service.ts](../../backend/src/app/app.service.ts) `checkReadiness`. 각 2초 제한(ioredis 는 끊기면 에러 대신 매달린다), 503 은 예외가 아니라 상태 코드로만(Sentry 폭주 방지), `@SkipThrottle`. **배포 완료(2026-09-20, 운영 `f54ba5e`)** — health 200 + checks ok 확인 |
| **⑥** | **docker 로그 로테이션** | §3 ⑤. postgres가 루트 디스크 위라 로그 폭주 = DB 사망 | `/etc/docker/daemon.json`에 `max-size: 10m, max-file: 3` → docker 재시작. **실환경 조작이라 별도 승인 필요** |
| **⑦** | **프론트 외부 감시** | §3 ⑧. UptimeRobot 무료 50개 중 1개만 사용 중. 0원 | 모니터 추가. 키워드 모니터로 페이지 문자열까지 보면 "빈 200"도 잡힌다 |
| **⑧** | **AWS 크레딧 잔액·구 EC2 종료** | §5-2. 관측이 아니라 비용이지만 금액이 가장 크다 | Billing에서 크레딧 만료일 확인 + 구 계정 EC2 종료·EIP 릴리스 |
| **⑨** | **CloudWatch 디스크·메모리** | §3 ③⑤. 기본 지표는 이미 수집 중, 알람만 없음 | 1단계(0원): `StatusCheckFailed` 알람 → SNS 메일. 2단계: 에이전트로 디스크·메모리 커스텀 지표 2개(무료 10개 안) |
| **⑩** | **DB 백업 자동화** | 파킹 상태. 감시가 아니라 **복구** 과제 | cron 없음 확인. `pg_dump` 일 1회. 실사용자 데이터가 쌓이면 ⑤ 위로 올린다 |

**분기 점검 항목으로 추가**: 각 알림 통로에 테스트 이벤트를 흘려 **배달까지** 확인한다(§4-3).

**미검증으로 남은 것**: Redis 장애 시 동작(§9-5), 백엔드 크래시 시 Sentry 캡처(§3 ①), Vercel 배포 실패 알림(§3 ⑧), Sentry 월 사용량.

---

## 8. 파일 매핑

**인프라**
- compose healthcheck·restart·certbot 루프: [docker-compose.prod.yaml](../../docker-compose.prod.yaml)
- health·`version`: [app.controller.ts](../../backend/src/app/app.controller.ts) / [Dockerfile:61-64](../../Dockerfile#L61-L64)
- nginx: [nginx/default.conf](../../nginx/default.conf) / 절차·트러블슈팅 [런북 §10·§13](./03-infra-nginx-runbook.md)

**애플리케이션**
- Sentry 백엔드: [instrument.ts](../../backend/src/instrument.ts), [app.module.ts:99-104](../../backend/src/app/app.module.ts#L99-L104)
- Sentry 프론트: [instrumentation-client.ts](../../frontend/src/instrumentation-client.ts), [global-error.tsx](../../frontend/src/app/global-error.tsx), [next.config.js:216-230](../../frontend/next.config.js#L216-L230)
- **API 실패가 사라지는 지점**: [axios-http-client.ts:181](../../frontend/src/lib/axios/axios-http-client.ts#L181) — 분석·수정은 [블로그 글](../blog/sentry-axios-silent-failure.md)
- Slack: [ci.yml:93-120](../../.github/workflows/ci.yml#L93-L120), [notify-slack.mjs](../../.claude/notify-slack.mjs) — 연동 회고는 [ex-sentry-slack.md](./ex-sentry-slack.md)
- 예외를 삼키는 지점: [assistant.service.ts:534-537](../../backend/src/admin/assistant/assistant.service.ts#L534-L537)

**행위·보안 / AI 품질**
- [audit-log.entity.ts](../../backend/src/audit/entity/audit-log.entity.ts) / 뷰어 계획은 [ex-audit-log-admin.md](./ex-audit-log-admin.md)
- 크론: [order.service.ts:534-](../../backend/src/order/order.service.ts#L534)
- eval: [run-eval.ts](../../backend/eval/run-eval.ts), [run-judge.ts](../../backend/eval/run-judge.ts) — 서사는 [ex-ai-assistant.md §8-13~15](./ex-ai-assistant.md)

**결제(시나리오 ⑩)**
- [verifyPayment](../../backend/src/payment/payment.service.ts#L139) / [handleWebhook](../../backend/src/payment/payment.service.ts#L389)(미등록)

---

## 9. 측정 방법 (재현용)

이 문서의 수치를 어떻게 얻었는지 남긴다. 같은 측정을 반복할 수 있어야 값이 의미를 갖는다.

### 9-1. EC2 읽기 전용 조사

`ssh`로 접속해 `uptime` · `df -h` · `free -m` · `docker compose ps` · `docker inspect`(재시작 횟수·OOM) · `du -sh /var/lib/docker/containers/*/*-json.log` · `openssl x509 -noout -dates`를 읽었다. **설정 변경이나 재기동은 하지 않았다.**

### 9-2. UptimeRobot 탐지 시간

nginx 액세스 로그에서 User-Agent가 UptimeRobot인 요청을 전부 뽑아(98건, 전부 200) 체크 간격과 장애 전후 공백을 확인하고, 알림 메일의 시각·IP와 대조했다. **메일의 시각 표기는 UTC**이고 nginx 로그의 `+0000`과 초 단위로 일치한다. 메일을 KST로 읽으면 9시간 어긋나므로 주의.

### 9-3. 프론트 Sentry — 대조군 실험

`playwright-core`와 캐시된 Chromium으로 배포된 사이트를 열고, Sentry로 나가는 요청의 **envelope 본문을 파싱해** 아이템 종류(`event` / `session` / `replay_*`)를 셌다. 백엔드 다운은 `page.route('**/api/**', r => r.abort())`로 재현해 **운영 서버를 건드리지 않았다.**

| 시나리오 | Sentry로 나간 아이템 | 에러 이벤트 |
|---|---|---|
| A. uncaught 에러를 던짐 | session, **event**, replay | ✅ 도착 |
| B. `/api` 전부 차단 | session (+replay) | **0건** |
| C. 대조군, 정상 | session | 0건 |

**B와 C가 구분되지 않는다**는 것이 결론이다. 2회 반복 재현. 스크립트는 [블로그 글 §11](../blog/sentry-axios-silent-failure.md)에 있다.

### 9-4. postgres 장애

로컬 `docker-compose.local.yaml`에서 postgres만 `stop` → 호출 → `start` → 회복 관찰. **첫 시도는 무효였다.** 상품 목록이 Redis에 60초 캐시돼 DB가 죽어도 200이 나왔다. `take` 값을 매번 바꿔 캐시를 우회해 재측정했다. 이 실패 자체가 §3 ⑥의 발견이 됐다.

### 9-5. Redis 장애 — 미완

같은 방식으로 시도했으나 **Docker Redis를 멈춰도 결과가 바뀌지 않았다.** 원인은 포트 6379를 **Windows 서비스로 등록된 네이티브 `redis-server`** 가 쥐고 있었고 백엔드가 그쪽에 붙어 있었기 때문. 해당 서비스 중지는 관리자 권한이 필요해 중단했다. 재측정 절차는 `docker compose stop redis` + `Stop-Service Redis` 후 **6379가 실제로 닫혔는지 먼저 확인**하는 것이다. [redis.service.ts](../../backend/src/intrastructure/redis/redis.service.ts)에 try/catch가 없어 500이 예상되지만, 만약 200이 나오면 "Redis가 죽어도 서비스는 돌고 **보안 장치만 조용히 꺼진다**"는 뜻이라 지금 문서보다 나쁜 시나리오가 된다.

### 9-6. Sentry 무료 플랜 경계

개인 인증 토큰(`org:read`·`project:read`·`event:read`)으로 `GET /api/0/organizations/`와 `.../organizations/<slug>/issues/`를 호출해 각각 200을 확인했다. 플랜 제한이면 403이 나온다. Slack은 통합 재연결 시 "Requires Team Plan or above"로 차단됨을 확인했다.

---

## 10. 외부 근거

- Let's Encrypt 만료 메일 종료: [공지(2025-06-26)](https://letsencrypt.org/2025/06/26/expiration-notification-service-has-ended), [사전 공지(2025-01-22)](https://letsencrypt.org/2025/01/22/ending-expiration-emails)
- UptimeRobot 무료 플랜 인증서 검사 제외: [도움말](https://help.uptimerobot.com/en/articles/11358746-monitor-ssl-certificate-expiration-errors-with-uptimerobot)
- Sentry 플랜별 기능: [요금 페이지](https://sentry.io/pricing/) — Developer는 "이메일 알림", Team부터 "API 및 서드파티 통합"
- Slack 무료 워크스페이스 한도: [사용 한도](https://slack.com/help/articles/115002422943-Usage-limits-for-free-workspaces)
- CloudWatch 무료 범위: [요금 페이지](https://aws.amazon.com/cloudwatch/pricing/)
- Vercel 알림: [Notifications](https://vercel.com/docs/notifications)
