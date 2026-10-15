# 화면 밖의 API 경계 재점검 — 보안 설계

작성일: 2026-10-15. **상태: §4 구현 순서 0~4단계 코드 완료(2026-10-16). 3단계는 운영 배포됨(`eb4829c`, 흔적 없음), 4단계(시나리오 A~D + `forbidNonWhitelisted`)는 PR·운영 배포 대기.** 분모와 대조표는 [ex-security-api-surface.md](./ex-security-api-surface.md).
결함은 코드를 읽어서 찾은 뒤 2026-10-15 에 실제 HTTP 요청으로 재현했다(§2 셀러 신청 행, §4 단계 1). `○` 로 표시한 수치는 측정 후 채운다.

> 표기 원칙(2026-10-15 검토): 결함은 **1건**(요청 본문을 그대로 믿는 지점)이고, 재현한 변조 **경로가 4개**다. "결함 4건" 으로 쓰지 않는다.
> 객체·역할 경계는 4단계 시나리오 A·B 가 돌기 전까지 **코드 검토 수준**이다 — "빈틈은 필드 경계 한 곳" 은 그 뒤에만 쓴다.

## 0. 배경과 질문

2026년 10월 국내 금융권에서 AI 에이전트를 이용한 것으로 추정되는 해킹이 보도됐다. 보도에서 얻은 교훈은 세 가지다.

1. 공격 도구는 화면에서 API 주소만 수집하고, 그다음부터는 화면을 거치지 않는다.
2. 피해는 주로 권한 검증 미흡과 입력값 변조에서 나왔다.
3. 연 1~2회 정기 점검으로는 쉬지 않고 시도하는 공격 속도를 따라가지 못했다.

> 사건의 세부 수법, 도구 이름, 수치는 원문 기사로 확인하기 전까지 이 문서와 이력서에 인용하지 않는다.

이 교훈을 우리 서비스에 옮긴 질문은 두 가지다.

- 화면을 거치지 않는 요청에서도 권한 경계가 지켜지는가?
- 그 사실을 한 번이 아니라 매번 확인하고 있는가?

## 1. 위협 모델과 범위

- **공격자:** 정상 가입한 구매자나 셀러 계정을 갖고 있다. 우리 화면이 보내지 않는 요청을 API로 직접 보낼 수 있다.
- **지킬 경계 두 가지:**
  - **객체 경계:** 남의 주문, 리뷰, 상품 같은 남의 데이터를 읽거나 바꿀 수 없어야 한다.
  - **필드 경계:** 상태, 소유자, 식별자처럼 서버가 정해야 하는 값을 요청으로 바꿀 수 없어야 한다.
- **범위 밖:** 인증 우회, 인프라 침투, 속도 제한과 탐지는 §8 후보로 남긴다. 클라이언트 은닉은 §5에서 하지 않는 이유를 적는다.

## 2. 현재 상태

| 항목 | 확인한 동작 | 위치 |
| --- | --- | --- |
| 객체 경계 | 주문, 리뷰, 문의, 장바구니, 셀러 상품, 셀러 문의, 정산, 결제가 서비스에서 소유자를 대조한다. 코드 기준으로는 빈틈을 찾지 못했다. | 각 `*.service.ts` |
| 전역 입력 검증 | (3단계 전) `ValidationPipe` 에 `whitelist` 가 없었다. DTO에 없는 필드도 그대로 통과했다. **3단계(2026-10-16)에서 `whitelist: true` 를 켰다** — 켜기 전에 `scripts/security/check-dto-decorators.mjs` 로 @Body/@Query 클래스 43개의 모든 속성에 class-validator 데코레이터가 있음을 확인(버려질 정상 필드 0). `forbidNonWhitelisted` 는 4단계. | `backend/src/main.ts` |
| 셀러 신청 | 받은 본문을 엔티티에 통째로 펼쳐 넣는다. 첫 신청은 `create({ userId, ...dto })`, 재신청은 `update(id, { ...dto, ... })` 이다. **HTTP 재현 완료(2026-10-15, `backend-e2e/src/security/seller-apply-field-boundary.e2e.spec.ts`, 전부 201):** ① `status:'approved'`·`approvedAt` 이 그대로 저장돼 `/seller/me` 가 approved ② `userId` 로 **남의 계정**에 신청 행 생성(공격자 행은 없음) ③ `id` 로 **남의 승인된 셀러 행을 UPDATE** — 소유자·상호·사업자번호·계좌가 공격자 값으로 바뀌고 승인 상태는 유지되어 승인 없이 승인 셀러가 되며 정산 계좌가 가로채진다 ④ 재신청은 status·rejectionReason·approvedAt 은 서버가 다시 쓰지만 `userId` 는 통과해 행이 남의 계정으로 이동. 수정 뒤 허용 결과는 "400+DB 불변" 또는 "201+서버값만 저장" 둘 다로 스펙에 적어, 단계 3(버리기)과 4(거절) 모두의 통과 기준이 된다. | `backend/src/seller/seller.service.ts:49`, `:40` |
| 다른 쓰기 서비스 | 상품, 리뷰, 문의, 프로필, 회원가입은 필드를 골라 복사한다. | `product.service.ts:236`, `review.service.ts:81` 등 |
| 선례 | 데모 체크아웃 한 곳만 `whitelist + forbidNonWhitelisted` 를 쓴다. | `demo-checkout.controller.ts:33` |
| 주석과 설정 불일치 | ops 리뷰 DTO 주석은 "모르는 키는 whitelist 로 떨어진다"고 적었지만, 전역 whitelist 는 꺼져 있다. | `backend/src/ops/dto/review.dto.ts:52` |
| CI | (단계 2 전) lint, 단위 테스트, 빌드만 실행했다. HTTP 테스트(`backend-e2e`, 스펙 8개)는 이미 떠 있는 서버를 전제해서 CI에서 실행되지 않았다. **그 결과 main 의 8개 스펙 중 2건이 3cf48c4(역할 데모) 뒤 갱신되지 않은 채 깨져 있었다**(무셀러 상품 주문이 400 으로 바뀐 규칙, 데모 로그인 403 메시지 변경). 보안 결함이 아니라 **점검 공백의 증거**다 — 돌지 않는 테스트는 낡는다. 단계 2 에서 `security-e2e` job 을 추가했다. | `.github/workflows/ci.yml`, `backend-e2e/src/support/global-setup.ts` |
| 단위 테스트가 놓친 사례 | 재사용 감지 테스트는 통과한다. 하지만 "Redis에서는 유효, DB에서는 폐기"라는 현실에서 나올 수 없는 상태를 가정한다. 운영에서는 Redis 검사에서 먼저 일반 401로 끝나서, 감지 분기가 실행되지 않는다. | `auth.service.spec.ts:425` ↔ `auth.service.ts:458` |

## 3. 보완 ① 필드 경계: 정의되지 않은 필드 거절

### 결정

1. **전역 `ValidationPipe` 에 `whitelist: true` 와 `forbidNonWhitelisted: true` 를 켠다.**
   - 모르는 필드를 조용히 버리는 방식만 쓰면, 공격 시도도 클라이언트 버그도 보이지 않는다.
   - 400으로 거절하면 프론트가 여분의 필드를 보내는 곳이 바로 드러난다.
   - 다만 정상 요청이 깨질 위험이 있으므로, 아래 단계처럼 버리는 방식을 먼저 켜고 그다음에 거절로 올린다.
2. **셀러 신청 서비스의 스프레드를 없애고 필드를 골라 복사한다.**
   - 다른 쓰기 서비스와 같은 방식이다.
   - 파이프 설정이 어떤 이유로 빠지더라도 서비스가 경계를 지키는 이중 방어가 된다.

### 회귀 위험과 대응

| 위험 | 내용 | 대응 |
| --- | --- | --- |
| 동적 키 DTO | 페이지네이션 DTO가 `[key: string]: any` 로 `where__*` 키를 받는다(`common/dto/paginate.dto.ts:146`). whitelist 를 켜면 이 키가 버려지거나 400이 된다. | 웹 프론트의 `where__`/`order__` 사용처는 0건이다(grep 확인). 운영 앱과 서버 내부 사용처를 확인한다. 사용처가 없으면 인덱스 시그니처를 지우고, 있으면 그 DTO만 명시 필드로 바꾼다. |
| 데코레이터 없는 속성 | whitelist 는 class-validator 데코레이터가 없는 속성을 모르는 필드로 취급한다. `@Type()`·`@Transform()`(class-transformer)만 있는 속성도 버려진다. | ✅ `scripts/security/check-dto-decorators.mjs` — 컨트롤러의 @Body/@Query 클래스 43개 + 상속 + **`@Type(() => X)` 중첩 DTO 6개**(총 49개) 전부 데코레이터 있음(2026-10-16). 처음 버전은 중첩을 안 따라갔다 — 엣지 검증에서 보강. |
| 중첩 객체 | `@ValidateNested` 와 `@Type` 이 있는 중첩 DTO 안에서도 whitelist 가 돈다(모르는 키 버림). 없는 자유 형식 객체(`@IsObject` 만)는 통째로 유지된다. | ✅ 중첩 6개 점검 포함. 웹훅 `WebhookPaymentDto.data` 는 `@ValidateNested` 라 PortOne 의 여분 키(storeId 등)가 버려지지만 서비스는 `type`·`data.paymentId`·`data.transactionId` 만 읽어 영향 없음. (별건: `WebhookDataDto.transactionId` 가 `@IsString()` 만 있고 `@IsOptional()` 이 없어 PortOne 이 그 키를 생략하면 400 — whitelist 와 무관한 기존 상태, §8 후보로 기록) |
| 서비스가 DTO 를 통째로 쓰는 곳 | `repository.create(dto)`·`Object.assign(entity, dto)`·`dto as any` 가 있으면 "선언되지 않았지만 저장되던" 키가 whitelist 뒤 사라진다. | ✅ grep 결과 0곳(카테고리 create 도 필드를 고른다). 즉 whitelist 가 버리는 키는 어떤 서비스도 읽지 않던 키다 → 동작 변화 없음. |
| 필드 선택 복사의 `undefined` | 재신청에서 선택 필드(contactEmail·contactPhone)를 생략하면 `update(id, { contactEmail: undefined })` 가 된다. | ✅ 실측(2026-10-16): TypeORM 은 `undefined` 를 건너뛰어 **기존 값 유지** — 스프레드 시절(키 없음)과 같은 동작. |
| 운영 앱 본문 | Ops Companion 의 쓰기 본문 키가 DTO 밖이면 버려진다. | ✅ `ReviewInput`(verdict·rating·comment·guided·checks) ⊆ `CreateReviewDto`, 기기 등록·로그아웃 본문도 DTO 와 일치. |
| 프론트의 여분 필드 | 화면이 DTO에 없는 필드를 습관적으로 보내면 거절 단계에서 정상 기능이 깨진다. | ✅ `scripts/security/compare-request-types.mjs` — 요청 타입 19개 + 인라인 본문 10개 ⊆ DTO(불일치 0). 실제 요청은 D 스펙 `normal-requests`(12건). |
| **쿼리 파라미터** | `forbidNonWhitelisted` 는 `@Query()` DTO 에도 적용된다 — 목록 API 에 모르는 키가 하나라도 붙으면 400. 실측: `/products?page=1&take=1&bogus=1` → 400. | ✅ 프론트가 조립하는 쿼리 키를 전부 대조: 상품 목록(page·take·sortBy·sortOrder·cursor·categoryId·sellerId·keyword·`filter[rating][gt]`) ⊆ `ProductQueryDto`, 감사 로그 8키 ⊆ `AuditLogQueryDto`, 대시보드 `startDate·endDate·compareWithPrevious`, 관리자·셀러 목록 `page·take·status·approvalStatus·categoryId·sellerId·startDate·endDate` 전부 DTO 안. D-12 가 이 키 집합 그대로 19개 목록을 호출해 200 을 고정한다. `@Query('token')` 같은 단일 값은 파이프 밖. |
| 운영 앱 | Ops Companion 의 요청 본문도 같은 파이프를 지난다. | ✅ `ReviewInput`·기기 등록·로그아웃 본문 ⊆ DTO(같은 스크립트), GET 은 쿼리 없음. |
| 웹훅 | PortOne 웹훅은 원문 본문으로 서명을 검증한다. | 본문 DTO 적용 여부를 확인하고, 웹훅 e2e로 확인한다. |
| 파이프 밖의 본문 | `@Body('필드')` 처럼 필드를 하나씩 받는 곳은 DTO 클래스가 없어서 whitelist 가 적용되지 않는다. 현재 `auth.controller.ts:128` 의 `email` 과 `order.controller.ts:133` 의 `sellerId` 두 곳이다. | 두 곳 모두 지정한 필드 하나만 읽으므로 덮어쓰기 위험은 없다. 형식 검증이 없다는 점만 기록하고, 필요하면 DTO로 바꾼다. |

### 단계

1. ✅ **재현.** 셀러 신청에 서버가 정해야 하는 필드를 포함한 요청을 보내고, DB 값이 바뀌는지 e2e로 기록한다. 이것이 수정 전 실패 기록이 된다. → PR #74 의 CI 로그(`Tests: 4 failed`)가 공식 기록.
2. ✅ 셀러 신청과 재신청을 필드 선택 복사로 바꾼다. → `seller.service.ts pickApplicantFields`. `id` 를 넣지 않으므로 `save()` 가 항상 INSERT.
3. ✅ 전역 `whitelist: true` 를 켜고, 단위 테스트와 e2e 전체 통과를 확인한다. → 로컬 9스위트 62/62(보안 스펙 4/4 통과로 전환) 2회 연속, 셀러 단위 스펙 통과. 회귀 위험표 대응: 동적 키 인덱스 시그니처 제거(어떤 클라이언트도 안 보냄, 서비스도 안 읽음), 데코레이터 점검 스크립트 0건.
4. ✅ `forbidNonWhitelisted: true` 를 켜고, §4의 D 시나리오(정상 요청) 전체 통과를 확인한다. → 2026-10-16 로컬: 거절 모드에서 14스위트 102/102 ×2(D 12건 포함). 모르는 본문 키 → `property bogus should not exist` 400, 모르는 쿼리 키 → 400.
5. ✅ ops DTO 주석이 다시 사실과 맞는지 확인한다. → `review.dto.ts` 주석에 "2026-10-16 부터 실제로 켜짐" 명시.

## 4. 보완 ② 실제 서버 테스트를 CI에 연결

### 왜 필요한가

권한 경계는 라우트, 가드, 검증 파이프, 서비스, DB가 모두 맞물려야 성립한다. 단위 테스트는 이 부품들을 가짜로 바꾸기 때문에 "내 코드가 내 가정대로 도는지"만 확인한다. §2의 재사용 감지 사례처럼, 가정 자체가 틀리면 테스트가 통과해도 기능은 죽어 있다. 셀러 신청 결함도 서비스 함수를 직접 부르는 단위 테스트로는 드러나지 않는다. 전역 파이프를 거치지 않기 때문이다.

### CI 설계

- **새 job `security-e2e`.** 기존 `ci` job 과 병렬로 둔다. `backend-e2e` 는 backend 에 암묵적으로 의존하므로 `nx affected -t e2e` 로 변경 범위에 맞춰 돈다. 워크스페이스 목록에 `frontend-e2e` 가 있지만 실제 폴더는 없어서, e2e 타깃은 `backend-e2e` 하나뿐이다.
- **서비스 컨테이너:**
  - **postgres 는 pgvector 가 있는 이미지여야 한다.** `SearchFoundation` 마이그레이션이 `CREATE EXTENSION vector` 를 실행하기 때문이다. 현재 CI의 `postgres:17-alpine` 으로는 이 단계에서 실패한다. 공개 pgvector 이미지의 18 계열을 쓴다. 운영은 자체 이미지 `ansmoon/postgres-vector:18.6-0.8.7` 이다.
  - Redis 는 기존 것을 그대로 쓴다.
- **단계 순서:**
  1. 의존성 설치
  2. shared 와 backend 빌드
  3. 마이그레이션 실행
  4. 백엔드를 백그라운드로 기동
  5. `/v1/health` 응답 대기
  6. e2e 실행
  7. 종료와 로그 업로드
- **환경 변수:** (2026-10-15 구현·로컬 재현으로 확정)
  - JWT 시크릿은 CI 전용 값을 workflow `env` 에 둔다. 운영 값과 같으면 안 된다.
  - DB, Redis, `PORT`, `FRONTEND_URL`, `CORS_ORIGINS` 를 둔다. **데모 계정 변수는 두지 않는다** — 없으면 demo-login 이 403 "비활성화" 로 끝나고 스펙이 그 분기를 탄다. 켜 두고 계정이 없으면 다른 메시지(`DEMO_UNAVAILABLE`)가 와서 스펙이 두 메시지를 모두 받게 했다.
  - 외부 키(SMTP, Sentry, Gemini, PortOne) **없이 부팅됨을 확인했다.** Gemini·Sentry API·PortOne 웹훅 검증기가 경고 로그 한 줄씩 남기고 no-op/503 으로 동작한다.
  - 부팅 시 env 검증 스키마는 없다. `FRONTEND_URL` 은 `ConfigModule` validate 가 없으면 부팅을 막고, 메일 발송 경로도 쓴다(`email.service.ts:21`). CI env 에 넣어 둔다.
  - 함정: 개발 PC 의 셸 전역 환경변수가 `backend/.env` 를 이긴다(dotenv 는 덮어쓰지 않는다). "키 없는 서버" 를 로컬에서 재현할 때는 `env -u` 로 지우고 `.env` 없는 임시 cwd 에서 띄운다.
- **전역 요청 제한:** 권장안을 적용했다 — `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` env(`app/app.module.ts`). 자릿수만 허용하고(`parseInt` 는 `1e3` 을 1 로 읽어 전역 제한을 1회로 만든다) 잘못된 값은 경고 후 기본값(60초/100회)으로 간다. CI 는 `THROTTLE_LIMIT=10000`. 실측: 2 로 띄우면 3번째 요청이 429, `.env` 파일로 줘도 반영.
  - **라우트별 `@Throttle` 오버라이드는 env 의 영향을 받지 않는다** — products·reviews 60/분, category 120/분, auth 일부 30/분. 4단계에서 시나리오가 늘면 전역이 아니라 여기에 먼저 걸린다.
  - 로그인 전용 제한(IP당 10회/5분)은 `support/login.ts` 가 429 때 Redis 키를 비워 흡수한다. **401·429 자체를 검증하는 생 요청**(예: password-change 의 옛 비밀번호 로그인)은 바로 앞에서 `resetLoginRateLimits()` 를 불러야 한다 — 9개 스펙 병렬 실행에서 401 대신 429 가 온 실측 사례.
- **헬스 체크 주소:** `/v1/health`(전역 prefix 적용, `@SkipThrottle`). DB·Redis 중 하나라도 안 되면 503 이라 `curl -f` 반복으로 대기한다.
- **마이그레이션 실행:** `node backend/dist/migrate.js` — 운영과 같은 실행기(빌드 산출물, ts-node 불필요). 설계 초안의 `migration:run` 에서 바꿨다. 빈 pgvector 18 DB 에 10건 적용 확인.
- **번들:** `build:development` 를 쓴다. 운영 번들(`--node-env=production`)은 `NODE_ENV` 가 박혀 ops simulate 경로가 꺼지고 쿠키가 Secure 가 되어 로컬 e2e 와 조건이 달라진다.
- **스펙 폴더:** `backend-e2e/src/backend/`(기존 8개, 항상 초록) · `backend-e2e/src/security/`(경계 스펙). CI 는 두 스텝으로 나눠 돌리고(`--testPathPatterns=`), 보안 스텝은 단계 3 전까지 `continue-on-error` 로 둔다 — 실패 로그는 CI 에 남고 job 은 초록. 단계 3 에서 제거.
- **시간 예산:** 로컬 재현에서 e2e 본체는 약 10초(8개 스펙 7초 + 보안 스펙 3초). job 전체(설치·빌드·마이그레이션·기동 포함)는 첫 PR 에서 측정해 §6 에 적는다. 이 값은 보안 지표가 아니라 "매 PR 마다 돌릴 수 있는가" 의 비용 지표다.

### 테스트 데이터 격리

| 환경 | DB | 계정 준비 | 청소 |
| --- | --- | --- | --- |
| CI | 실행마다 빈 서비스 컨테이너를 쓴다. 마이그레이션과 역할 부트스트랩을 거친다. | 각 스펙이 `support/db.ts` 로 자기 계정을 만든다. | 컨테이너와 함께 사라진다. 스펙의 뒷정리도 유지한다. |
| 로컬 | 개발 DB를 함께 쓴다. | 스펙마다 `e2e-<suite>-` 접두 이메일로 만든다. | 스펙 앞뒤에서 접두 기준으로 지운다(기존 규칙). |

- **로그인 속도 제한:** IP당 10회/5분 제한에 걸리지 않게 스펙 시작 때 `resetLoginRateLimits` 를 부른다.
- **병렬 실행:** jest 는 파일을 병렬로 돌린다. 스펙끼리 계정을 공유하지 않고 이름공간을 나누는 기존 규칙을 유지한다.

### 시나리오 구성

API 목록은 `frontend/src/service/*.ts` 와 운영 앱 `ops-companion/src/lib/api.ts` 가 실제로 호출하는 주소에서 뽑는다. 공격자가 화면에서 얻는 목록과 같은 목록이다.

| 묶음 | 내용 | 기대 결과 |
| --- | --- | --- |
| A 객체 경계 | 구매자가 남의 주문 조회·취소·확정, 남의 리뷰 수정·삭제, 남의 문의 삭제, 남의 장바구니 항목, 남의 결제 검증을 시도한다. 셀러가 다른 셀러의 상품 수정·상태·삭제·이미지, 다른 셀러 문의 답변, 다른 셀러 배송건, 정산을 시도한다. | 403 또는 404, DB 불변 |
| B 역할 경계 | 구매자나 셀러 토큰으로 `admin/*`, `ops/*` 를 호출한다. 데모 관리자로 쓰기 API를 호출한다. | 403 |
| C 필드 경계 | 셀러 신청·재신청, 상품 등록·수정, 리뷰, 문의, 프로필, 주문 생성 본문에 서버가 정하는 필드(상태, 소유자, 식별자, 승인 시각 등)를 포함한다. | 400, DB 불변 |
| D 정상 회귀 | 각 화면이 실제로 보내는 요청 본문을 그대로 보낸다. | 2xx |

- 모든 시나리오는 **응답 코드와 DB 상태를 함께** 확인한다. 거절 코드만 보면 "거절했지만 일부는 저장됨" 같은 경우를 놓친다.
- A와 B 중 기존 스펙(`seller-edge-cases`, `seller-inquiry` 등)이 이미 다루는 것은 새로 만들지 않고 목록에 대응만 표시한다.

### 구현 순서 (2026-10-15 설계 검토 반영)

순서를 정한 기준은 "수정 전 실패 기록을 먼저 남기고, 고치는 것은 그다음"이다.

| 단계 | 내용 | 끝났다는 증거 |
| --- | --- | --- |
| 0 ✅ | 로컬에서 기존 e2e 8개 스펙이 통과하는지 확인한다. | 2026-10-15: 첫 실행 1건 실패 — main 의 낡은 테스트 2건(§2 CI 행) 갱신 후 8스위트 58/58 |
| 1 ✅ | 셀러 신청 필드 덮어쓰기를 로컬 e2e로 재현한다(§3 단계 1). 수정 전이므로 **실패하는 테스트**로 기록한다. | 2026-10-15: 4개 경로 전부 201, DB 변조 확인(§2 셀러 신청 행). 번들 사본에 whitelist·forbid 를 패치해 **수정 뒤에는 두 모드 모두 4/4 통과**하는 테스트임도 확인 |
| 2 ✅ | CI `security-e2e` job 을 만든다. pgvector 이미지, 마이그레이션, 기동, 헬스 대기, 요청 제한 env 를 갖춘다. 기존 8개 스펙을 CI에서 먼저 초록으로 만든다. | 2026-10-15: 로컬 도커로 CI 조건 재현 58/58 → **PR #73 첫 실행 통과(job 2분 0초)**. 첫 실행 로그에는 Nx 가 jest 요약을 접어 "실패" 만 남았다 → `--output-style=stream` 추가로 `Tests:` 와 DB 값이 로그에 남게 함 |
| 3 ✅ | 셀러 신청·재신청을 필드 선택 복사로 바꾸고 whitelist(버리기)를 켠다. 단계 1 의 테스트가 통과로 바뀌는지 확인하고 CI 의 `continue-on-error` 를 뗀다. 회귀 위험표의 동적 키 DTO·데코레이터 없는 속성 점검을 여기서 미리 돈다. **운영 백엔드 배포**(수동) 뒤 운영 DB 에서 악용 흔적을 확인한다(아래 질의). | PR #75: 보안 스펙 **4 실패 → 4 통과**(CI `security-e2e` 2분 18초), 9스위트 62/62. **운영 배포 2026-10-16 01:46 KST**: 이미지 `ansmoon/shopping-mall-backend:eb4829c`(digest abb300c1…), 10-14 와 같은 절차(.env 백업 → `BACKEND_IMAGE`·`APP_VERSION` 교체 → pull → `migrate.js check` 변경 없음 → backend 만 재생성, 중단 약 30초) → `/v1/health` version `eb4829c`. 스모크: 상품·카테고리 200, 모르는 쿼리 필드 포함 200(버림), 무토큰 셀러 신청 401, 데모 로그인 200, Vercel 프록시 200. **흔적 질의: 악용 없음** — 승인 셀러 6건 전부 seller 역할 보유(Q1 0건), 승인 뒤 수정된 행 0건(Q3 0건, 전 행 `createdAt`=`updatedAt`), Q2 의 6건은 전부 시드(09-14)·체험 상점 픽스처(10-11)로 승인 API 를 거치지 않아 감사 로그가 없는 것이 정상. 함정: `ssh 'bash -s' < script` 로 돌리면 `docker compose run` 이 stdin 의 나머지 스크립트를 삼킨다 → `-T` 또는 scp 후 파일 실행 |
| 4 (코드 ✅, 배포 대기) | 먼저 `frontend/src/service/*.ts`·`ops-companion/src/lib/api.ts` 에서 호출 API 목록을 뽑아 **점검 대상 API 수(분모)** 를 확정한다. 그다음 시나리오 A~D 를 추가하고 D 전체 통과를 확인한 뒤 `forbidNonWhitelisted` 로 올린다. 시나리오 수는 목표가 아니라 분모에서 따라오는 값이다. | 2026-10-16: 분모 = `scripts/security/list-api-surface.mjs` 로 **클라이언트가 부르는 API 95개**(호출 지점 108곳, 백엔드 라우트 112개 중; 나머지 18개는 화면 밖 — 카테고리 관리·세션 목록·웹훅 등). 스펙 6개 44건: A 12(구매자 8·셀러 4) · B 6(관리자 37 + 셀러 전용 11 + 구매자 전용 12 라우트를 토큰별로 일괄) · C 14(셀러 신청 4 + 상품·리뷰·문의·프로필·주문·장바구니·답변·출고·찜 10) · D 12(쓰기 본문 11 + 목록 쿼리 19개). 기존 스펙이 덮는 A·B 항목은 각 스펙 머리말에 대응만 표시. 거절 모드 14스위트 102/102 ×2. 제 기대가 틀려 고친 것 3건(문의 초기 상태 `waiting`, 주문 초기 상태 `pending_payment`, 승인 상품 수정 → 재심사 pending 은 서버 규칙) — 결함 발견 0. |

### 운영 DB 악용 흔적 질의 (3단계 배포 직후, 수동)

경로마다 남는 자국이 다르다. 운영 셀러 행은 한 자릿수라 결과를 눈으로 다 본다.

```sql
-- ③ id 덮어쓰기 흔적: 승인 상태인데 사용자에게 seller 역할이 없다 (정상 승인은 역할 부여와 한 트랜잭션)
SELECT s.id, s.user_id, s."businessName", s."approvedAt", s."updatedAt"
FROM sellers s
WHERE s.status = 'approved'
  AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = s.user_id AND r.name = 'seller');

-- ① status 변조 흔적: 승인 상태인데 관리자 승인 감사 로그가 없다 (metadata 에 params.id 가 실린다)
SELECT s.id, s.user_id, s."approvedAt"
FROM sellers s
WHERE s.status = 'approved'
  AND NOT EXISTS (SELECT 1 FROM audit_logs a
                  WHERE a.action = 'SELLER_APPROVED' AND a.metadata->>'id' = s.id::text);

-- 공통: 승인 뒤에 행이 다시 수정됐다
SELECT id, user_id, "approvedAt", "updatedAt" FROM sellers
WHERE status = 'approved' AND "updatedAt" > "approvedAt" + interval '1 minute';
```

감사 로그가 도입되기 전에 승인된 셀러는 ① 질의에 잡히므로 `approvedAt` 과 감사 로그 도입 시점을 함께 본다.

## 5. 하지 않는 것과 이유

| 하지 않는 것 | 이유 |
| --- | --- |
| 프론트 코드 난독화, API 주소 숨기기 | 브라우저는 공격자가 통제하는 환경이다. 공격을 늦출 뿐 경계가 되지 못한다. Sentry 소스맵 기반 디버깅 비용도 커진다. |
| 브라우저에서 만드는 요청 서명 | 서명 키가 자바스크립트 안에 있어야 하므로 꺼내 갈 수 있다. |
| DevTools 감지, 마우스 움직임 기반 토큰 | 키보드와 스크린리더 사용자를 막는다. 접근성 작업(axe 위반 0)과 정면으로 충돌한다. |
| 무작위 변조(퍼징) | 이번에는 결정적인 시나리오만 쓴다. CI에서 실패했을 때 같은 입력으로 재현할 수 있어야 의미가 있다. |

## 6. 측정 항목

| 항목 | 수정 전 | 수정 후 |
| --- | --- | --- |
| 점검 대상 API 수 | 95 (클라이언트가 부르는 메서드+경로, 백엔드 라우트 112개 중 — `list-api-surface.mjs`) | 95 |
| 시나리오 수 (A / B / C / D) | 0 / 0 / 4 / 0 (2026-10-15, 셀러 신청만) | 12 / 6 (라우트 60개) / 14 / 12 (목록 쿼리 19개) = 44건 |
| 실패한 경계 시나리오 | 4 (결함 1건, 변조 경로 4개 — PR #74 CI 로그) | **0** (3단계 PR #75; 4단계 추가 40건도 로컬 0 실패 — 객체·역할 경계는 코드 검토대로 빈틈 없음 확정) |
| 정상 요청(D) 실패 | — | 0 (거절 모드에서 D 12건 + 기존 58건 통과) |
| CI `security-e2e` 실행 시간 | **2분 0초** (PR #73 첫 실행 — 설치 47s·빌드 9s·마이그레이션 1s·health 2s·e2e 본체 13s. 기존 `ci` job 2분 46초보다 짧다) | **2분 18초** (PR #75) |
| 기존 e2e 통과 | 58/58 (낡은 테스트 2건 갱신 후) | 58/58 (+ 보안 4) |
| 기존 단위 테스트 통과 | ○/○ (CI 로그) | 통과 (PR #75 `ci` job Test 스텝 20s, 셀러 단위 13/13) |
| 운영 DB 악용 흔적 | — | 없음 (2026-10-16 질의 3개) |

## 7. 이력서와 면접 메모

- **제목안:** 최근 AI 에이전트 해킹 사건을 계기로 화면 밖의 API 경계를 재점검 — 요청 변조 점검을 CI에 연결
- **원칙:**
  - 실측값만 쓴다.
  - "코드 검토로 찾음 → 재현 → 수정 → CI 상시 실행" 단계를 구분해서 쓴다.
  - 사건의 세부 수법은 인용하지 않는다.
  - **결함 1건, 변조 경로 4개**로 쓴다. "결함 4건" 은 부풀린 표현이다(같은 원인의 다른 입구).
  - "빈틈은 필드 경계 한 곳" 은 4단계 A·B 가 돈 뒤에만 쓴다. → 2026-10-16 A 12건·B 라우트 60개가 전부 거절·DB 불변으로 통과해 **이제 쓸 수 있다**(단, 분모 95개 기준이라는 조건을 붙인다).
  - 낡은 테스트 2건은 보안 발견이 아니라 **점검 공백의 증거**로 쓴다(사건 교훈 3 과 연결).
  - 숫자 중 무게가 실리는 것은 분모(점검 대상 API 수)와 심각도 설명(승인 셀러 행 탈취·정산 계좌 변경)이다. 시나리오 수를 목표로 늘리지 않는다.
- **예상 질문:**
  - "옵션 하나 켠 것 아닌가?" → 가치는 결함을 찾은 점검과 계속 도는 점검 체계에 있다. 원인을 필드 하나가 아니라 서버 전체에서 끊었기 때문에 수정이 짧다. 수정이 짧은 것은 원인을 정확히 찾았다는 증거이고, 방어는 파이프와 서비스 두 겹이다.
  - "매 PR 마다 돌리면 느리지 않나?" → §6 의 CI 실행 시간. 이 숫자는 그 질문을 위한 값이다.
  - "CI에서 테스트 데이터는 어떻게 격리했나?" → §4 표.
  - "단위 테스트가 있었는데 왜 못 잡았나?" → §2 재사용 감지 사례. 가짜 객체가 현실에서 불가능한 상태를 만들었다.

## 8. 후보 사례 (이번 범위 밖)

2026-10-15 점검에서 나온 나머지 후보다. 모두 코드 검토 단계이고 재현 전이다.

| 후보 | 핵심 | 위치 | 비고 |
| --- | --- | --- | --- |
| Refresh Token 재사용 감지 복구 | 감지 분기가 실행되지 않는다(§2). 고치면 다중 탭 동시 갱신이나 응답 유실 후 재시도 같은 정상 사용자 오탐을 따져야 한다. 탭 간 갱신은 이미 Web Locks 로 직렬화되어 있다. | `auth.service.ts:453-482`, `frontend/src/service/auth-session.ts:17` | 보완 ② 하네스 위에서 바로 이어 할 수 있다. 보안과 사용자 경험의 트레이드오프가 드러나는 사례다. |
| AI 어시스턴트 출력 경로 | 이미지는 막았지만 외부 링크는 클릭할 수 있다. 보이는 글자와 실제 주소가 달라도 구분할 수 없다. 리뷰·문의 본문에 심은 지시(간접 인젝션)를 다루는 평가 문항이 0건이다(골든셋 함정 5개 중 인젝션은 사용자 직접 입력 1개). | `MarkdownContent.tsx:16`, `backend/eval/golden-set.json` | LLM 출력은 외부 입력이라는 원칙으로 따로 세운다. 사건과 엮지 않는다. |
| 브라우저 경계 연쇄 | 상품 설명이 `dangerouslySetInnerHTML` 로 그려진다. 입력은 일반 textarea 이고 승인 화면은 설명을 보여 주지 않는다. 로그인 후 이동 경로 검사가 탭과 개행 문자를 거르지 않는다. BFF 로그인 라우트는 Origin 을 검사하지 않는다(로그인 CSRF). | `ProductTabs.tsx:64`, `LoginForm.tsx:20`, `app/api/auth/login/route.ts:8` | 프론트 비중이 가장 크다. 운영 CSP 의 `unsafe-inline` 때문에 CSP 가 막아 주지 못한다. |
| 손님 IP 복원과 분산 로그인 실패 탐지 | 웹 로그인의 IP당 제한이 Vercel 송신 IP에 걸린다(03-infra §10, 4b 미착수). 이메일당 잠금은 여러 계정을 조금씩 도는 시도를 보지 못한다. | `03-infra-nginx.md` §10 | IP 복원만으로는 IP를 바꿔 가며 하는 공격을 막지 못한다. 계정과 무관한 실패율 탐지가 다음 단계다. |
| 데모 관리자 개인정보 노출 | 공개 데모 관리자가 감사 로그의 IP·이메일, 주문 수령인·주소·전화, 셀러 신청자 연락처를 마스킹 없이 본다. | `admin/`, `audit/`, `seller.service.ts:66` | 마스킹은 AI 어시스턴트 도구 결과에만 있다. |
| 가드 거절 감사 기록 | 401·403 거절은 감사 인터셉터보다 앞에서 끝나서 기록되지 않는다. | `audit/interceptors/audit.interceptor.ts` | 운영 앱 푸시와 연결하면 "공격 시도 가시화"가 된다. |
| 의존성 자동 점검 | dependabot, audit 같은 자동 점검이 없다. | `.github/` | 공개된 취약점이 생겼을 때 대응 공백이 생긴다. |
| CSP 강화 | 운영 CSP 에 `unsafe-inline`, `unsafe-eval` 이 있다. | `frontend/next.config.js:96` | nonce 전환은 PortOne SDK 호환 확인이 필요하다. |
