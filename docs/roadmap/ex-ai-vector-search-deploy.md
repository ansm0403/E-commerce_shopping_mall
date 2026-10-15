# 관리자 AI 의미 검색 — 운영 배포 기록과 초기 색인 절차

2026-10-14 KST. [설계](./ex-ai-vector-search.md) 1~4단계와 [평가·보완](./ex-ai-vector-search-portfolio-ready.md)을 운영 EC2 에 올린 기록이다. 기능 플래그는 모두 꺼진 채 배포했고, 초기 색인은 임베딩 무료 한도 때문에 이틀에 나눠 진행한다.

## 1. 배포 전 확인한 운영 상태

| 항목 | 값 |
|---|---|
| PostgreSQL | **18.6**, Alpine 3.24.1, JIT 툴체인 LLVM 21 (`pg_config --configure` 의 `CLANG=clang-21`) |
| 데이터 | 리뷰 1,819 · 문의 16 · DB 13MB, 볼륨 `/mnt/postgres-data → /var/lib/postgresql` |
| 메모리·디스크 | 1.9GB 중 가용 1.1GB · 루트 7.1GB 여유 |
| 백엔드 | `ansmoon/shopping-mall-backend:role-demo-3cf48c4`, `.env` 에 AI_SEARCH 플래그 없음(전부 기본 off) |
| Gemini 키 | 로컬과 같은 프로젝트(키 해시 비교). 임베딩 무료 한도를 로컬과 **공유**한다 |

로컬 pgvector 이미지는 PostgreSQL 18.3·LLVM 19 기준이었다. 운영 데이터 디렉터리를 낮은 마이너 버전으로 내리지 않도록 운영 이미지와 같은 기반 digest 로 다시 빌드했다.

## 2. 배포 순서와 결과

1. **백업**: `pg_dump -Fc` → 서버 `~/db-backups/pre-pgvector-20261014-2005.dump`, 로컬 `fullstack/db-backups/20261014-2005/`(34개 테이블 데이터).
2. **pgvector 이미지**: `docker/postgres-vector/Dockerfile` 에 `POSTGRES_IMAGE`·`LLVM_VERSION` 빌드 인자를 추가하고 운영 기반 digest(`postgres:18-alpine@sha256:d3e1620b…`)·LLVM 21 로 빌드해 `ansmoon/postgres-vector:18.6-0.8.7`(digest `sha256:bdf252ee…`)로 푸시했다.
3. **리허설**: 백업을 새 이미지의 임시 컨테이너에 복원하고 실제 `SearchFoundation` 마이그레이션을 실행했다. 확장 0.8.7 생성, 신규 테이블 생성, 리뷰·문의 건수 보존, 마이그레이션이 만든 색인 작업 0건을 확인했다.
4. **백엔드 이미지**: main `7d099b6`(PR #71 포함)의 깨끗한 worktree 에서 빌드·푸시했다(`APP_VERSION=7d099b6`).
5. **운영 교체**(2026-10-14 20:23~20:24 KST, 서비스 중단 약 1분 30초): 서버 compose·`.env` 백업(`*.bak-20261014`) → 새 compose 업로드, `.env` 의 `BACKEND_IMAGE`·`APP_VERSION` 을 `7d099b6` 로 → backend 중지 → 같은 볼륨으로 postgres 재생성(healthy, 18.6, 건수 동일) → `migrate.js`(SearchFoundation 1건) → `migrate.js check` → backend 기동(healthy) → `nginx -t && nginx -s reload`.
6. **확인**: `/v1/health` 200·version `7d099b6`, 상품·카테고리 200, 관리자 어시스턴트 POST 무토큰 401, Vercel 프록시 `/api/products` 200, 확장 0.8.7, 색인 작업 0.

되돌리기는 `.env.bak-20261014`·`docker-compose.prod.yaml.bak-20261014` 로 되돌린 뒤 `up -d` 다. 신규 테이블은 기존 기능이 쓰지 않으므로 남겨 둬도 된다. 데이터 문제 시 위 백업으로 복원한다.

### 겪은 문제

- **LLVM 버전 불일치**: 운영 18.6 이미지는 LLVM 21 로 빌드돼 `clang19`·`llvm19-dev` 패키지가 없었다. 빌드 인자로 분리했다.
- **로컬 디스크 100%**: 백엔드 이미지 빌드 중 C 드라이브 여유가 213MB 가 되어 Docker 엔진 연결이 끊겼다(`error reading from server: EOF`). Yarn 전역 캐시(5.1GB, 이 저장소는 `enableGlobalCache: false` 라 무관)와 `frontend/.next`(1.3GB)를 지우고 다시 빌드했다.
- **Windows 경로 길이**: 긴 결과 파일명 때문에 깊은 경로의 worktree 생성이 실패했다. `git -c core.longpaths=true worktree add` 로 해결.
- **머지된 PR 에 푸시**: PR #71 이 머지된 뒤 같은 브랜치에 푸시한 인프라 커밋은 PR 에 들어가지 않아 새 브랜치·PR #72 로 옮겼다.

## 3. 초기 색인 — 무료 한도로 이틀에 나눠 진행

임베딩 무료 한도는 프로젝트당 하루 1,000건(`EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier`)이고 다음 날 오전 9시(KST) 무렵 풀린다. 운영 원본은 약 1,835건(리뷰 1,819 + 문의 16)이다.

> **워커를 켜면 5분 안에 전체가 등록된다.** 5분마다 도는 reconcile 이 작업 기록이 없는 원본을 모두 "누락"으로 등록하기 때문이다. 별도의 backfill 명령이 필요 없지만, 한도를 넘는 부분은 재시도 5회 뒤 `failed` 로 끝난다. 운영 이미지에는 `retry-failed` CLI(ts-node 스크립트)가 없으므로 아래 SQL 로 같은 일을 한다.
>
> 로컬에서 시연·평가를 하는 날에는 로컬도 같은 한도를 쓴다. 로컬 시연을 먼저 하거나 운영 화면으로 시연한다.

**1일차 (한도 회복 후)**

1. 서버 `.env` 에 추가하고 backend 를 재생성한다. 검색 플래그(`AI_SEARCH_REVIEWS_ENABLED`·`AI_SEARCH_INQUIRIES_ENABLED`)는 아직 켜지 않는다.
   ```dotenv
   AI_SEARCH_REVIEW_INDEX_ENABLED=true
   AI_SEARCH_INQUIRY_INDEX_ENABLED=true
   AI_SEARCH_WORKER_ENABLED=true
   ```
   ```bash
   cd ~/Shopping-mall && docker compose -f docker-compose.prod.yaml up -d --no-deps backend
   ```
2. 5분 안에 reconcile 로그(`{"source":"review","queued":…}`)를 확인한다. 워커는 분당 10건(`AI_SEARCH_EMBEDDING_RPM` 기본값)으로 처리하므로 1,000건까지 약 100분 걸린다.
3. 진행 확인:
   ```sql
   SELECT CASE WHEN review_id IS NOT NULL THEN 'review' ELSE 'inquiry' END kind, status, error_code, count(*)
   FROM search_index_jobs GROUP BY 1,2,3 ORDER BY 1,2;
   ```

**2일차 (한도 회복 후)** — 한도 때문에 실패한 현재 버전 작업만 대기로 되돌린다. CLI `retryFailed` 와 같은 갱신이다.

```sql
UPDATE search_index_jobs j SET status='pending', attempts=0, next_run_at=clock_timestamp(), completed_at=NULL,
  error_code=NULL, lease_token=NULL, lease_expires_at=NULL
FROM reviews r WHERE j.review_id=r.id AND j.source_version=r.search_version
  AND j.profile_id='gemini-embedding-2-768-review-inquiry-v1' AND j.status='failed' AND j.error_code='EMBEDDING_RATE_LIMIT';

UPDATE search_index_jobs j SET status='pending', attempts=0, next_run_at=clock_timestamp(), completed_at=NULL,
  error_code=NULL, lease_token=NULL, lease_expires_at=NULL
FROM inquiries i WHERE j.inquiry_id=i.id AND j.source_version=i.search_version AND i.is_secret=false
  AND j.profile_id='gemini-embedding-2-768-review-inquiry-v1' AND j.status='failed' AND j.error_code='EMBEDDING_RATE_LIMIT';
```

**완료 후**: 위 진행 확인에서 `pending`·`running`·`failed` 가 0 이면 검색 플래그를 켜고 backend 를 재생성한다.

```dotenv
AI_SEARCH_REVIEWS_ENABLED=true
AI_SEARCH_INQUIRIES_ENABLED=true
```

그 뒤 관리자 계정으로 리뷰·문의 의미 검색을 한 번씩 확인하고 이 문서에 결과를 기록한다. 결제를 연결하면 위 이틀 절차 없이 1일차에 끝난다.
