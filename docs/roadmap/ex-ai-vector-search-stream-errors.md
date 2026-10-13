# 의미 검색 채팅의 생성 오류 진단

2026-10-14 KST. 사용자가 상품 577·리뷰 1874의 조건 검증 중 첫 번째(2점 이하)와 세 번째(곰팡이 불만) 질문에서 `AI 응답 생성에 실패했습니다.`를 받았다. 기존 로그는 `ASSISTANT_STREAM_UNAVAILABLE`만 출력해 과거 두 요청의 세부 원인은 확인할 수 없다.

## 확인한 사실

- 사용자 제공 기간 질문(2026-10-01~12)은 원본 없음으로 정상 응답했다.
- 현재 사용자 DB를 읽기 전용으로 확인했다. 리뷰 1874는 상품 577, 별점 5, 버전 1이다. 상품의 전체 리뷰는 1개, 2점 이하 조건은 0개, 해당 기간 조건도 0개다. 재작성이나 재색인이 필요한 상태로 판단하지 않았다.
- 동일 앱 서비스·프롬프트·디스패처·스트림에 고정 합성 리뷰 결과를 연결해 첫 질문을 재현했다. Gemini의 첫 SDK 요청이 **HTTP 503**으로 실패했고 도구 호출은 0회였다. 이 재현에서는 DB 검색과 임베딩 요청을 시작하지 않았다.
- 재시도 보완 후 같은 질문에서 503 한 번을 기록하고 다음 요청이 성공했다. `summarize_reviews(productId=577,maxRating=2,query=...)`가 `no_data`를 반환하고 최종 답변이 완료됐다. 총 LLM 요청은 실패 요청을 포함해 3회다.
- 곰팡이 질문은 같은 합성 환경에서 LLM 요청 2회·오류 0으로 완료됐다. `ok` 후보에 팔 부분의 원문을 제공했고, 답변은 가져온 자료에서 곰팡이 불만 근거를 찾지 못했다고 설명했다.

| 재현 | 결과 | 원본 결과 |
|---|---|---|
| 보완 전 2점 이하 질문 | 503, SDK 요청 1회, 도구 0회 | [실패 기록](../../backend/eval/results/search-stream-diagnostic-2026-10-13T17-11-02-292Z.json) |
| 보완 후 같은 질문 | SDK 실패 1회 보존, 총 요청 3회, 최종 완료 | [재시도 기록](../../backend/eval/results/search-stream-diagnostic-2026-10-13T17-17-50-586Z.json) |
| 보완 후 곰팡이 질문 | SDK 요청 2회, 실패 0회, 근거 없음 안내 | [생성 기록](../../backend/eval/results/search-stream-diagnostic-2026-10-13T17-19-16-330Z.json) |

파일명의 날짜는 UTC이며 실행일은 KST 10월 14일이다. 세 실행의 SDK 호출은 총 6회다. 사용자 질문 실패를 이 세 실행으로 덮어쓰거나 같은 원인이었다고 확정하지 않는다. 합성 재현은 사용자 DB·HTTP 인증·실제 벡터 검색의 통합 검증이 아니며, 실제 화면의 두 질문은 사용자 재확인이 남아 있다.

## 보완 내용

- HTTP 상태와 알려진 transport 오류를 안전한 코드로 분류한다. 호출 한도, 인증·권한, 잘못된 요청, 시간 초과, 연결 오류, 서버 오류를 UI의 고정 메시지로 안내한다. 알 수 없는 오류는 기존 일반 메시지를 유지한다.
- SSE 프레임은 기존 `error/message` 계약을 유지한다. 로그에는 코드·HTTP 상태·대화 ID·실제 SDK 요청 수·도구 이벤트 수·경과 시간만 남긴다. SDK 오류 본문·헤더·질문·API 키는 저장하지 않는다.
- Gemini 500/502/503/504에는 **턴 전체에서 추가 SDK 요청 최대 1회**, 1초 대기를 적용한다. 해당 요청의 텍스트·도구 part가 도착했다면 재시도하지 않는다. 이미 실행한 도구를 다시 실행하는 전체 턴 재시도는 하지 않는다. 400/401/403/429도 자동 재시도하지 않는다.
- 재시도 대기는 사용자 중단에 반응하며 다음 SDK 요청을 열지 않는다. SDK 자체 재시도는 계속 1 attempt로 두고, 앱의 각 실제 호출을 `onRequest`에서 계측한다. 기존 5개 도구 라운드와 별도로 추가 호출은 최대 1회다.
- `onRequestFailure`로 복구된 실패까지 trace·진단 결과·평가 결과에 기록한다. 최종 실패 사례 수와 SDK 요청 실패 수를 구분하며, 실패한 요청의 미제공 토큰 사용량을 측정한 것으로 표시하지 않는다.

로그 예시:

```text
ASSISTANT_LLM_REQUEST_FAILED code=LLM_UNAVAILABLE httpStatus=503 conv=1 llmRequests=1
GEMINI_REQUEST_RETRY code=LLM_UNAVAILABLE httpStatus=503 round=1
```

최종 실패 시에는 `ASSISTANT_STREAM_UNAVAILABLE code=... httpStatus=...`와 요청·도구 수가 출력된다. 재발하면 이 줄로 실패 종류와 도구 실행 전후를 확인할 수 있다.

## 검증과 재현

오류 분류·비밀 정보 제외·실패 관측·재시도 성공/상한·부분 응답과 도구 재실행 방지·취소·턴 전체 재시도 예산을 검증했다. 관련 단위 66개, 백엔드 전체 **691/691**·51개 파일, 실제 인증 HTTP/SSE+격리 PostgreSQL **8/8**이 통과했다. 타입 검사·lint·개발 빌드도 통과했다. 빌드의 기존 Nx root lockfile fallback 메시지는 유지된다.

[단위 원본 결과](../../backend/eval/results/search-stream-failure-unit-2026-10-14.json)와 [검증 요약](../../backend/eval/results/search-stream-failure-verification-2026-10-14.json)을 보존했다.

프로젝트 루트 PowerShell에서 실행한다.

```powershell
yarn nx run '@shopping-mall/backend:test' --runInBand
yarn nx run '@shopping-mall/backend:search:chat:verify'
yarn nx run-many -t typecheck search:typecheck -p '@shopping-mall/backend'
yarn nx run '@shopping-mall/backend:lint' --quiet
yarn nx run '@shopping-mall/backend:build:development'
```

진단 CLI는 기본 실행에서 API를 호출하지 않는다. `--live`와 한 문항 선택을 함께 명시해야 실제 Gemini를 호출한다. 사용자 DB·임베딩 API에는 접근하지 않으며 고정 합성 결과만 사용한다. 모델 재시도 예산은 턴당 1회다. 아래 추가 진단 이후 요청의 SDK 대기 기본값은 60초, 턴의 누적 SDK 대기는 180초, 진단 전체 중단 신호는 턴 설정값 + 15초(기본 195초)다.

```powershell
yarn nx run '@shopping-mall/backend:search:stream:diagnose'
# 실제 모델 요청이 필요한 경우 한 문항만 선택한다.
yarn nx run '@shopping-mall/backend:search:stream:diagnose' --live --case=rating
yarn nx run '@shopping-mall/backend:search:stream:diagnose' --live --case=mold
```

현재는 기존 리뷰와 설정을 유지하고 백엔드를 재시작한 뒤, 새 대화에서 실패했던 두 질문을 다시 확인한다. 생성 실패가 지속되면 위 안전한 로그의 코드·HTTP 상태를 확인한다. 전체 과거 리뷰 색인, 모델 변경, 최종 답변 30개 재평가는 이 진단에서 실행하지 않았다.

## 02:37~02:40 사용자 로그의 추가 진단

첫 질문의 대화 66은 `summarize_reviews` 이벤트 뒤 두 번째 SDK 요청이 503, 재시도가 약 31초 뒤 `LLM_NETWORK_ERROR`로 끝났다. 곰팡이 질문의 대화 67은 첫 SDK 요청이 503, 재시도가 약 31초 뒤 같은 오류로 끝났으며 도구 이벤트는 0회였다. 이 로그로 리뷰 필터의 잘못된 결과를 확인할 수는 없다. 특히 `toolCalls=1`은 실행 직전 이벤트 수이며 검색 완료를 증명하지 않는다.

설치된 `@google/genai` 2.8.0에서 기존 `httpOptions.timeout=30000`이 만료되면 상태 없는 `AbortError`가 발생한다. 실제 SDK와 모의 fetch로 이를 재현했다. 기존 분류는 이 오류를 연결 끊김으로 표시했다. 사용자 로그의 약 31초 패턴은 이 제한과 일치하지만 과거 요청의 정확한 네트워크 상태를 소급 확정하지 않는다.

보완 사항:

- SDK 내부 시간 제한 대신 앱이 스트림 생성과 각 `next()` 대기를 직접 제한한다. 제한 만료는 `LlmTimeoutError`로 구분하며, SDK가 abort를 무시해도 기다림은 끝난다. 사용자 중지의 `AbortError`와 실제 transport 오류는 별도로 처리한다.
- 기본 요청 대기는 60초, 한 턴의 SDK 대기 합계는 180초다. 스트림 소비·도구 실행·재시도 대기 시간은 합계에 포함하지 않으므로 전체 HTTP 응답 시간을 180초로 보장하지 않는다. 선택적 explicit cache 생성에도 제한과 취소를 적용한다.
- `backend/.env.example`에 `GEMINI_REQUEST_TIMEOUT_MS=60000`, `GEMINI_TURN_TIMEOUT_MS=180000`을 추가했다. 실제 `.env`에 없으면 이 기본값을 사용한다. 요청은 정수 1~120000, 턴은 정수 1~300000만 허용한다. 실제 사용자 `.env`는 변경하지 않았다.
- 실패 로그에 `timeoutScope=request|turn`, `timeoutMs`, `sdkWaitMs`를 추가한다. 전체 경과 시간 `elapsedMs`와 SDK 대기 시간을 구분한다. 공급자 오류 본문이나 API 키는 로그에 넣지 않는다.
- 실패한 스트림은 재시도 대기 전에 닫는다. 늦게 생성된 스트림도 정리하고, 끝나지 않는 `iterator.return()` 때문에 오류 전달을 기다리지 않는다. 이미 실행한 도구나 부분 답변을 재시도로 중복 처리하지 않는다.
- 설치된 Next rewrite 프록시의 기본 upstream 무응답 제한은 30초다. `/api` 경로에서 긴 SDK 대기 중 먼저 끊길 수 있으므로 SSE에서 15초마다 `: keep-alive` 주석을 보낸다. 프론트 파서는 기존대로 주석을 무시한다. 완료·오류·중지·소켓 종료 시 타이머와 리스너를 제거하고 종료된 응답에 쓰지 않는다. 외부 호스팅의 절대 실행 시간 제한까지 제거하는 조치는 아니다.
- 오류 뒤 접근성 `role=status`에 남던 “리뷰 조회 중 / 응답 생성 중”을 비운다. 오류는 `role=alert`로 알리며 부분 답변을 “응답 완료”로 읽거나 이전 완료 알림을 새 대화에 전달하지 않는다.

새 시간 초과 로그 예시:

```text
ASSISTANT_LLM_REQUEST_FAILED code=LLM_TIMEOUT httpStatus=none conv=1 llmRequests=1 timeoutScope=request timeoutMs=60000 sdkWaitMs=60005
ASSISTANT_STREAM_UNAVAILABLE code=LLM_TIMEOUT httpStatus=none conv=1 llmRequests=1 toolCalls=0 elapsedMs=60012 timeoutScope=request timeoutMs=60000 sdkWaitMs=60005
```

추가 실제 모델 진단: [2점 이하 합성 질문](../../backend/eval/results/search-stream-diagnostic-2026-10-13T17-55-49-593Z.json)은 SDK 요청 1회, 도구 0회로 **60초 시간 초과**가 발생했다. 정확한 시간 초과 분류·종료를 확인했지만 모델 응답이 정상화됐다는 근거는 아니다. 사용자 DB와 임베딩을 호출하지 않았으며 이전 성공·503 기록을 대체하지 않는다.

추가 검증은 요청·턴 제한, 503 뒤 시간 초과, 부분 답변/완료 도구 재실행 방지, 늦은 스트림·캐시 정리, SDK가 abort를 무시하는 취소, heartbeat·접근성 상태 정리를 포함한다. 관련 SDK 단위 **92/92**·3개 파일, 기존 중단 테스트를 포함한 백엔드 전체 **746/746**·52개 파일, 프론트 관련 **48/48**·4개 파일, 인증 HTTP/SSE+격리 PostgreSQL **9/9**가 통과했다. 백엔드·프론트 타입 검사와 lint, 검색 평가 타입 검사, 백엔드 개발 빌드도 통과했다. 빌드의 기존 Nx root lockfile fallback 메시지는 유지된다.

[검증 요약](../../backend/eval/results/search-stream-timeout-verification-2026-10-14.json), [백엔드 단위 원본](../../backend/eval/results/search-stream-timeout-unit-2026-10-14.json), [프론트 단위 원본](../../backend/eval/results/search-stream-timeout-ui-2026-10-14.json)을 보존했다. 자동 테스트 통과를 실제 모델 응답 또는 두 사용자 질문의 통과로 표시하지 않는다.

현재 코드를 반영하려면 실행 중인 백엔드를 종료하고 루트 터미널에서 `yarn nx run '@shopping-mall/backend:serve'`로 다시 실행한다. 프론트도 새로고침하고 새 대화에서 기존 두 질문을 확인한다. 리뷰 재작성·재색인은 필요하지 않다. `LLM_UNAVAILABLE httpStatus=503` 또는 `LLM_TIMEOUT`이 계속되면 실모델 기반 질문 검증은 미완료로 유지한다.

## 후속 사용자 화면 결과

2026-10-14 후속 메시지에서 두 질문 모두 최종 응답이 도착했다. 곰팡이 질문은 가져온 자료에 근거가 없다고 설명하며 #1874의 팔 부분 내용을 곰팡이 불만으로 사용하지 않았다. 2점 이하 질문은 원본 없음으로 답했다. 이번 두 시도의 응답 복구를 확인한 것이며 이전 503·60초 시간 초과 기록이나 공급자 가용성 이력을 변경하지 않는다.

2점 이하 답변에 질문이 요청하지 않은 “최근 1개월(2026-09-14~2026-10-14)”이 추가됐다. 서버의 의미 검색에는 기본 1개월 제한이 없고 실제 도구 인자는 제공되지 않았다. 날짜를 실제 조회에 적용했는지 답변에서만 덧붙였는지 확정하지 않고, [화면 검증 절차](./ex-ai-vector-search-phase3-manual-test.md)에 기간 제한 없는 질문을 추가했다. [사용자 결과 원본](../../backend/eval/results/search-manual-stream-recovery-2026-10-14.json)에 응답 복구와 범위 품질 보류를 따로 기록했다.

최신 사용자 보고에서는 명시적으로 전체 기간을 요청한 질문에 “기간: 제한 없음”으로 답했고, 색인 대기 후 최신 긍정 본문 인용과 삭제 제외도 확인됐다. 사용자는 전체 수동 시나리오의 완료를 명시했다. [완료 기록](../../backend/eval/results/search-manual-phase3-completion-2026-10-14.json)을 별도로 보존한다. 앞선 임의 기간 답변·503·60초 시간 초과 이력과 최종 30문항 사람 검토 미완료 상태는 유지한다.
