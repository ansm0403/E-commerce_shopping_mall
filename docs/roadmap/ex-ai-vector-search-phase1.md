# 관리자 AI 검색 1단계 구현·검증 기록

설계: [ex-ai-vector-search.md](./ex-ai-vector-search.md). 검증일: 2026-10-13 KST.

## 구현 범위

PostgreSQL 18.3 Alpine + pgvector 0.8.7 이미지, 격리된 검증 DB, 명시적으로 등록한 마이그레이션, 검색 프로필과 엔티티, 전처리와 임베딩 클라이언트, 실제 SDK 파일럿 및 기존 최근순 조회 기준선을 구현했다. 리뷰 색인 처리기와 `summarize_reviews(query)` 연결은 다음 단계다.

검색 엔티티는 아직 앱의 `TypeOrmModule.forFeature`에 등록하지 않았다. 원본 `search_version`은 마이그레이션으로 추가했고 작업·청크 엔티티의 버전은 손실 없는 문자열로 다룬다. 원본 엔티티 매핑·버전 증가·트랜잭션 작업 생성은 DB 전환 후 2단계에서 함께 연결한다. TypeORM은 `insert: false`여도 default가 있는 컬럼을 INSERT의 RETURNING에 포함하므로, 기존 DB에 없는 버전 컬럼을 미리 원본 엔티티에 추가하면 일반 저장이 깨질 수 있다. 현재 단계에서 다른 마이그레이션을 자동 생성하면 미매핑된 원본 버전 컬럼 제거를 제안할 수 있으므로 2단계 매핑 전에 생성 결과를 그대로 적용하지 않는다. 현재 CLI 마이그레이션은 새 엔티티를 발견하므로 반드시 pgvector가 설치된 DB에 실행한다.

프로필의 모델·768차원·마스킹·분할 버전과 입력 형식은 고정한다. 변경 시 기존 `INITIAL_SEARCH_PROFILE`을 수정하지 않고 새 프로필·필요한 스키마 마이그레이션을 추가한다. 활성화 플래그는 프로필 밖에 있으며 기본 false다. 임베딩 클라이언트는 프로필 ID·모델·차원 불일치를 거절한다. 초기 요청 상한은 인스턴스당 분당 10회이고, SDK 자체 재시도를 끄며 후속 작업 처리기가 재시도를 맡는다. 토큰 사용량이 제공되지 않으면 null로 남긴다.

## 재현 명령

아래 명령은 1단계 자동 검증이다. 브라우저의 실제 리뷰 저장과 색인 연결을 확인하려면 [수동 검증 절차](./ex-ai-vector-search-manual-test.md)의 DB 복사·접속 설정·마이그레이션·수동 처리를 진행한다.

2026-10-13 후속 설정 수정: Node가 TypeScript 설정을 직접 로딩하면 기존 `jest.config.ts`가 ES 모듈로 읽혀 `__dirname` 오류가 발생했다. `backend/jest.config.cjs`로 전환하고 Nx의 테스트 입력·출력 경로를 `/`로 명시해 해결했다. 아래 명령은 별도 우회 환경변수 없이 실행한다. Windows Node 22.13.0에서 선택한 2개 파일의 32/32 통과를 확인했고, `--experimental-strip-types`를 켜서 오류를 재현했던 환경에서도 백엔드 전체 48개 파일, 610/610이 통과했다. [전체 원본 결과](../../backend/eval/results/jest-config-native-types-2026-10-13.json)를 보존했다. `.cjs`는 [Jest 설정](https://jestjs.io/docs/configuration)과 [Nx Jest 플러그인](https://nx.dev/docs/technologies/test-tools/jest/introduction)이 지원하는 형식이다.

워크스페이스 루트에서 실행한다. Nx MCP가 현재 세션에 노출되지 않아 Nx CLI로 프로젝트 구성을 확인했다.

```powershell
yarn nx run '@shopping-mall/backend:search:db:up'
yarn nx run '@shopping-mall/backend:search:db:verify'
yarn nx run '@shopping-mall/backend:search:baseline'
yarn nx run '@shopping-mall/backend:search:pilot'
yarn nx run-many -t typecheck search:typecheck -p '@shopping-mall/backend'
yarn nx run '@shopping-mall/backend:test' --runInBand --runTestsByPath src/search/search-document.spec.ts src/intrastructure/ai/providers/gemini-embedding.client.spec.ts
```

검증 DB는 `127.0.0.1:15433`, 사용자·암호 `search_probe`, DB `shopping_mall_search_probe`이며 별도 Compose 프로젝트·볼륨을 쓴다. 기존 `15432`의 앱 DB를 교체하지 않는다. `SEARCH_TEST_POSTGRES_PORT`로 검증 명령의 포트만 바꿀 수 있다. Compose의 포트도 함께 맞춰야 한다.

파일럿만 `backend/.env`의 `GEMINI_API_KEY`를 사용해 합성 문구를 전송한다. 키·벡터·원본 응답을 결과 파일에 저장하지 않는다. 파일럿은 한국어 질문, 독립된 두 문서, 여러 청크로 나뉜 한국어·이모지를 확인한다. 각 응답은 768개 유한 숫자·비영 벡터이며 자동 정규화 검사는 L2 노름 오차 0.001 이내다. 기록되는 시간에는 RPM 제한의 대기가 포함된다.

## 확인한 기존 DB의 데이터 위치

2026-10-13 로컬 `shopping_mall-postgres-1`에서 읽기 전용으로 확인했다.

| 항목 | 관측값 |
|---|---|
| PostgreSQL | 18.3, x86_64, Alpine/musl |
| 기반 이미지 digest | `sha256:52098013b4b64a746626437d38afc03cabff6cdeb4d3d92e2342aa95f0ce56ea` |
| `SHOW data_directory` | `/var/lib/postgresql/18/docker` |
| 데이터를 보관한 마운트 | 익명 볼륨 → `/var/lib/postgresql` |
| Compose의 개발 볼륨 | `shopping_mall_postgres_dev_data` → `/var/lib/postgresql/data` |
| 기존 이미지의 pgvector | `pg_available_extensions`에 없음 |

실제 데이터는 개발 볼륨의 `/data` 경로가 아닌 부모 마운트에 있다. `docker compose up --force-recreate` 전에 현재 부모 마운트의 볼륨을 명시적으로 보존해야 한다. PostgreSQL 18의 버전별 PGDATA와 부모 디렉터리 마운트는 [공식 이미지 설명](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata)을 기준으로 확인했다. 이번 작업에서는 기존 컨테이너·볼륨·원본 DB를 변경하지 않았다.

## 기존 DB 전환 순서

1. 실제 대상 컨테이너의 PostgreSQL 버전, `SHOW data_directory`, `.Mounts`, 기반 이미지·콜레이션을 다시 확인한다. 위 로컬 결과를 운영 DB의 상태로 가정하지 않는다.
2. 검증된 이미지로 백업 복원 리허설을 수행한다. 논리 백업은 `pg_dump -Fc -f`를 사용하고 컨테이너에서 파일로 만든 뒤 `docker cp`로 복사한다. PowerShell 텍스트 리다이렉션으로 바이너리 덤프를 저장하지 않는다.
3. Compose의 PostgreSQL 이미지에 `shopping-mall/postgres-vector:18.3-0.8.7`을 지정한다. 데이터를 보관한 현재 볼륨을 `external: true`와 실제 `name`으로 선언해 `/var/lib/postgresql`에 연결한다. `/var/lib/postgresql/data`만 가리키는 기존 개발 마운트로 대체하지 않는다. 운영 호스트 디렉터리는 실제 경로를 유지한다.
4. 백업과 마운트 설정을 확인한 뒤 쓰기를 중단하고 DB 컨테이너를 전환한다. 새 컨테이너의 `SHOW data_directory`, 원본 테이블 수·행 수·콜레이션을 확인한다. 컨테이너 재생성만으로 원본 데이터 보존이 검증되는 것은 아니다.
5. 같은 DB 접속 설정으로 `yarn nx run '@shopping-mall/backend:migration:run'`을 실행한다. 프로필·버전·파생 테이블과 `<=>` 거리 쿼리를 확인한다. 확장 설치 권한이 없으면 DB 관리자 계정으로 확장을 먼저 설치한다.
6. 2~3단계의 원문 변경·색인·검색 검증과 초기 색인 완료 후 리뷰 기능만 활성화한다. 문의·정형 조회는 별도 단계의 완료 조건을 따른다.

첫 되돌리기는 기능 플래그 비활성화다. 신규 마이그레이션의 `down`은 파생 테이블·새 버전 컬럼만 제거하고 `vector` 확장은 남긴다. 이전 원문 값은 변경하지 않으며 확장을 연쇄 삭제하지 않는다.

## 측정 자료와 한계

개선용 fixture는 합성 리뷰 100건과 질문 20개다. 10개 문제 유형의 오래된 불만 원문·최근 긍정/무관 원문으로 최근순 조회의 한계를 재현한다. 표현 변경 두 질문은 같은 개선용 그룹에만 둔다. 정답은 유형마다 한 원문으로 라벨링했고, 높은 별점의 불만도 포함했다. 모든 자료는 개선용이며 분리된 최종 평가 30문항은 아직 만들지 않았다.

`search:baseline`은 임시 테이블에서 기존 상품·별점 필터와 최근 5건 정책을 실행한다. 임베딩·LLM 호출은 없고 반환 원문 ID로 Hit@5·Recall@5·Precision@5를 계산한다. 첫 기준선은 20문항 모두 오래된 근거가 최근 5건 밖에 있어 세 지표가 0이다. 이는 의도적으로 구성한 합성 자료의 관측값이며 실제 고객 자료의 정확도나 벡터 도입 효과가 아니다. 벡터 검색과 답변 성공률은 아직 미측정이다.

JSON 원본은 `backend/eval/results/search-baseline-*.json`, `search-pilot-*.json`에 보존한다. 검색 정확도와 답변 성공률·SLA·비용 절감 성과는 아직 주장하지 않는다. SDK의 검색용 접두사와 독립 입력 처리 규격은 [Gemini 공식 임베딩 문서](https://ai.google.dev/gemini-api/docs/embeddings?hl=en), 확장 빌드·정확 검색은 [pgvector 공식 소스](https://github.com/pgvector/pgvector)와 대조했다.

## 실행 결과

| 검증 | 결과 |
|---|---|
| 마스킹·분할·응답 검사와 일반 리뷰·문의 회귀 | 4개 테스트 파일, 43/43 통과 |
| 실제 PostgreSQL 제약·TypeORM 벡터 왕복·버전 배제·연쇄 삭제·되돌리기 | 5/5 통과 |
| 전체 마이그레이션 등록 배열 | 격리 DB에 초기화부터 신규 검색 마이그레이션까지 10개 적용 성공 |
| 실제 Gemini 파일럿 | 3/3 사례 통과, 외부 요청 6회, 모든 벡터 768차원, L2 노름 오차 0.001 이내 |
| 백엔드 및 검색 평가 코드 타입 검사 | 통과 |
| 백엔드 빌드 | 성공, 마이그레이션 번들 포함. Nx lockfile 축소 경고는 아래 참조 |

파일럿의 확장된 최종 실행은 [search-pilot-2026-10-12T23-53-23-140Z.json](../../backend/eval/results/search-pilot-2026-10-12T23-53-23-140Z.json), 기존 조회 기준선은 [search-baseline-2026-10-12T23-52-01-350Z.json](../../backend/eval/results/search-baseline-2026-10-12T23-52-01-350Z.json)이다. 파일 이름의 시각은 UTC이며 실행일의 KST 날짜는 2026-10-13이다.

Nx 빌드가 `@nestjs/typeorm@*`를 축소 lockfile에서 찾지 못한다는 경고를 출력하고 루트 lockfile로 fallback했다. 번들은 정상 생성됐지만, 이 결과는 운영 컨테이너 패키징 검증까지 완료했다는 뜻이 아니다. 전체 lint에는 기존 코드의 경고가 남아 있으며 오류는 없었다.
