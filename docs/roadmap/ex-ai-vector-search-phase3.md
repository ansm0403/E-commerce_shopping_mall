# 관리자 AI 검색 3단계: 리뷰 의미 검색·채팅 연결

2026-10-13 KST. [설계](./ex-ai-vector-search.md) 3단계의 구현·검색 평가·재현 절차다. 문의 의미 검색과 정형 배송 조회는 후속 단계다.

후속 [3단계 엣지케이스 검증](./ex-ai-vector-search-phase3-edgecases.md)에서 27개 회귀 사례를 추가하고 취소·손상된 인용·검색 중 버전 교체의 결함 6유형을 수정했다. 최종 백엔드 단위 656개·DB/HTTP 통합 98개가 통과했다. 아래 자동 검증 수치는 최초 구현 시점의 기록이다.

2026-10-14 [사용자 화면의 생성 오류 진단](./ex-ai-vector-search-stream-errors.md)에서 실제 Gemini 503을 재현하고, 부분 응답 전 5xx의 턴당 1회 재시도·안전한 오류 분류·복구된 SDK 실패 관측을 추가했다. 백엔드 단위 691개·인증 HTTP/SSE 통합 8개가 통과했으며 첫 번째·세 번째 질문은 사용자 화면 재확인이 남아 있다.

2026-10-14 후속 보완에서 요청/턴 SDK 대기 제한·SSE heartbeat·오류 뒤 진행 알림 정리를 적용했다. 해당 시점 백엔드 단위 746개·프론트 관련 48개·인증 HTTP/SSE 통합 9개가 통과했다. 이후 사용자는 [3단계 화면 검증](./ex-ai-vector-search-phase3-manual-test.md)의 모든 수동 시나리오를 완료했다고 보고했으며, 명시적 기간 제한 없음·색인 대기 후 수정 원문 인용·삭제 제외 결과를 제공했다. [사용자 완료 기록](../../backend/eval/results/search-manual-phase3-completion-2026-10-14.json)을 보존한다. 최종 답변 30개 사람 검토·전체 초기 색인 등 공개 조건은 별도 남아 있다. 다음 구현은 설계 4단계 공개 문의 확장이다.

## 구현 범위

`SemanticSearchService`는 조건에 맞는 현재 리뷰에서 정확한 코사인 거리(`<=>`) 상위 10청크를 찾는다. 완료 작업·현재 프로필·원본 버전·청크 해시·건전성을 SQL에서 검사하고, 반환 직전 별도 읽기 스냅샷에서 원본 본문과 현재 조건을 다시 대조한다. 수정·삭제·평점·상품의 카테고리 변경으로 무효화된 후보를 제외한다. 마지막 DB 확인 이후 답변 생성 중의 변경까지 고정하지 않는다.

상품·카테고리 하위 범위·명시한 별점·KST 날짜 조건을 적용한다. 빈 상품 ID 범위를 전체로 확대하지 않는다. KST 종료일은 다음 날 자정 미만으로 계산해 마이크로초도 포함한다. 원본 ID를 중복 제거하고 기본 5·최대 10개 원본, 원본당 최대 2개 인용과 12,000 Unicode 코드 포인트 문맥 제한을 적용한다. 거리·벡터는 LLM 결과에 포함하지 않는다.

`summarize_reviews`에 선택적 `query`를 추가했다. query가 없으면 기존 최근순 조건 조회(기본 30·최대 50)를 유지한다. query가 있으면 의미 검색을 사용하며, 불만이라는 이유만으로 2점 이하를 강제하지 않는다. query는 trim 후 비어 있지 않은 최대 1,000 코드 포인트다. 검색 공개 플래그가 false이면 모델 스키마에서도 query를 숨기고 직접 요청은 `unsupported`로 차단한다.

결과는 `status/mode/scope/data/coverage/error` 계약이다. 원본 없음, 청크 없음, 미반영, 실패를 구분한다. coverage는 같은 스냅샷의 원본 수·준비·대기(작업 누락 포함)·실패와 partial을 제공한다. 일부 후보만 준비됐다면 답변에도 그 범위를 밝힌다. 준비된 상위 후보 수로 전체 불만 건수나 비율을 계산하지 않는다.

서버 인증 사용자·역할·요청 ID·중단 신호를 디스패처와 검색기에 전달한다. 비스트리밍 chat도 같은 도구 경로를 사용한다. 모델이 만든 actorId/roles/SQL 등 미등록 인자는 거절한다. 기존 6개 도구는 공통 Zod 정의로 JSON Schema를 생성하고 실행 시 다시 검사한다. 날짜의 실제 존재·순서, ID·take·enum·미등록 키를 검사한다. 감사 로그 action은 실제 `AuditAction` enum을 사용한다.

질문·최근 대화·도구 결과·평가 추적의 이메일과 전화번호를 외부 전송 전에 마스킹한다. 기존 대화 UI용 사용자 원문 저장은 유지한다. SDK 오류 본문을 결과나 로그에 남기지 않고 안전한 코드로 분류한다. 연결 중단은 질문 임베딩과 전용 PostgreSQL 연결의 진행 중 조회에 전파하며, 다음 도구·LLM 요청을 열지 않는다. 기존 SSE meta/tool/text/done 이벤트를 유지한다. 출처 링크나 별도 출처 UI 이벤트는 추가하지 않았다.

## 자동 검증

검색 PostgreSQL 검증 17개, 인증 HTTP/SSE + PostgreSQL 연결 검증 6개가 통과했다. 검색 검증에는 정확한 순위·동률·원본 중복 제거, 고평점 불만, 상품/카테고리/기간, KST 마지막 마이크로초, coverage 상태, 이전 버전, 반환 직전 삭제·본문/평점/카테고리 변경, 직접 SQL 변경, 0벡터, 프로필 불일치와 키 미설정 구분, 마스킹 후 길이 초과·미해석 카테고리 조건 거절, 연락처, 오류와 실제 진행 중 DB 조회 취소가 포함된다.

HTTP/SSE 검증은 실제 Nest HTTP 서버를 임의 포트로 열고 실제 가드로 401/403·위조 권한 필드를 확인한다. LLM/임베딩은 mock이고 검색은 실제 PostgreSQL이다. 비스트리밍 인증 컨텍스트, 마스킹한 질문/이력과 인용, 기존 SSE 프레임, 명시적 취소·비스트리밍 소켓 중단·indexing/unsupported 안내를 확인했다.

기존 기반 DB 7개·색인 DB 49개도 재실행해 통과했다. 통합 테스트의 합계는 **79개**이며 사용자 DB와 분리된 probe DB의 임의 스키마를 만들고 종료 시 삭제한다. 백엔드 전체 단위 테스트 **648/648**, 프론트 어시스턴트 API/SSE 단위 **23/23**, 타입 검사·lint·개발 빌드도 통과했다. lint의 기존 경고, 빌드의 기존 Nx lockfile 축소 오류 메시지와 루트 lockfile fallback은 남아 있다.

타입 검사에는 공용 타입을 먼저 빌드하는 `dependsOn: ["^build"]`를 추가했다. 공용 산출물이 복구되는 중 타입 검사를 별도 프로세스로 실행했을 때 발생한 TS6305를 선행 빌드 후 재검증했다. 태스크 의존성은 [Nx 공식 규격](https://nx.dev/docs/kb/defining-task-pipeline)을 따른다.

## 검색 측정

모델은 `gemini-embedding-2`, 768차원, 초기 프로필 v1이다. 개선용/최종 각각 합성 리뷰 100건·청크 100개, 실제 고객 원문 0건으로 측정했다. 두 자료는 원본 ID·상품·주제·질문을 공유하지 않는다. 비교 A는 같은 조건의 최근순 원본 5개, B는 첫 벡터 검색의 10청크 후보에서 중복 제거한 최대 5개다. 검색 설정을 개선한 C는 만들지 않았다.

| 자료 | 방식 | 근거 있음 분모 | Hit@5 | Recall@5 | Precision@5 |
|---|---|---:|---:|---:|---:|
| 개선용 20문항 | A 최근순 | 20 | 0% | 0% | 0% |
| 개선용 20문항 | B 의미 검색 | 20 | 100% | 100% | 20% |
| 최초 분리 평가 v1 30문항 | A 최근순 | 20 | 50% | 50% | 10% |
| 최초 분리 평가 v1 30문항 | B 의미 검색 | 20 | 100% | 100% | 30% |
| 최종 v2 30문항 | A 최근순 | 20 | 50% | 50% | 10% |
| 최종 v2 30문항 | B 의미 검색 | 20 | 100% | 100% | 30% |

근거 없음 10문항은 Hit·Recall·Precision 분모에서 제외한다. v1에서는 별점 필터 때문에 최근순 기준선도 관련 리뷰를 포함하는 10문항이 있다. 의미 검색의 정답 원문은 무필터 문항당 2개, 별점 조건 문항당 1개여서 Precision@5 평균 상한은 30%다. 유사도에 임계값을 붙이지 않으므로 근거 없는 문항에도 후보는 반환한다. 답변 모델이 인용을 읽고 근거 없음을 판단해야 한다.

첫 실제 개선용 검색 [결과](../../backend/eval/results/search-retrieval-improvement-2026-10-13T10-14-30-346Z.json)는 외부 임베딩 요청 42회(동일 합성 입력 문서 22종 + 질문 20개), 최종 검색 [결과](../../backend/eval/results/search-retrieval-final-2026-10-13T10-22-50-294Z.json)는 60회(문서 30종 + 질문 30개)였다. 임베딩 API의 토큰 값은 제공되지 않아 null이다. 실패한 최초 네트워크 실행도 [별도 결과](../../backend/eval/results/search-retrieval-improvement-2026-10-13T10-09-52-012Z.json)에 남겼다.

평가에서만 동일한 고정 합성 입력의 실제 벡터를 `tmp/search-eval`에 캐시한다. 실제 색인은 서로 다른 원본의 벡터를 이런 방식으로 재사용하지 않는다. 캐시 조회 시간을 실제 API 시간처럼 보고하지 않는다. 각 검색 결과의 DB 시간, 원래 질문 벡터 준비 시각·시간, 현재 요청의 실제 임베딩 호출량을 나누어 보존한다. 원래 API 준비 시간에는 RPM 대기가 포함된다. 이 결과는 합성 자료·단일 반복의 검색 품질이며 실제 고객 성과, HTTP 응답 P95, 확정 답변 성공률이 아니다.

## 답변 평가와 공개 조건

개선용 20문항의 고정 검색 자료를 같은 답변 모델·날짜·단일 턴 조건으로 A/B 교대로 읽게 했다. [첫 답변 비교](../../backend/eval/results/search-answer-comparison-2026-10-13T10-25-25-845Z.json)는 실제 LLM 요청 40회이며 B 답변 1개에서 API 오류가 발생했다. 실패를 제외해 답변 정확도를 높여 보고하지 않는다.

기존 20문항은 합성 도메인 응답과 격리 DB로 실제 도구 선택을 평가한다. 첫 회귀에서 감사 로그 action 오해 2건과 API 오류 2건을 발견했고 [그 결과](../../backend/eval/results/search-assistant-regression-2026-10-13T10-29-02-989Z.json)를 보존했다. action enum 규격을 수정한 뒤 전체를 다시 실행한다. LLM 요청 수는 도구 건수 + 1 추정이 아니라 SDK 요청 직전의 측정이며 실패 요청도 포함한다. 평가의 일시 장애 재시도는 최대 1회이고 각 시도·요청 수를 보고한다.

enum 수정 후 [회귀 결과](../../backend/eval/results/search-assistant-regression-2026-10-13T10-34-51-773Z.json)는 규칙 20/20, 도구 선택 17/17이었다. 실제 LLM 요청 39회에는 일시 실패 후 재시도 1건을 포함한다. 최종 사례 오류 0건과 중간 실패 시도 1건을 구분한다. 실패 시도의 미제공 토큰 사용량을 0으로 가정하지 않는다.

최초 v1의 [전체 어시스턴트 결과](../../backend/eval/results/search-assistant-final-2026-10-13T10-45-38-489Z.json)는 30개 모두 실행, LLM 요청 67회, 최종 API 실패 1개였다. [보조 judge](../../backend/eval/results/search-answer-judge-2026-10-13T10-50-42-685Z.json)는 잠정 24/30이지만 판정 오류 1건·답변 실패 1건이 포함되어 있고 사람 확정 판정이 아니다. 모든 [문항과 인용](../../backend/eval/results/search-human-review-2026-10-13T10-50-42-685Z.md)을 보존했다. 검색이 관련 원문을 확보했어도 모델이 다른 표현을 같은 현상으로 해석하지 못하거나, 5점의 직접 불만을 긍정 내용으로 취급했다. 일부 문항은 종료일을 도구에 생략했다. 자동 인용 ID 검사가 `원본 ID: 1022`처럼 # 없는 표현을 놓친 사례도 있어 자동 검사 수치만을 답변 성공률로 사용하지 않는다.

이 실패를 보고 답변 프롬프트를 바꿨으므로 **v1은 이후 개선용 자료로 전환했다**. 본문으로 긍정/부정을 판단하고 같은 현상의 다른 표현도 관련 근거로 읽도록 명시했다. 명시된 날짜 양끝과 `리뷰 #ID` 인용 규칙도 보강했다. 검색 모델·청크·후보 수·거리 계산은 바꾸지 않았다. [새 최종 v2](../../backend/eval/search/final-fixture-v2.ts)는 이전 두 자료와 원본·상품·불만 주제·질문을 공유하지 않으며, 기존과 같은 합격 기준을 결과 확인 전에 고정했다. 낮은 별점의 “문제 없음”도 함정으로 넣었다. v1의 수치로 개선한 답변의 최종 성공률을 주장하지 않는다.

v2 [검색 결과](../../backend/eval/results/search-retrieval-final-v2-2026-10-13T10-56-34-080Z.json)는 30개 모두 실행·오류 0, 문서 30종 + 질문 30개로 임베딩 요청 60회였다. 로컬 CLI의 DB 확인·후보 검색·최종 재확인 누적 시간은 30회 표본의 nearest-rank P50 약 **48.7ms**, P95 약 **59.5ms**다. 임베딩 API·LLM·HTTP/SSE 시간은 이 수치에 포함하지 않는다.

v2 [전체 어시스턴트 결과](../../backend/eval/results/search-assistant-final-2026-10-13T11-07-46-261Z.json)는 자연어 30문항 모두 실행·답변 API 오류 0·실패 시도 0, LLM 요청 60회였다. 고정 검색 문구와 모델이 선택한 문구가 달라 새 질문 임베딩 요청은 26회, 동일 입력 캐시 조회는 4회였다. 필요한 조건의 자동 검사는 근거 있음 **18/20**, 근거 없음 **9/10**이다. 세 자동 실패는 # 없는 명시적 ID 표기 두 건과 “발견되지 않았다”는 근거 없음 표현을 단순 정규식이 놓친 사례다. 이 수치를 확정 답변 성공률로 바꾸지 않는다. 앞선 준비 단계의 [미실행 결과](../../backend/eval/results/search-assistant-final-2026-10-13T11-00-26-848Z.json)도 보존했다(계획 30·실행 0·외부 요청 0).

보강 후 기존 골든셋의 [전체 회귀](../../backend/eval/results/search-assistant-regression-2026-10-13T10-57-45-532Z.json)는 19/20, 도구 문항 16/17이며 한 문항에서 일시 API 오류가 재시도 후에도 발생했다. 그 문항의 [별도 부분 재검증](../../backend/eval/results/search-assistant-regression-2026-10-13T11-20-15-057Z.json)은 1/1·요청 2회·오류 0으로 통과했다. 전체 실패를 없었던 것으로 합치거나 단일 실행의 20/20으로 표시하지 않는다.

v2 [보조 판정 결과](../../backend/eval/results/search-answer-judge-2026-10-13T11-17-44-591Z.json)는 잠정 24/30, 판정 오류 2건이다. 첫 [형식 불안정 결과](../../backend/eval/results/search-answer-judge-2026-10-13T11-11-55-591Z.json)도 보존했다. 판정 출력은 [Gemini의 구조화 출력](https://ai.google.dev/gemini-api/docs/structured-output)으로 JSON Schema를 지정하고 같은 Zod 정의로 파싱한다. JSON 형식 고정은 판정의 의미적 정확성을 보장하지 않는다. 보조 판정이 원문 존재 여부를 잘못 읽거나 설명과 boolean을 모순되게 출력한 사례는 [최종 사람 검토 문서](../../backend/eval/results/search-human-review-2026-10-13T11-17-44-591Z.md)에 표시했다. 사람 검토는 30개 모두 미완료이며 확정 답변 성공률과 공개 통과 판정을 내리지 않았다.

[현재 최종 자료와 합격 기준](../../backend/eval/search/final-fixture-v2.ts)은 v2 실행 전에 고정했다. 검색 Hit@5 95% 이상·Recall@5 90% 이상, 답변 근거 있음/없음 각 90% 이상, 연락처 노출·잘못된 출처 0건을 기준으로 삼았다. 최종 답변 30개는 자연어 질문→실제 도구·인자 선택→검색→답변을 평가하고, 규칙 검사는 필요한 조건만 검사한다. LLM judge는 판정 보조이며 **개발자가 최종 30개 전부를 대조하기 전 확정 답변 성공률은 없다**. judge와 사람의 불일치 이유도 기록한다.

현재 검색 공개 플래그는 **false로 유지**한다. 기존 DB 환경 전환·대상 리뷰 초기 색인과 미해결 실패 확인·최종 답변 사람 검토가 공개 조건이다. 현재 사용자가 작성한 리뷰의 색인 수동 테스트 완료와 전체 과거 리뷰의 초기 색인 완료는 서로 다른 상태다. 수동 DB를 읽기 전용으로 확인한 현재 값은 리뷰 1,863개·작업 0개·청크 0개다. backend/.env의 리뷰 작업 생성 true·worker false·검색 false 설정을 유지했다.

## 재현 명령

프로젝트 루트의 PowerShell 터미널에서 실행한다. DB 자동 검증에는 검색 전용 PostgreSQL(probe DB)이 필요하다. 실제 모델 평가에는 backend/.env의 API 키를 사용하지만 사용자 POSTGRES DB에 접속하지 않는다.

```powershell
yarn nx run '@shopping-mall/backend:search:db:up'
yarn nx run-many -t 'search:db:verify' 'search:index:verify' 'search:query:verify' 'search:chat:verify' -p '@shopping-mall/backend' --parallel=2
yarn nx run-many -t typecheck search:typecheck -p '@shopping-mall/backend'
yarn nx run '@shopping-mall/backend:test' --runInBand
yarn nx run '@shopping-mall/backend:search:query:eval'
yarn nx run '@shopping-mall/backend:search:query:eval' --split=final-v2
yarn nx run '@shopping-mall/backend:search:assistant:eval' --split=regression
yarn nx run '@shopping-mall/backend:search:assistant:eval' --split=final-v2
```

모델 평가 명령은 순서대로 실행한다. 서로 다른 프로세스에서 동시에 실행하면 계정 쿼터를 공유하고 평가 캐시 파일도 경합한다. A/B 비교와 최종 답변 judge는 아래처럼 해당 결과 파일을 전달한다. 이력 파일명은 실행할 때마다 달라진다.

```powershell
yarn nx run '@shopping-mall/backend:search:answer:compare' --args='eval/results/search-retrieval-improvement-2026-10-13T10-14-30-346Z.json'
# <최종답변파일>은 search:assistant:eval --split=final-v2 출력의 파일명으로 교체
yarn nx run '@shopping-mall/backend:search:answer:judge' --args='eval/results/<최종답변파일>.json'
```

## 사람이 확인할 항목

현재 사용자 테스트 상품 577·리뷰 1874의 확인 결과와 이어서 실행할 질문·수정·삭제 순서는 [3단계 화면 검증](./ex-ai-vector-search-phase3-manual-test.md)에 기록했다. 검색·마스킹 확인과 답변의 작성자 추정 표현 보완 항목을 구분한다.

최종 judge 실행은 `backend/eval/results/search-human-review-*.md`를 함께 생성한다. 질문·조건·정답 ID·실제 도구 결과·답변·보조 판정을 나란히 읽고 30개 모두의 **미검토**를 통과/실패로 바꾸며 불일치 이유를 적는다. 이 작업이 답변 품질 공개 판단에 필요하다.

실제 화면의 선택적 검증은 [수동 테스트 DB](./ex-ai-vector-search-manual-test.md)를 사용한다. 준비한 리뷰를 수동 worker로 완료하고, 로컬 격리 실험에서만 `AI_SEARCH_REVIEWS_ENABLED=true`로 바꾼 뒤 백엔드를 재시작한다. 상품 ID를 명시해 “상품 N에서 팔 부분이 조인다는 불만을 찾아줘. 리뷰 ID와 원문을 인용해줘.”처럼 질문한다. 높은 별점의 해당 리뷰도 찾아야 하고, 아직 다른 원본이 미색인이면 일부 자료 기준임을 밝혀야 한다. 인용 ID를 실제 리뷰와 대조하고 수정·삭제 후 오래된 인용이 사라지는지 확인한다. 종료 후 공개 플래그를 false로 되돌린다. 검증 때문에 전체 과거 리뷰를 자동으로 외부 API에 일괄 전송하지 않는다.
