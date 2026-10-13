# 관리자 AI 검색 2단계: 리뷰 색인

2026-10-13 KST. [설계](./ex-ai-vector-search.md)의 리뷰 색인 단계 구현·검증 기록이다. [1단계 환경·전환 절차](./ex-ai-vector-search-phase1.md)는 그대로 사용한다.

후속 [엣지케이스 검증](./ex-ai-vector-search-edgecases.md)에서 잠금·작업 식별·임베딩 응답·시간 제한·비활성 기동·CLI 입력의 결함을 수정했다. 아래 완료 검증은 최초 2단계 기록이며, 후속 최종 결과는 단위 84/84, 리뷰 색인 PostgreSQL 49/49, 기반 PostgreSQL 7/7이다.

사용자 [실제 화면 수동 검증](./ex-ai-vector-search-manual-test.md)도 완료했다. 리뷰 작성 → 버전 1 `done`, 본문 수정 → 버전 2 `done`, 별점만 수정 → 버전 3 `reused`를 확인했고, 삭제 후 해당 원본·작업·청크 각각 0행을 DB에서 확인했다. 이 4개 사례의 [결과 JSON](../../backend/eval/results/search-manual-review-1873-2026-10-13.json)은 합성 파일럿과 별도로 보존했다.

## 구현한 동작

리뷰 생성은 원문과 버전 1의 작업을 같은 트랜잭션에 저장한다. 수정은 원문 행을 잠근 뒤 소유권·30일 제한을 다시 검사하고 본문·평점 등을 저장한다. 같은 트랜잭션에서 DB의 `search_version`을 증가시키고 새 작업을 기록한다. 작업 기록 실패는 원문 변경과 버전 증가도 롤백한다. 평점 이벤트는 커밋 후에만 발행하며 본문 수정 때문에 평점 이벤트를 추가하지 않는다. 삭제는 원본 잠금·권한 재검사 후 수행하고 FK로 작업과 청크도 삭제한다.

`SearchIndexRecorder`는 `EntityManager`·설정·프로필 정의에만 의존한다. 일반 리뷰 API와 리뷰 시드가 같은 기록 함수를 사용한다. 시드는 200건 단위 트랜잭션 안에서 원문과 작업을 저장하고 새 검색 처리기나 LLM 호출을 실행하지 않는다. 대시보드 시드의 원문 삭제는 동일한 FK 연쇄 삭제를 따른다. `prepare-role-demo`, `repair-demo-data`는 현재 리뷰 쓰기를 하지 않아 리뷰 단계에서 변경하지 않았으며 문의 쓰기는 4단계 대상이다.

처리기는 PostgreSQL의 `FOR UPDATE SKIP LOCKED`로 실행 가능한 리뷰 작업만 점유하고 즉시 커밋한다. 기본 점유 120초, 갱신 30초, 최대 5회 시도이며 인스턴스당 동시에 한 작업만 처리한다. 외부 요청을 기다리는 동안 원문 잠금을 유지하지 않는다. 클라이언트의 RPM 대기가 끝난 실제 요청 경계에서도 버전·점유를 검사한다.

결과 저장은 원문 → 작업 순서로 잠근 뒤 버전·프로필·토큰·만료를 검사한다. 청크 전체 교체와 `done` 기록은 함께 커밋하며 최종 상태 갱신 직전에도 만료를 다시 검사한다. 중간 저장 오류나 그 사이 점유 만료는 청크 교체 전체를 롤백한다. 점유를 잃은 처리기는 작업 상태를 바꾸지 않는다. 삭제되거나 버전이 바뀐 원문에 늦은 결과를 저장하지 않는다.

같은 본문의 벡터는 현재 저장된 청크의 버전·해시·텍스트·개수와 그에 대응하는 최신 완료 기록이 모두 일치할 때만 재사용한다. A→B→A로 수정한 경우 과거 A의 해시가 존재한다는 이유로 현재 B의 벡터를 재사용하지 않는다. 빈 본문은 이전 청크를 제거하고 0개로 완료하며 API를 호출하지 않는다.

429·시간 초과·일시 장애는 지수 지연과 jitter로 재시도하고 `Retry-After`를 존중한다. 만료 작업 재점유도 시도를 소모하며 5회 상한을 넘기면 실패로 남긴다. 모델·권한·응답 설정 문제는 반복 호출을 중단하고 안전한 오류 코드만 기록한다. 설정을 고친 후 실패 재처리와 프로세스 재시작으로 다시 실행한다.

일괄 색인·대조는 ID 커서와 시작 시점의 최대 ID를 사용한다. 대조는 누락 작업, 원문 해시 불일치, 잘못된 청크 텍스트·버전·개수를 복구한다. 현재 버전에 진행 중인 작업은 덮어쓰지 않으며 실패 작업은 명시적 재처리 대상으로 남긴다. 직접 SQL 변경은 주기적 대조에서 처리하므로 실시간 반영을 보장하지 않는다. 이전 버전 종료 작업은 14일 후 정리하지만 현재 버전 완료 기록은 보존한다.

## 활성화와 운영 명령

실제 화면에서 확인하는 DB 준비와 실행 순서는 [리뷰 API와 색인의 수동 검증](./ex-ai-vector-search-manual-test.md)에 정리했다.

기존 DB의 이미지·마운트 전환과 마이그레이션을 먼저 완료한다. 현재 작업은 격리 DB에서 검증했으며 기존 사용자 DB를 전환하거나 그 리뷰를 외부 API로 보내지 않았다.

```dotenv
AI_SEARCH_REVIEW_INDEX_ENABLED=true
AI_SEARCH_WORKER_ENABLED=true
AI_SEARCH_REVIEWS_ENABLED=false
AI_SEARCH_INQUIRIES_ENABLED=false
AI_SEARCH_STRUCTURED_ENABLED=false
```

작업 생성과 검색 공개는 서로 다른 플래그다. 후속 [3단계](./ex-ai-vector-search-phase3.md)에서 채팅 의미 검색을 연결했으며 초기 색인·최종 사람 검토 전에는 공개 플래그를 false로 유지한다. 작업 생성 플래그가 false이면 원문 서비스는 검색 테이블·버전 컬럼을 읽거나 수정하지 않는다. 작업 생성·검색을 모두 끈 상태에서 기존 앱 DB를 계속 사용할 수 있다. 과거에 플래그를 끈 동안의 변경은 활성화 전 대조해야 한다.

```powershell
yarn nx run '@shopping-mall/backend:search:backfill'
yarn nx run '@shopping-mall/backend:search:backfill' --apply
yarn nx run '@shopping-mall/backend:search:work' --apply --limit=100
yarn nx run '@shopping-mall/backend:search:reconcile' --apply
yarn nx run '@shopping-mall/backend:search:retry-failed' --apply --review-id=123
yarn nx run '@shopping-mall/backend:search:cleanup' --apply
```

`--apply`가 없으면 명령과 적용 방법만 출력하고 DB에 연결하지 않는다. 적용 명령은 `backend/.env`의 DB를 사용하며 `SEARCH_INDEX_SCHEMA`로 스키마를 지정할 수 있다. `work`는 실제 마스킹한 리뷰를 임베딩 API에 전송한다. 스케줄러는 활성화 시 1초마다 작업을 확인하고 5분마다 대조하며 종료 작업을 매일 정리한다. 본문·벡터·원본 provider 오류는 운영 로그에 기록하지 않는다.

원본 버전은 `EntityManager.query`의 PostgreSQL bigint 문자열로 읽고 DB에서 증가시킨다. 원본 DTO와 일반 ORM 저장 객체에는 버전을 넣지 않는다. 원본 엔티티의 버전 컬럼 매핑은 아직 추가하지 않아 자동 마이그레이션 생성기가 해당 컬럼 제거를 제안할 수 있다. 해당 제안을 그대로 적용하지 말고 DB 전환 후 원본 매핑을 포함해 별도로 검토한다. 이 선택은 마이그레이션 전 기존 DB에서 TypeORM INSERT RETURNING이 없는 컬럼을 읽는 문제를 피한다.

## 검증 자료

```powershell
yarn nx run '@shopping-mall/backend:search:index:verify'
yarn nx run '@shopping-mall/backend:search:index:pilot'
```

통합 검증은 전용 PostgreSQL 18.3·pgvector 0.8.7 DB의 고유 스키마를 만들고 제거한다. 원문 저장·잠금·버전·작업·벡터·롤백은 실제 PostgreSQL을 사용하고 외부 임베딩만 대역으로 교체한다. API의 구매 주문 자격 검증과 저장 후 표시 관계는 대역이므로 이 테스트를 HTTP 전체 검증으로 표현하지 않는다. 별도 파일럿은 합성 리뷰 2건에서 실제 Gemini API와 DB를 연결한다.

검증 항목은 본문 수정, 평점 수정 재사용, A→B→A, 빈 본문, 늦은 이전 결과, 삭제 중 완료, 점유 만료·재점유, 갱신 실패, 최종 저장 중 만료, 동시 수정, 동일 작업 재등록, 원문·버전 롤백, 중간 청크 저장 롤백, 재시도·상한, 권한 실패 중단, 직접 SQL·파생 데이터 대조, 크기 초과, 현재 완료 기록 보존, 비활성 Nest 모듈 연결이다.

실제 파일럿 결과는 [search-index-pilot-2026-10-13T00-16-36-677Z.json](../../backend/eval/results/search-index-pilot-2026-10-13T00-16-36-677Z.json)에 보존했다. 6개 확인 항목을 통과했고 외부 호출은 3회였다. 테스트 DB 저장 시작부터 색인 완료까지 첫 원문 약 0.60초, 둘째 원문 약 6.69초, 수정 약 5.90초를 관측했다. RPM 제한 대기를 포함한 단일 실행이며 HTTP 저장 요청→실제 검색 가능 시간, P95, 처리량 또는 검색 품질 수치가 아니다. API가 토큰 사용량을 제공하지 않아 null로 남겼다.

## 남은 단계

이 문서는 리뷰 색인 단계의 기록이다. 리뷰 의미 검색·최신성 재확인·출처와 coverage·도구 인자 및 호출자 검증·`summarize_reviews(query)`와 HTTP/SSE 검증은 후속 [3단계](./ex-ai-vector-search-phase3.md)에 구현했다. 문의 공개/비밀·답변·체험 저장 경로는 4단계다. 기존 DB 전환, 대상 원문의 초기 색인·실패 해소, 분리된 최종 답변의 사람 검토 후에 검색을 공개한다.

## 완료 검증

| 확인 | 결과 |
|---|---|
| 리뷰·문의 회귀, 마스킹·분할·임베딩 경계·비활성 기록 | 단위 테스트 5개 파일, 46/46 통과 |
| PostgreSQL 동시성·복구·롤백과 Nest 모듈 연결 | 23/23 통과 |
| 실제 Gemini + PostgreSQL 색인 파일럿 | 6/6 확인 항목 통과, 외부 요청 3회 |
| 백엔드·검색 평가 코드 타입 검사 | 통과 |
| lint | 오류 없음. 기존 경고는 남아 있음 |
| 백엔드 빌드 | 번들 생성 성공. 기존 Nx lockfile 축소 경고와 루트 lockfile fallback은 남아 있음 |

통합 테스트의 원본 결과는 [search-index-integration-2026-10-13.json](../../backend/eval/results/search-index-integration-2026-10-13.json)에 저장했다. 중간 실패에서는 TypeORM PostgreSQL UPDATE/DELETE 반환 형식과 상태 파라미터의 varchar 캐스팅 문제를 발견해 수정했다. 점유 갱신 실패 테스트는 이미 중단된 신호를 대역이 처리하지 못해 대기한 경우를 수정했으며, 실제 SDK의 중단 전 검사도 함께 확인했다. 점유 만료가 청크 저장 중 발생하는 경우에는 마지막 완료 UPDATE의 만료 검사로 전체 저장이 롤백됨을 검증했다.
