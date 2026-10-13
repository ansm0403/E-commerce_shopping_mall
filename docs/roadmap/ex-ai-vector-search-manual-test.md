# 리뷰 API와 색인의 수동 검증

2026-10-13 KST. 기존 화면 회귀와 실제 Gemini 합성 리뷰 파일럿 이후, 브라우저의 리뷰 저장이 작업 생성·벡터 저장으로 이어지는지 확인하는 절차다. 프로젝트 루트의 PowerShell에서 실행한다. 아래 명령은 새 환경의 재현 절차다. 현재 로컬 환경의 DB 복사·마이그레이션은 에이전트가 완료했으며, 실행 기록은 문서 마지막에 있다.

## 현재 확인 상태

사용자가 기존 리뷰 화면의 작성·수정·삭제를 확인했다. 실제 파일럿 [search-index-pilot-2026-10-13T02-24-35-656Z.json](../../backend/eval/results/search-index-pilot-2026-10-13T02-24-35-656Z.json)은 전체 `passed: true`, 개별 6개 사례 통과, 외부 요청 3회, `errorCode: null`이다. 출력의 `passed: true` 7개는 전체 결과 1개와 개별 결과 6개다.

읽기 전용 확인 당시 앱은 `localhost:15432 / sangmoon`에 연결되어 있다. 이 DB에는 기존 9개 마이그레이션이 적용되어 있지만 vector 확장과 검색 테이블은 없다. `localhost:15433 / shopping_mall_search_probe`에는 10개 마이그레이션이 적용된 테이블이 있으나 사용자·상품·주문·리뷰는 0건이다.

`search:db:verify`, `search:baseline`, `search:pilot`은 격리된 검증을 수행한다. 이 명령들이 앱의 `backend/.env` DB 연결을 바꾸거나 실제 앱의 로그인·주문 데이터를 준비하지는 않는다. 수동 검증은 기존 데이터를 별도 DB로 복사해서 진행한다.

## 1. 기존 데이터의 테스트 복사본 만들기

기존 백엔드 서버를 종료한다. 아래 절차는 기존 `sangmoon` DB를 읽어 덤프하고, 이미 띄운 pgvector 컨테이너 안에 **새 DB `shopping_mall_search_manual`**을 만든다. 기존 DB나 `shopping_mall_search_probe`를 덮어쓰지 않는다.

먼저 컨테이너가 실행 중인지 확인한다. `search:db:up`을 이미 성공했다면 다시 실행할 필요는 없다.

```powershell
docker compose -f docker-compose.search.yaml ps
```

다음 블록은 처음 준비할 때 한 번 실행한다. 중간 명령이 실패하면 그 자리에서 중단한다. 같은 이름의 DB가 이미 있으면 `createdb`가 실패하며, 기존 DB를 자동으로 삭제하지 않는다.

```powershell
function Assert-SearchManualStep {
  param([string]$Step)
  if ($LASTEXITCODE -ne 0) { throw "$Step 실패. 다음 단계를 실행하지 마세요." }
}

$searchRunId = [guid]::NewGuid().ToString('N')
$searchDumpName = "search-manual-$searchRunId.dump"
$searchDumpPath = Join-Path $env:TEMP $searchDumpName
$searchDbContainer = docker compose -f docker-compose.search.yaml ps -q postgres-search
Assert-SearchManualStep '검증 컨테이너 조회'
if ([string]::IsNullOrWhiteSpace($searchDbContainer)) { throw 'postgres-search 컨테이너가 실행 중이어야 합니다.' }
$searchDbContainer = $searchDbContainer.Trim()

$searchManualExisting = docker exec $searchDbContainer psql -U search_probe -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname='shopping_mall_search_manual'"
Assert-SearchManualStep '복원 대상 DB 조회'
if (-not [string]::IsNullOrWhiteSpace($searchManualExisting)) { throw '대상 DB가 이미 있습니다. 기존 DB를 덮어쓰지 않습니다.' }

docker exec shopping_mall-postgres-1 pg_dump -U sangmoon -d sangmoon -Fc -f "/tmp/$searchDumpName"
Assert-SearchManualStep '기존 DB 덤프'

docker cp "shopping_mall-postgres-1:/tmp/$searchDumpName" $searchDumpPath
Assert-SearchManualStep '덤프 파일 복사'

docker cp $searchDumpPath "${searchDbContainer}:/tmp/$searchDumpName"
Assert-SearchManualStep '검증 컨테이너에 덤프 복사'

docker exec $searchDbContainer createdb -U search_probe shopping_mall_search_manual
Assert-SearchManualStep '새 수동 검증 DB 생성'

docker exec $searchDbContainer pg_restore -U search_probe -d shopping_mall_search_manual --no-owner --no-privileges --exit-on-error "/tmp/$searchDumpName"
Assert-SearchManualStep '수동 검증 DB 복원'
```

덤프는 컨테이너에서 파일로 만들고 `docker cp`로 옮긴다. PowerShell의 텍스트 파이프나 `>`로 바이너리 덤프를 전달하지 않는다. `$searchDumpPath`에는 복원에 사용한 백업이 남는다. 현재 확인한 기존 컨테이너명·DB명이 바뀌었다면 원본을 확인한 뒤 해당 인자를 바꾼다.

## 2. backend/.env를 테스트 DB로 연결

기존 DB 접속값을 별도로 기록한 뒤 `backend/.env`의 아래 키를 수정한다. 같은 키를 중복해서 추가하지 않는다. API 키·Redis·JWT 등 다른 기존 설정은 유지한다.

```dotenv
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=15433
POSTGRES_USER=search_probe
POSTGRES_PASSWORD=search_probe
POSTGRES_DB=shopping_mall_search_manual

AI_SEARCH_REVIEW_INDEX_ENABLED=false
AI_SEARCH_WORKER_ENABLED=false
AI_SEARCH_REVIEWS_ENABLED=false
AI_SEARCH_INQUIRIES_ENABLED=false
AI_SEARCH_STRUCTURED_ENABLED=false
```

1번 화면 검증에서 `$env:AI_SEARCH_REVIEW_INDEX_ENABLED='false'`처럼 설정한 터미널은 해당 값이 `.env`보다 우선한다. **새 PowerShell 터미널**에서 다음 명령을 실행하고, 모든 CLI와 백엔드에 별도의 `POSTGRES_*` 또는 `SEARCH_INDEX_SCHEMA` 오버라이드를 주지 않는다. 이 절차의 스키마는 기본 `public`이다.

먼저 검색 마이그레이션을 적용한다.

```powershell
yarn nx run '@shopping-mall/backend:migration:run'
```

복사본은 기존 9개 마이그레이션 이력을 포함한다. `SearchFoundation1791936000000`이 새로 적용되어야 한다. 실패하면 앱을 활성화하기 전에 원인을 해결한다.

그 후 같은 `backend/.env`에서 작업 생성만 활성화한다.

```dotenv
AI_SEARCH_REVIEW_INDEX_ENABLED=true
AI_SEARCH_WORKER_ENABLED=false
AI_SEARCH_REVIEWS_ENABLED=false
```

백엔드를 실행한다.

```powershell
yarn nx run '@shopping-mall/backend:serve'
```

`EADDRINUSE: :::4000`이면 이미 다른 백엔드 실행이 4000번 포트를 사용 중이다. 이전 백엔드를 실행한 터미널에서 `Ctrl+C`로 종료한 후 한 터미널에서만 `serve`를 실행한다. 파일 감시 실행은 서버 자식 프로세스와 watcher를 함께 유지하므로 이전 watcher도 종료해야 한다. 기동 확인은 다음 명령으로 한다.

```powershell
Invoke-RestMethod http://localhost:4000/v1/health
```

HTTP 200, `status: ok`, `checks.database: ok`, `checks.redis: ok`가 정상이다. 이미 정상 실행 중인 서버가 있으면 해당 실행을 유지하며 화면 테스트를 진행한다.

기존 프론트엔드는 로컬 백엔드 `http://localhost:4000/v1`로 연결한다. 브라우저에서 다시 로그인하거나 화면을 새로고침한다. 복사한 일반 구매자 계정과 구매 확정 주문을 사용할 수 있다. 체험 계정은 수정·삭제가 제한된다. 수정 대상 리뷰는 작성 후 30일 이내여야 한다.

## 3. 리뷰 저장과 색인을 단계별로 확인

자동 처리 플래그가 false이므로 리뷰 저장은 작업만 등록한다. **리뷰를 저장한 다음**, 백엔드가 실행 중인 터미널과 별도의 새 터미널에서 수동 처리한다.

```powershell
yarn nx run '@shopping-mall/backend:search:work' --apply --limit=1
```

`--apply`는 실제 작업 처리를 뜻하고 `--limit=1`은 작업을 최대 1개 처리한다는 뜻이다. 한 작업에 여러 청크가 있으면 임베딩 요청은 여러 번 발생할 수 있다. `AI_SEARCH_WORKER_ENABLED=false`는 스케줄러를 끄는 설정이며, 이 명시적인 수동 명령은 실행할 수 있다.

처리기는 특정 리뷰 ID를 지정하지 않고 먼저 실행할 수 있는 작업을 점유한다. 아래 검증은 한 번에 한 리뷰만 저장·수정하고 처리한다. 일괄 등록 `search:backfill`은 실행하지 않는다. 출력의 `reviewId`, `version`, `status`를 확인한다.

| 동작 | 수동 처리 전 | 수동 처리 후 |
|---|---|---|
| 짧은 본문으로 새 리뷰 작성 | 해당 리뷰 버전 1 작업 `pending`, 청크 없음 | 출력 `done`, 작업 `done`, 버전 1 청크 생성 |
| 위 리뷰의 본문만 수정 | 원본·새 작업 버전 2, 작업 `pending`; 기존 청크는 버전 1 | 출력 `done`, 새 본문의 버전 2 청크 |
| 위 리뷰의 별점만 수정 | 원본·새 작업 버전 3, 작업 `pending` | 출력 `reused`, 작업 `done`, 청크 버전 3; 새 임베딩 요청 없음 |
| 위 리뷰 삭제 | 삭제 직후 원본·작업·청크 제거 | 처리 명령 불필요 |

본문에는 `팔 부분이 조여서 불편합니다. test@example.com, 010-1234-5678` 같은 합성 문구를 사용할 수 있다. 저장된 청크 텍스트에서 이메일·전화가 마스킹되는지 확인한다. CLI는 마스킹된 테스트 리뷰를 실제 Gemini API에 보내므로 키와 호출 가능 쿼터가 필요하다.

작업 상태를 확인할 때는 다른 터미널에서 DB 콘솔을 연다.

```powershell
docker compose -f docker-compose.search.yaml exec postgres-search psql -U search_probe -d shopping_mall_search_manual
```

아래 `123`을 방금 테스트한 리뷰 ID로 바꿔 각 동작 뒤 실행한다. 새 리뷰 ID는 작성 응답 또는 `search:work` 출력의 `reviewId`에서 확인한다.

```sql
SELECT id, search_version
FROM reviews WHERE id = 123;

SELECT id, source_version, status, chunk_count, error_code
FROM search_index_jobs
WHERE review_id = 123 ORDER BY source_version;

SELECT source_version, chunk_index, vector_dims(embedding) AS dimensions, text
FROM review_search_chunks
WHERE review_id = 123 ORDER BY chunk_index;
```

색인 완료 뒤 차원은 768이어야 한다. 별점 변경 때 CLI 출력은 `reused`지만 DB 작업 상태는 `done`이다. 리뷰 삭제 뒤 세 조회 모두 0행이어야 한다. DB 콘솔 종료는 `\q`다.

`idle`은 실행 가능한 작업이 없다는 뜻이다. 리뷰 저장 여부, 앱·CLI의 DB 연결 일치, 환경변수 오버라이드 여부와 SQL의 작업 상태를 확인한다. `failed`와 `errorCode`가 나오면 성공으로 처리하지 않는다.

## 4. 검증 종료

백엔드를 종료한 뒤 `backend/.env`의 DB 접속값을 원래 값으로 복원한다. 현재 기록의 원래 포트는 15432, DB는 `sangmoon`이며 사용자·암호는 직접 보관한 원래 값을 사용한다. 검색 플래그는 모두 false로 돌리고 새 터미널에서 백엔드를 재시작한다. 테스트 DB는 원본과 별도로 남아 있으며 이 절차에서 자동 삭제하지 않는다.

현재 의미 검색·관리자 채팅 연결은 다음 단계다. 이 검증의 완료 조건은 브라우저의 저장 → 작업 생성 → 색인·재사용·삭제 확인이며, 관리자 채팅의 검색 결과 개선을 확인하는 절차는 아니다.

## 현재 로컬 준비 완료 기록

2026-10-13. `backend/.env`의 DB 이름을 바꾼 뒤 `3D000: database does not exist`가 발생하여, 누락된 DB 생성·복원을 에이전트가 수행했다. `.env`의 DB 이름 지정이나 TypeORM 마이그레이션은 PostgreSQL DB 자체를 생성하지 않는다.

- `15433 / shopping_mall_search_manual`을 새로 생성하고 `15432 / sangmoon`의 덤프를 복원했다. 복원 직후 기존 34개 테이블의 건수가 모두 일치했다.
- 복사본의 사용자 30명, 상품 352건, 주문 393건, 리뷰 1,863건을 확인했다. 기존 로그인·주문 데이터가 복사되었다.
- Nx `migration:run`으로 `SearchFoundation1791936000000`을 적용했다. 복사본의 마이그레이션은 9개에서 10개로 늘었고 pgvector 0.8.7·768차원 프로필·검색 테이블·원본 버전 컬럼을 확인했다.
- 작업·리뷰 청크·문의 청크는 모두 0건이다. 기존 데이터 일괄 색인이나 외부 API 호출은 실행하지 않았다.
- 원본 `sangmoon`은 마이그레이션 9개, 검색 테이블·리뷰 버전 컬럼 없음, 기존 원본 건수 유지 상태를 확인했다.
- 실제 실행의 덤프는 Git에서 제외된 `tmp/search-manual/search-manual-4f44fdb412ed4a96bcab3f5057f68db7.dump`에 보관했다. 위 재현 명령의 `$env:TEMP` 경로와 구분한다.

현재 환경에서는 **DB 복사·생성·복원과 최초 마이그레이션을 반복하지 않고**, 2절의 작업 생성 플래그 설정·백엔드 재시작부터 진행한다. 마이그레이션 명령을 다시 실행하면 적용할 새 마이그레이션이 없는 상태가 정상이다.

## 사용자 수동 검증 완료 기록

2026-10-13. 사용자가 실제 브라우저에서 리뷰 1873을 작성·본문 수정·별점 수정하고 각 동작 뒤 Nx 수동 처리 명령을 실행했다. 제공한 출력은 다음과 같다.

| 동작 | 작업 ID | 원본 버전 | 출력 상태 | 결과 |
|---|---|---|---|---|
| 작성 | 1 | 1 | `done` | 통과 |
| 본문 수정 | 2 | 2 | `done` | 통과 |
| 별점만 수정 | 3 | 3 | `reused` | 통과 |
| 삭제 | — | — | 원본·작업·청크 각각 0행 | 통과 |

삭제 결과는 에이전트가 `shopping_mall_search_manual`에서 리뷰 ID 1873을 대상으로 읽기 전용 SQL로 확인했다. 실행 결과와 근거 구분은 [수동 검증 JSON](../../backend/eval/results/search-manual-review-1873-2026-10-13.json)에 저장했다. 리뷰 색인의 실제 화면 → API 저장 → 작업 처리 경로와 삭제 후 연쇄 제거를 확인한 **4/4 사례**다.

사용자가 제공한 Nx 실행 시간은 작성 처리 42초, 본문 수정 처리 3초, 별점 변경 처리 2초다. CLI 기동과 처리를 포함한 초 단위 표시이며 순수 임베딩 시간·HTTP 저장부터 검색 가능 시간·P95로 해석하지 않는다. 해당 실행의 요청 수·usage는 출력에 없어 미측정으로 기록했다. 삭제된 청크의 마스킹 텍스트·차원은 이 사후 조회에서 직접 확인할 수 없으며 기존 자동 검증·합성 파일럿과 구분한다.
