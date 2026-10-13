# 관리자 AI 검색 1·2단계 엣지케이스 검증

2026-10-13 KST. [설계](./ex-ai-vector-search.md), [1단계](./ex-ai-vector-search-phase1.md), [2단계](./ex-ai-vector-search-phase2.md)의 구현을 대상으로 추가 검증했다. 전용 PostgreSQL 18.3·pgvector 0.8.7 DB의 고유 스키마를 사용했으며 기존 사용자 DB와 활성화 설정은 변경하지 않았다. 이번 검증의 임베딩 API는 대역으로 실행했다.

## 재현한 결함과 수정

| 유형 | 수정 전 재현 | 수정 후 동작 |
|---|---|---|
| 만료된 최종 시도 작업의 잠금 | 해당 작업을 다른 트랜잭션이 잠그면 실패 상태 정리 UPDATE가 대기해, 별도의 실행 가능한 작업도 점유하지 못함 | 실패 정리도 최대 100건의 `FOR UPDATE SKIP LOCKED`로 처리. 잠긴 작업을 건너뛰어 다른 작업을 처리하고 다음 점유에서 정리 |
| 작업 식별 정보 불일치 | 토큰은 맞지만 리뷰 ID·프로필·버전이 다른 작업 객체를 수용하거나 원본 변경으로 오분류 | 원본 읽기·점유 갱신·완료·실패 경계에서 DB 작업과 리뷰 ID·프로필·버전을 대조. 불일치는 상태 변경 없이 거절 |
| 비활성 처리기의 잘못된 설정 | 워커가 동작하지 않는 조합에서도 RPM·timeout이 0이면 Nest 모듈 생성이 실패 | 작업 생성·워커 플래그가 모두 켜질 때만 실제 임베딩 클라이언트를 생성. 비활성 조합은 DB 조회 없이 기동 |
| 잘못된 임베딩 응답 | 비어 있는 배열 요소, float32에서 0이 되는 값 또는 범위를 넘는 값이 클라이언트 검사를 통과. 누락된 어댑터 벡터는 재시도 가능한 저장 실패로 오분류 | 공통 검증기로 768개 요소 전체의 숫자·유한성·float32 범위·저장 후 비영 벡터를 검사. null 응답·누락 레코드·집계 응답도 `INVALID_EMBEDDING`으로 중단하고 다음 청크 요청을 보내지 않음 |
| 저장된 0 벡터의 재사용 | 텍스트·해시·버전이 맞으면 손상된 0 벡터를 재사용하고 대조 작업도 정상으로 판단 | 재사용과 대조에서 `vector_norm(embedding)>0` 확인. 재임베딩하거나 한 번만 복구 작업을 등록 |
| 중단을 무시하는 API의 시간 제한 | transport가 abort를 무시하면 제한 시간이 지나도 호출자가 계속 대기 | transport의 완료와 독립적으로 timeout을 처리하고 늦은 결과·실패를 소비. 다음 요청을 처리할 수 있음. Node timer 범위를 넘는 설정은 요청 전에 거절 |
| 대기열에 있는 요청의 취소 | 앞선 요청이 끝나야 취소한 호출자가 반환 | 대기 중인 호출자는 즉시 `ABORTED`. 취소된 요청은 외부로 보내지 않으며 뒤의 요청은 계속 실행 |
| CLI 옵션 오타 | `--limt=1`, `--review-Id=1` 등을 무시하여 기본 처리량 또는 전체 재처리 범위로 실행될 수 있음 | 명령별 옵션을 DB 연결 전에 검증. 오타·중복·다른 명령의 옵션·빈 값·음수·소수·지수 표기·범위 초과를 `INVALID_INPUT`으로 거절 |

수정 전 추가 테스트에서 PostgreSQL 34건 중 9건, 클라이언트 18건 중 6건의 실패를 기록했다. 실패 건수는 위 유형의 개수와 다르다. 한 결함을 여러 입력이나 경계에서 확인한 경우가 포함된다.

- [수정 전 PostgreSQL 결과](../../backend/eval/results/search-edgecases-before-integration-2026-10-13.json)
- [수정 전 클라이언트 결과](../../backend/eval/results/search-edgecases-before-unit-2026-10-13.json)

CLI의 수정 전 `search:work --limt=1`은 잘못된 옵션인데도 dry run 성공으로 끝났다. 수정 후 같은 명령과 `search:retry-failed --apply --review-Id=1`은 `INVALID_INPUT`, 종료 코드 1로 끝났다. 올바른 `search:work --limit=1`은 DB에 연결하지 않는 dry run으로 정상 종료했다. 위험한 오타 명령을 수정 전 `--apply`로 실행하지 않았다.

실제 pgvector의 읽기 전용 캐스팅도 확인했다. 768개 값이 모두 `1e-50`이면 저장 표현의 norm이 0이 되고, `1e100`이면 PostgreSQL `22003`이 발생했다. 저장 실패까지 진행하기 전에 프로토콜 오류로 식별하도록 클라이언트와 저장 경계에 같은 검증기를 적용했다. 손상된 벡터의 재사용 검사는 0 벡터를 대상으로 하며 임의의 다른 비영 벡터가 원문 의미에 맞는지를 판별하는 검사는 아니다.

## 함께 확인한 경계와 회귀

- **동시성:** 여러 처리기의 작업 점유가 중복되지 않는다. 두 리뷰 생성 요청이 사전 중복 검사를 함께 통과해도 원본·작업·이벤트는 한 번만 생성한다. 본문·평점 동시 수정은 내용을 보존하고 버전을 각각 증가시킨다.
- **최신성·점유:** 다중 청크의 첫 요청 중 본문이 바뀌면 다음 청크 요청을 보내지 않는다. 늦은 이전 결과, 삭제, 재점유한 토큰, 갱신 실패, 마지막 청크 저장 중 만료에서 결과를 커밋하지 않는다.
- **원자성:** 작업 기록 실패·중간 청크 삽입 실패·bigint 증가 범위 초과에서 원본 변경이나 청크 교체를 롤백한다. 실패하거나 권한·작성 후 기간 검사에서 거절한 원본 변경은 새 이벤트·작업을 생성하지 않는다.
- **버전:** `9007199254740993`부터 일괄 등록·색인·수정·재사용을 실제 DB로 실행해 다음 버전 `9007199254740994`를 문자열로 보존한다. PostgreSQL 최대 bigint에서 증가 실패는 수정 내용을 롤백한다.
- **입력:** ASCII 28,900자는 32청크로 처리하고 다음 한 글자는 거절한다. 이모지 질문 1,000개는 허용하고 1,001개는 거절한다. 긴 이모지 제목으로 바이트 예산이 줄어도 본문을 잃지 않는다. 마스킹·부정어 보존·빈 문서·비밀 문의 전처리도 회귀 확인했다.
- **복구:** A→B→A와 평점 변경 재사용, 누락 작업·텍스트·0 벡터 복구, 진행 중 작업 보존, 재시도 상한·Retry-After·현재 완료 기록 보존을 확인했다. 유지보수 배치 크기는 정수 1~1,000, 재처리 리뷰 ID는 PostgreSQL 양수 integer 범위를 벗어나면 조회 전에 거절한다.
- **DB 제약:** 잘못된 작업 상태·음수 시도 횟수·33청크, 청크 인덱스 범위·벡터 차원·참조 대상·중복 청크를 거절한다. 마이그레이션 롤백은 원문과 공유 vector 확장을 보존한다.

## 최종 결과와 재현

| 검증 | 결과 | 원본 결과 |
|---|---|---|
| 리뷰·문의 회귀, 임베딩·전처리·CLI 경계 | 6개 파일, **84/84** 통과 | [단위 결과](../../backend/eval/results/search-edgecases-unit-2026-10-13.json) |
| 실제 PostgreSQL 리뷰 색인·복구·동시성 | **49/49** 통과 | [리뷰 색인 결과](../../backend/eval/results/search-edgecases-integration-2026-10-13.json) |
| 실제 PostgreSQL 마이그레이션·DB 제약 | **7/7** 통과 | [기반 결과](../../backend/eval/results/search-edgecases-foundation-2026-10-13.json) |
| 백엔드·검색 평가 코드 타입 검사 | 통과 | Nx `typecheck`, `search:typecheck` |
| lint | 오류 없음 | Nx `lint --quiet` |
| 백엔드 빌드 | 번들 생성 성공 | 기존 Nx lockfile 축소 실패와 루트 lockfile fallback은 남아 있음 |

총 **140/140**, 기존 검증에서 **66개 사례를 추가**했다. 서로 다른 검증 시나리오의 합계이며 검색 정확도·성능 지표로 사용하지 않는다.

```powershell
$env:NX_DAEMON='false'
$env:NX_INTERACTIVE='false'
yarn nx run '@shopping-mall/backend:test' --runInBand --runTestsByPath src/review/review.service.spec.ts src/inquiry/inquiry.service.spec.ts src/search/search-index-recorder.spec.ts src/intrastructure/ai/providers/gemini-embedding.client.spec.ts src/search/search-document.spec.ts src/search/review-index-options.spec.ts
yarn nx run '@shopping-mall/backend:search:index:verify'
yarn nx run '@shopping-mall/backend:search:db:verify'
yarn nx run-many -t typecheck search:typecheck build -p '@shopping-mall/backend'
yarn nx run '@shopping-mall/backend:lint' --quiet
```

DB 검증은 전용 DB의 포트 15433을 기본으로 사용한다. 다른 전용 환경에서는 `SEARCH_TEST_POSTGRES_PORT`를 지정한다. 테스트가 임의 스키마를 만들고 종료 시 삭제한다. Nest 비활성 테스트에서 사용하지 않는 잘못된 임베딩 설정은 기동을 방해하지 않으며, 이후 워커를 활성화하려면 설정을 고친 후 프로세스를 재시작한다.

실제 PostgreSQL을 사용하는 범위는 원본 저장·버전·작업·청크·잠금·제약·롤백이다. 주문 구매 자격·표시 관계·외부 API 장애는 대역으로 검증했다. 이번 실행은 실제 Gemini 장애나 HTTP/SSE 전체 경로를 재현한 기록이 아니며, 기존 합성 자료 Gemini 파일럿은 1·2단계 기록에 그대로 보존했다. 의미 검색·채팅 연결과 문의 색인 경로는 다음 단계의 검증 대상이다.
