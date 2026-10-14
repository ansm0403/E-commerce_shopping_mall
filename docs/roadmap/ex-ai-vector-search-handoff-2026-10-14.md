# AI 검색 구현·포트폴리오 준비 인수인계

2026-10-14 KST. 사용자가 다른 세션에서 작업을 이어가기로 하여 현재 작업 상태를 기록한다. 기능 확장보다 최종 평가·자동 시연·포트폴리오 설명을 먼저 마무리하는 것이 현재 합의한 방향이다.

## 1. Git 상태와 작업 범위

- 저장소: `C:\Users\kiria\Desktop\fullstack\shopping_mall`
- 현재 브랜치: `feat/admin-ai-vector-search`
- 마지막 커밋: `742d8bc` — `feat(assistant): 관리자 리뷰·공개 문의 의미 검색 구현`
- 해당 커밋은 origin에 푸시했고 [PR #70](https://github.com/ansm0403/E-commerce_shopping_mall/pull/70)을 생성했다. PR의 현재 병합·CI 상태는 새 세션에서 다시 확인해야 한다.
- **그 이후의 포트폴리오 준비·답변 규칙 보완·새 평가 도구와 결과는 아직 커밋·푸시하지 않았다.** 수정 파일과 untracked 파일이 실제 작업 결과이므로 삭제·reset하지 않는다.
- 기존 `.yarn/install-state.gz` 변경과 `docs/roadmap/ex-demo-order-review-inquiry.md`, `docs/roadmap/ex-role-demo-accounts.md` 두 untracked 문서는 이번 후속 작업 전에 이미 있었다. 후속 작업 커밋과 구분하고 그대로 보존한다.

모든 테스트·빌드·평가는 Nx 타깃으로 실행한다. 기존 세션에서는 Nx MCP가 제공되지 않아 Nx CLI를 사용했다. 새 세션에서는 도구 유무와 root `AGENTS.md`를 먼저 확인한다.

## 2. 이미 구현·검증한 기능

설계의 **1~4단계 구현 완료**:

1. PostgreSQL 18·pgvector, Gemini 768차원 임베딩, 프로필·마이그레이션.
2. 리뷰 작성·수정의 트랜잭션 색인 작업 등록, 버전·점유 검증, 재시도·대조·CLI, 자동 워커.
3. 리뷰 의미 검색과 관리자 채팅 연결, 현재 상품·카테고리·별점·기간 조건, 반환 직전 원문 재검사와 마스킹한 인용.
4. 공개 문의의 제목·본문·판매자 답변 색인과 검색, 현재 문의 상태·기간 조건, 비밀 문의 제외, 일반·체험·시드 저장 경로.

Gemini의 503·네트워크·시간 초과 분류, 요청/턴 대기 예산, 제한된 재시도, SSE 연결 유지와 사용자 중단 처리도 구현했다. Windows/Node의 `__dirname` 오류를 해결하도록 백엔드 Jest 설정을 `.cjs`로 전환했다.

사용자는 리뷰 화면 검증과 문의 수동 검증 1~6번을 완료했다고 보고했다. 문의에서는 상품 253의 **문의 #148**을 사용했으며, 상품 ID와 문의 ID를 혼동하지 않는다. #148은 답변 완료 상태이므로 구매자 삭제 시연에는 별도의 미답변 문의가 필요하다. 상품 271에서는 미답변 문의 삭제 후 근거 없음 응답을 공유했다. 이전 리뷰 #1874는 삭제 검증에 사용했으므로 현재도 존재한다고 가정하지 않는다.

**5단계 배송 정형 조회(`query_data`)와 6단계 집계·결합 분석(`aggregate_data`)은 아직 구현하지 않았다.** 포트폴리오 마무리 전 우선 구현할 기능으로 합의한 상태가 아니다.

## 3. 이번 후속 작업에서 준비한 것

### 리뷰 사람 검토

기존 최종 v2 30문항 답변은 재생성하지 않고 실제 도구 인자·원문·답변·모델 보조 판정을 대조했다. 에이전트 의견과 사람 판정은 구분하며 **사람 판정 30개는 모두 미완료**다.

- 원본 답변: `backend/eval/results/search-assistant-final-2026-10-13T11-07-46-261Z.json`
- 기존 보조 판정: `backend/eval/results/search-answer-judge-2026-10-13T11-17-44-591Z.json`
- 에이전트 의견: `backend/eval/results/search-review-agent-notes-2026-10-14.json`
- [검토 HTML](../../backend/eval/results/search-answer-review-search-assistant-final-2026-10-13T11-07-46-261Z.html)

HTML을 브라우저로 열어 검토자 이름과 각 문항의 다섯 기준을 판정하고 JSON을 저장할 수 있다. 원문 보고서 SHA256, 중복·누락 ID, 검토자·시각, 부분 실행, 미검토, 실행 실패를 검사하는 `search:answer:review` 타깃도 추가했다. 미완료 상태에서는 확정 성공률을 null로 둔다. HTML QA의 가상 판정은 실제 사람 판정 파일에 저장하지 않았다.

특히 13번 `final-v2-5-meaning`은 높은 별점의 동일한 불만을 참고로 처리한 해석, 25번 `final-v2-9-meaning`은 원문에 없는 작성 의도 추가를 확인한다. 기존 judge가 원문 존재 여부를 잘못 읽거나 판정 값과 이유를 모순되게 작성한 사례도 표시했다.

### 문의 평가 v1과 독립 최종 v2

v1은 합성 문의 **90건(공개 70·비밀 20), 질문 30개(근거 있음 20·없음 10)**다. 실제 Gemini 실행이 429로 중단됐다.

| 항목 | 관측 |
|---|---|
| 계획 / 시도 / 답변 완료 | 30 / 25 / 22 |
| 실제 미복구 실패 / 미실행 | 429 실패 3 / 미실행 5 |
| LLM SDK 요청 / SDK 실패 | 50 / 3 |
| 실제 임베딩 요청 | 73: 문서 51·질문 22 |
| 문서 캐시 조회 | 19 |
| 확인한 비밀·원문 연락처 노출 및 보호된 입력 전송 | 0 |

- 최초 원본: `search-inquiry-answer-final-2026-10-13T22-15-51-092Z.json`
- 외부 호출 없는 측정 대조: `search-inquiry-answer-audited-search-inquiry-answer-final-2026-10-13T22-15-51-092Z.json`
- 에이전트 의견: `search-inquiry-agent-notes-2026-10-14.json`
- [v1 부분 검토 HTML](../../backend/eval/results/search-answer-review-search-inquiry-answer-audited-search-inquiry-answer-final-2026-10-13T22-15-51-092Z.html)

위 파일은 모두 `backend/eval/results` 아래에 있다. 최초 평가기는 날짜 뒤 쉼표가 붙어 거절된 뒤 올바른 인자로 복구한 3문항도 터미널 실패로 집계했다. 대조 파일은 **최초 원본·도구 시도·수정 전 코드·SHA256을 보존**하고 복구한 도구 인자 오류 3건과 실제 API 실패 3건을 구분한다. 원본 JSON은 덮어쓰지 않는다.

v1에서 다음 문제가 관측돼 `backend/src/admin/assistant/assistant.service.ts`의 규칙을 보완했다.

- 본문이 비어 있다는 이유로 실제 판매자 답변까지 제외.
- 제목만 있는 문의를 본문에 적힌 내용이라고 설명.
- 사용자에게 `hasContent=false` 같은 내부 필드명 노출.
- 원문에 없는 작성 의도 추가.

보완 후 실제 모델 효과는 아직 검증하지 않았다. **v1은 개선 자료로 전환했으며 최종 평가 자료로 재사용하지 않는다.** 새로운 상품·문의 ID·주제의 독립 `inquiries-answer-final-v2` 30문항을 준비했고, 미답변 질문이 실제로 없는 판매자 안내까지 함께 요구하던 모호함도 해소했다.

- v1: `backend/eval/search/inquiry-final-fixture.ts`
- v2: `backend/eval/search/inquiry-final-fixture-v2.ts`
- v2 SHA256: `b2d7256ca0ddae7116b9a382f829e9babede30df01481fe5c633a95c177ea5ef`
- **v2는 dry-run만 확인했고 실제 실행은 0개**다.
- 실행 전 기준: Hit@5 95%·Recall@5 90%, 근거 있음/없음 답변 각 90%, 비밀·원문 연락처 노출 0건. 에이전트 관측과 사람 판정을 성공률로 혼합하지 않는다.

### 실제 자동 워커

[워커 결과](../../backend/eval/results/search-worker-demo-2026-10-13T22-17-46-785Z.json): **9/9 통과**.

실제 Nest `ScheduleModule`의 `@Interval(1000)`과 운영 스케줄러·저장소·처리기, 실제 임베딩을 사용했다. 합성 리뷰 1개·문의 3개에서 임베딩 6회(문서 4·질문 2), LLM 요청 0회다. 수동 work CLI 없이 색인 대기, 리뷰·문의 큐 처리, 답변 버전 갱신, 비밀 문의 제외와 삭제를 확인했다. 사용자 DB와 `.env`를 변경하지 않았다.

**격리 SQL 시연이지 구매자·셀러·관리자의 실제 화면 자동 반영 확인이나 영상 촬영은 아니다.** 소수 큐 처리 시간을 운영 P50/P95로 표현하지 않는다.

### 문서와 현재 검증

- [전체 후속 기록·사람 검토 방법](./ex-ai-vector-search-portfolio-ready.md)
- [포트폴리오 설명·이력서 문장 초안](../portfolio/admin-ai-semantic-search.md)
- [실제 화면 자동 반영·영상 시연 절차](./ex-ai-vector-search-portfolio-demo.md)
- [검증 요약](../../backend/eval/results/search-portfolio-preparation-2026-10-14.json)
- [단위 원본](../../backend/eval/results/search-portfolio-unit-2026-10-14.json)

후속 변경 기준 백엔드 **840/840, 56개 스위트**, 관리자 HTTP/SSE **15/15**, 백엔드·평가 타입 검사, lint, 개발 빌드 통과. 검토 HTML 두 개의 이동·판정·JSON 저장·실행 실패 통과 차단을 jsdom으로 확인했다. 기존 Nx lockfile fallback과 Node 경고는 남아 있으며 빌드 exit code는 0이었다.

이전 4단계 전체 PostgreSQL·HTTP/SSE 192/192 기록도 보존했다. 이를 이번 후속 작업에서 192개 전부 새로 실행했다고 표현하지 않는다.

## 4. 새 세션에서 이어갈 순서

1. 이 문서와 `git status`를 읽어 미커밋 작업을 보존한다. PR #70의 현재 상태와 브랜치 기준을 확인한다.
2. **Gemini 429의 제한 종류 확인**: 현재 프로젝트의 RPM/TPM/RPD 중 어느 한도가 걸렸는지 사용자에게 물었으나 답을 받지 않았다. [AI Studio 한도](https://aistudio.google.com/rate-limit?timeRange=last-28-days)에서 확인한다. 429만으로 일일 한도라고 단정하지 않으며 결제나 모델을 임의 변경하지 않는다.
3. 한도 회복 전에는 실제 모델 반복 호출을 피하고 리뷰 30문항의 사람 검토를 진행한다. 에이전트 의견을 사람 판정으로 바꾸지 않는다. 기존 리뷰 결과는 측정 당시 코드에 대한 기록이며 이후 보완된 프롬프트의 정확도를 대신하지 않는다.
4. 한도 회복 후 **독립 문의 v2 30문항**을 실행하고 실제 원문·도구·답변 검토 화면을 생성한다. v1의 실패·부분 재검증이나 v2 부분 실행들을 단일 30/30 성공 실행으로 합치지 않는다.
5. 실제 화면에서 별도 문의 D 작성 → 자동 버전 1 완료 → 검색 → 셀러 답변 → 자동 버전 2 완료 → 답변 인용을 확인한다. 삭제는 별도 미답변 E로 확인한다. 이때 수동 `search:inquiry:work`는 실행하지 않는다.
6. 원문 대조 결과와 시연 영상을 설명 초안에 반영한다. 확정 답변 성공률·공개 통과는 해당 조건을 실제 충족한 뒤 기록한다.
7. 후속 변경을 검토하고 커밋·푸시/PR 갱신을 진행한다. 현재 새 작업은 미커밋 상태다.

전 고객 자료의 초기 색인·실패 작업 해소는 **공개 준비**의 별도 작업이다. 포트폴리오 평가를 위해 고객 DB를 일괄 색인하지 않는다. 5단계 배송과 6단계 집계 기능은 위 마무리 후 사용자가 확장을 선택하면 착수한다.

## 5. 환경과 명령

이번 인수인계 시점에 확인한 비밀값 없는 `.env` 설정은 다음과 같다. 설정을 수정한 이후 백엔드가 재시작됐는지는 확인하지 않았다.

```dotenv
GEMINI_MODEL=gemini-3.1-flash-lite
AI_SEARCH_REVIEW_INDEX_ENABLED=true
AI_SEARCH_INQUIRY_INDEX_ENABLED=true
AI_SEARCH_INQUIRIES_ENABLED=true
AI_SEARCH_WORKER_ENABLED=true
AI_SEARCH_REVIEWS_ENABLED=false
```

리뷰 검색은 꺼져 있지만 리뷰 작업 생성은 켜져 있으므로 실행 중인 워커는 리뷰·문의 작업을 모두 처리할 수 있다. API 키·DB 비밀번호 등은 읽어 출력하거나 커밋하지 않는다.

평가 DB는 `127.0.0.1:15433`, `shopping_mall_search_probe`이고 `createEvalDatabase()`가 임의 이름의 격리 스키마를 만들고 끝나면 제거한다. Docker 컨테이너는 이 세션에서 healthy였다. 새 세션에서 다시 확인하며 평가 때문에 사용자 DB 연결을 바꾸지 않는다.

프로젝트 루트 PowerShell에서 실행한다.

```powershell
# 평가 DB 준비. 실제 고객 DB의 초기 색인 명령이 아니다.
yarn nx run '@shopping-mall/backend:search:db:up'

# 기본값은 final-v2의 dry-run: DB·API 요청 없음.
yarn nx run '@shopping-mall/backend:search:inquiry:answer:eval'

# 한도 회복 후 독립 최종 v2 실행.
yarn nx run '@shopping-mall/backend:search:inquiry:answer:eval' --live

# 새 실행 결과 경로로 치환해 검토 화면 생성. 경로는 backend 기준.
yarn nx run '@shopping-mall/backend:search:answer:review' --report=eval/results/새로운-문의-결과.json

# 리뷰 HTML에서 내려받은 실제 사람 판정 JSON을 results에 복사한 뒤 검증.
yarn nx run '@shopping-mall/backend:search:answer:review' --report=eval/results/search-assistant-final-2026-10-13T11-07-46-261Z.json --review=eval/results/human-review-search-assistant-final-2026-10-13T11-07-46-261Z.json

# 자동 워커 시연은 이미 9/9 확인했으므로 변경이나 실패가 있을 때 재실행.
yarn nx run '@shopping-mall/backend:search:worker:demo'
yarn nx run '@shopping-mall/backend:search:worker:demo' --live

# 코드 변경 후 관련 검사.
yarn nx run-many -t typecheck search:typecheck -p '@shopping-mall/backend' --parallel=1
yarn nx run '@shopping-mall/backend:test' --runInBand
yarn nx run '@shopping-mall/backend:search:chat:verify'
yarn nx run '@shopping-mall/backend:lint' --quiet
yarn nx run '@shopping-mall/backend:build' --configuration=development
```

`--fixture=final-v1`은 개선 자료용이며 기본 최종 평가는 v2다. `--only=문항ID,...`는 별도 부분 실행으로 기록한다. 새 평가기는 복구한 인자 오류를 기록하고, 세 번의 연속 터미널 실패에서 중단하며 전체 실행·사람 검토 전 성공률은 null로 유지한다.

백엔드 재시작은 기존 서버 터미널의 `Ctrl+C` 후 `yarn nx run '@shopping-mall/backend:serve'`로 한다. 기존 4000 포트를 사용 중인 서버가 있는데 두 번째 서버를 추가로 실행하지 않는다.
