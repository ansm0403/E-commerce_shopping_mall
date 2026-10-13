# 관리자 AI 검색 3단계 엣지케이스 검증

2026-10-13 KST. [3단계 구현](./ex-ai-vector-search-phase3.md)의 리뷰 의미 검색·관리자 채팅 경계를 검증했다. 기존 검증에 **27개 회귀 사례**를 추가했으며, 재현한 결함 6유형을 수정했다. 실제 PostgreSQL 18.3·pgvector 0.8.7을 사용하고 LLM·임베딩 API는 대역으로 실행했다.

## 재현한 결함과 수정

| 유형 | 수정 전 | 수정 후 |
|---|---|---|
| DB 연결 대기 중 취소 | 연결 풀이 가득 차면 취소해도 연결을 얻을 때까지 반환하지 않음 | 연결 대기와 취소를 경합시켜 즉시 `ABORTED` 반환. 나중에 할당된 연결은 쿼리·트랜잭션 없이 풀로 반환 |
| 손상된 원본·인용의 상태 | 해시·실제 본문·인용 불일치로 후보를 제외해도 `no_candidates`, 또는 정상 준비 원본 수로 계산 | 마지막 스냅샷에서 확인한 손상 원본을 coverage의 ready에서 failed로 이동. 후보가 없으면 `unavailable`, 다른 정상 후보가 있으면 `ok`와 partial 반환 |
| 순위 계산 후 새 버전 완료 | 새 버전이 정상 색인됐지만 이전 버전 후보가 무효화되면 `no_candidates` 반환 | 마지막 스냅샷에 준비된 청크가 있는데 반환할 후보가 없으면 `unavailable/SOURCE_CHANGED`. 정상 원본의 ready 수는 유지하고 partial 표시 |
| 도구 알림 직후 취소 | `tool_call` 이벤트를 소비하는 동안 취소해도 이후 도구 콜백 실행 | 이벤트 yield에서 재개한 직후 취소 재확인. 콜백과 다음 LLM 요청을 실행하지 않음 |
| 취소 후 늦은 SDK 조각 | SDK가 취소를 무시하고 조각을 전달하면 text·usage·done 출력 | 청크·part·스트림 종료·도구 완료 경계에서 취소를 확인하고 성공 완료를 출력하지 않음 |
| 비스트리밍의 조용한 취소 | provider가 예외 없이 종료하면 부분 답변을 정상 결과로 반환 | 반복문 종료 후에도 취소를 확인해 `AssistantTraceError(ABORTED)` 반환. 이미 발생한 LLM 요청 수 보존 |

coverage 수정은 같은 최종 읽기 스냅샷에서 실제 불일치를 확인한 후보 원본에만 적용한다. 검색이 색인을 변경하거나 재임베딩하지 않는다. 직접 SQL 변경 전체를 실시간으로 감지하는 기능은 아니므로, 관리 코드 밖에서 원문을 변경했다면 기존 reconciliation 절차가 필요하다.

pg는 연결 풀 대기 항목을 취소하는 공개 API를 제공하지 않는다. 취소된 검색의 호출자는 즉시 반환하고, 대기 항목에 연결이 할당될 때 별도 정리 경로가 반환한다. 실제 최대 연결 1개인 풀에서 취소 반환, 늦은 QueryRunner 해제, 쿼리 미실행, 후속 조회 성공을 확인했다.

## 함께 확인한 경계

- **임베딩 호출 중 변경:** 삭제·본문 버전 증가·평점 상승·카테고리 이동·상품 이동·작업 실패 이후 오래된 인용을 반환하지 않는다. 외부 API 대기 중에는 원본을 잠그는 DB 트랜잭션을 유지하지 않는다.
- **잘못된 응답:** 벡터 없음·복수 벡터·잘못된 차원·0벡터·NaN·Infinity를 `INVALID_EMBEDDING`으로 거절한다.
- **빈 조건:** 상품 ID가 있어도 빈 카테고리 범위를 전체로 확대하지 않으며 임베딩을 호출하지 않는다.
- **DB 실패·취소:** 실행 중 `pg_sleep` 취소, 연결 대기 취소, 3초 statement timeout, 읽기 전용 트랜잭션의 쓰기 거절 후 모두 다음 검색이 동작한다.
- **도구·오류 경계:** prototype에서 상속한 도구 이름을 거절한다. 도구 콜백의 오류 본문·연락처를 다음 SDK 요청에 전달하지 않는다. 평가 요청 간격 대기 중 취소되면 요청을 보내거나 요청 수를 증가시키지 않는다.
- **기존 회귀:** 실제 인증 가드의 401/403·위조 권한 필드 거절, KST 종료일 마이크로초, 순위·중복 제거·원본당 인용 제한, 최신 원본 재확인, SSE 이벤트·부분 저장·명시적 취소를 재검증했다. 기반 마이그레이션·색인 동시성·복구 검증도 유지했다.

## 결과와 재현

| 검증 | 결과 |
|---|---|
| 백엔드 전체 단위 | **656/656**, 50개 파일 |
| PostgreSQL 검색 | **36/36** |
| 인증 HTTP/SSE + PostgreSQL | **6/6** |
| 기존 PostgreSQL 기반·색인 | **7/7 + 49/49** |
| 전체 통합 합계 | **98/98** |
| 백엔드·검색 평가 코드 타입 검사 | 통과 |
| lint `--quiet` | 오류 없음 |
| 개발 빌드 | 성공. 기존 Nx lockfile 가지치기 실패 시 root lockfile을 사용하는 fallback 메시지는 유지 |
| 테스트 후 임시 검색·평가 스키마 | 0개 |

[검증 기록](../../backend/eval/results/search-phase3-edgecases-verification-2026-10-13.json)과 [Jest 단위 원본 결과](../../backend/eval/results/search-phase3-edgecases-unit-2026-10-13.json)를 보존했다. 수정 전에는 추가 단위 사례 3건, 추가 DB 사례 4건이 실패했다. Docker 기동 후 첫 DB 실행에는 원본 준비의 `claim order` 실패도 1건 있었다. 준비 실패 원인은 확정하지 않았으며 이후 34/34, 최종 36/36 실행에서는 재발하지 않았다. Docker 미기동으로 발생한 최초 연결 실패는 기능 검증 결과와 분리했다.

프로젝트 루트 PowerShell에서 실행한다.

```powershell
yarn nx run '@shopping-mall/backend:search:db:up'
yarn nx run-many -t search:db:verify search:index:verify search:query:verify search:chat:verify -p '@shopping-mall/backend' --parallel=2
yarn nx run '@shopping-mall/backend:test' --runInBand
yarn nx run-many -t typecheck search:typecheck -p '@shopping-mall/backend'
yarn nx run '@shopping-mall/backend:lint' --quiet
yarn nx run '@shopping-mall/backend:build:development'
```

DB 검증은 `shopping_mall_search_probe` 안의 실행별 임시 스키마를 만들고 삭제한다. `backend/.env`의 사용자 DB와 공개 플래그는 변경하지 않았다. 이번 검증에서 실제 외부 LLM·임베딩 호출이나 기존 고객 리뷰의 일괄 색인은 실행하지 않았다.

현재 공개 플래그는 `AI_SEARCH_REVIEWS_ENABLED=false`, 워커는 `AI_SEARCH_WORKER_ENABLED=false`다. 공개 전 초기 색인과 [최종 30문항 사람 검토](../../backend/eval/results/search-human-review-2026-10-13T11-17-44-591Z.md)는 별도 남아 있다. 이번 기술 검증을 실제 고객 자료의 검색 품질·답변 정확도 검증으로 해석하지 않는다.
