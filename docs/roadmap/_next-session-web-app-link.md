# 작업: 웹 → 앱 연동 확인 페이지 ("내가 낸 에러가 앱에 뜬다")

> 2026-09-23 작성. 외부 배포(`feat/ops-public-demo`, preview APK versionCode 4)를 실기기로 돌려 본 사용자 관찰에서 나온 작업.
> **README 전면 갱신(`_next-session-readme.md`)보다 먼저 한다** — README 의 운영 앱 절에 "웹에서 에러를 내고 앱에서 확인해 보세요" 한 줄이 들어가야 하므로.

## 한 문장 목표

방문자가 **웹 관리자 페이지에서 버튼 한 번으로 실제 에러를 내고, 2분 안에 앱 인시던트 목록에서 자기 코드가 붙은 인시던트를 찾아 분석·채점까지 돌려 본 뒤 자기 판정을 다시 보게** 한다. DB 변경 0, 새 비밀값 0, 네이티브 변경 0(앱은 `eas update`).

## 왜 (사용자 관찰, 2026-09-23)

> "내용이나 볼륨은 좋은데 막상 실제 웹에서 에러를 발생할 방법을 사용자가 모르니까 웹과 앱이 연동이 되어있는지를 판단할 재료가 없었다. 오히려 내가 mock 데이터를 삽입하여 보여주기 식으로만 만든건가? 라는 생각조차 들 정도였다."

이 앱의 차별점은 "운영 데이터 → AI 분석 → 사람 채점"의 순환 고리인데, 첫 고리 **"실제 장애가 들어온다"가 안 믿기면 나머지도 흔들린다.** README 는 글로 주장하는 것이고 이 기능은 방문자가 스스로 확인하는 것이다 — 후자가 훨씬 강하다.

## 현재 상태 (코드로 확인한 사실)

- 웹에는 에러를 일부러 내는 버튼이 **없다**(`frontend/src` 의 `captureException` 은 `global-error.tsx` 와 `lib/axios/report-api-error.ts` 뿐).
- 앱 프로필의 "Sentry 테스트 에러 보내기"(`ops-companion/src/lib/sentry.ts:200`)는 **앱 자신의 Sentry 프로젝트**로 간다 — 인시던트 목록(쇼핑몰 프론트·백엔드 프로젝트)에는 안 뜬다.
- S4 의 "내 판정"은 **백엔드가 이미 만든다**: `OpsReviewService.summarizeReviews`(`backend/src/ops/ops-review.service.ts:427`) 가 `mine` 을 데모 계정에도 채운다. 그런데 앱 `ops-companion/src/features/analysis/ReviewSummaryCard.tsx:14` 가 `summary.reviews === 0` 이면 카드를 통째로 숨긴다 — 비데모 채점이 0건인 새 인시던트에서는 방문자 자신의 판정이 안 보인다. **앱 한 줄 수정**이 이 작업의 "고리 닫기".
- 푸시 폴러 `OpsPollerService.isPushTarget`(`backend/src/ops/ops-poller.service.ts:131`)는 레벨·프로젝트·커서만 본다 — 방문자 테스트 에러가 관리자 폰에 그대로 푸시된다.
- 목록은 `OpsService.getIncidents` → `SentryApiClient.listIssues(period)`(query 미지정 = Sentry 기본 `is:unresolved`). 데모 14d, 관리자 24h, Redis 캐시 60s.
- 웹 데모 로그인("관리자 페이지 체험하기", `LoginForm.tsx:142`)은 앱과 **같은 데모 관리자 계정**이라 관리자 메뉴에 들어갈 수 있다. 운영 데모 로그인은 켜져 있음(2026-09-23 확인, `X-Client: mobile` 200 + refreshToken).
- 관리자 메뉴 항목은 `frontend/src/app/(admin)/admin/components/AdminSidebar.tsx:7-14` 의 `NAV_ITEMS` 배열.

## 결정 (추천 1개로 진행 — 위임 원칙)

| # | 결정 | 이유 |
|---|---|---|
| 1 | **에러는 브라우저에서 진짜로 낸다** — 백엔드 "테스트 에러 API" 없음. 페이지의 이름 있는 함수에서 `new Error(...)` 를 만들고 `Sentry.captureException` 으로 프론트 Sentry 프로젝트에 보낸다(throw 해서 `global-error` 화면을 띄우지 않는다) | 실제 장애와 같은 길(프론트 프로젝트 → 소스맵 → 앱이 `frontend/src/...` 프레임을 읽음). AI 분석 v3.1 이 이 페이지 소스를 읽고 "의도된 테스트 에러"라고 답하는 장면까지 이어진다 |
| 2 | **제목 = `[방문자 테스트 A7K2] 웹→앱 연동 확인용 에러`** + `fingerprint: ['portfolio-visitor-test', code]` + `tags: { visitor_test: 'true' }` | Sentry 는 같은 에러를 한 이슈로 묶는다 → 코드를 fingerprint 에 넣어 **방문자마다 이슈 하나**. 방문자가 고른 값이 다른 시스템(앱)에 나타나는 것이 가장 단순한 "진짜" 증거. 코드 4자, 혼동 문자(0/O/1/I) 제외 |
| 3 | **"같은 에러를 다시 보내서 평가 확인"은 하지 않는다** | 두 번 보내도 새 인시던트가 생기지 않는다(이벤트 수만 증가). 채점 뒤 같은 인시던트를 다시 열면 S4 가 `mine` 을 보여준다(위 앱 한 줄 수정 후) |
| 4 | **푸시 폴러는 접두어 `[방문자 테스트` 로 시작하는 이슈를 건너뛴다**. Slack `#sentry-errors` 는 Sentry 알림 규칙에 제목 필터(사용자 콘솔 작업) | 방문자가 누를 때마다 사용자 폰과 Slack 에 장애 알림이 가면 안 된다. 폴러는 목록 API 의 `title` 로 판단(태그는 목록 응답에 없음). 접두어 상수는 `@shopping-mall/shared` 에 하나(`OPS_VISITOR_TEST_PREFIX`) — 프론트·백엔드가 같은 문자열 |
| 5 | **분석·채점은 데모 규칙 그대로**(새 분석 시간당 6건, 채점 저장되나 집계 제외) | 이미 있는 벽으로 충분. 방문자 이슈는 14일 뒤 데모 목록에서 자연히 빠진다. Sentry 이슈 자체는 프로젝트 설정 auto-resolve(사용자 콘솔) 로 정리 |
| 6 | **쿨다운 브라우저당 60초**(localStorage) | 연타로 이슈를 양산하지 않게. 서버 측 상한은 두지 않는다(Sentry 무료 쿼터 5k 이벤트/월, 이슈 하나당 이벤트 1건) |
| 7 | **"진짜"의 두 번째 증거 = 앱 상세의 첫 발생 시각** | 버튼을 누른 시각(KST)을 페이지에 남겨 "앱 상세의 첫 발생 시각과 같다"를 안내. 미리 심은 데이터로는 못 만드는 값. 응답에 이미 있는 필드라 추가 작업 없음 |
| 8 | **(2차 검토에서 추가) 페이지는 "테스트 페이지"가 아니라 "운영 앱" 소개 페이지** — 라우트 `/admin/ops-app`, 메뉴 라벨 "운영 앱". 구성 = 앱이 무엇인지 한 단락 → 설치(링크·QR·데모 계정) → **연동 확인**(버튼 + 아래 ⑨ 추적기 + ⑩ 딥링크) → 앱에서 할 일 | "앱 연동 테스트" 라는 이름은 데모 하네스처럼 읽힌다. 운영 앱의 웹 쪽 입구로 두면 자연스럽고, 테스트 버튼은 그 안의 한 절이 된다 |
| 9 | **(추가) 버튼 아래 진행 추적기** — 보냄 ✓ → Sentry 수집 → **앱 목록에 노출 ✓**. 웹이 **앱과 같은 엔드포인트 `GET /v1/ops/incidents`** 를 20초마다 최대 3분 폴링해, 제목에 내 코드가 있는 항목이 나타나면 ✓ + 첫 발생 시각을 보여준다 | "2분 뒤 앱을 새로고침해 보세요"는 기다리는 동안 불안하다. 웹이 앱과 같은 데이터를 읽는다는 것 자체가 연동의 증거이고, 방문자는 확인된 뒤 앱을 열면 된다. 데모 계정도 이 엔드포인트를 이미 쓴다(14d). 캐시가 60s 라 20초보다 자주 물을 이유가 없다. 기존 `authClient` 로 한 줄 호출 |
| 10 | **(추가) 노출 확인 뒤 "앱에서 열기" 딥링크 버튼** — `opscompanion://incidents/<issueId>`(앱 `scheme: opscompanion`, 푸시가 쓰는 경로 `/incidents/<id>` 와 동일). 폰 브라우저에서 누르면 설치된 앱이 그 인시던트로 바로 열린다. PC 에서는 "폰에서 이 페이지를 열면 앱으로 바로 이동" 안내 | 웹 → 앱 손끝 이동이 "실제 서비스"의 감각을 만든다. `<a href>` 하나. Expo Router 가 `(tabs)` 그룹을 건너뛰고 `/incidents/<id>` 로 매핑하는지 **실기기 확인 필요**(안 되면 `opscompanion://(tabs)/incidents/<id>` 또는 링크 생략) |

**검토에서 버린 안**: ① 실제 상점 화면을 세션 단위로 고장 내는 "카오스 플래그"(axios 인터셉터에 방문자 코드로 응답을 깨는 훅) — 프로브가 한 일을 방문자 손으로 재현하는 셈이라 "진짜 장애"에 가장 가깝지만, 운영 상점 코드에 고장 스위치를 심는 것이 포트폴리오에서 더 큰 흠이고 방문자에게는 ①과 차이가 안 보인다. ② 관리자 대시보드에 인시던트·분석·채점 위젯(앱 → 웹 역방향) — 좋지만 이번 범위 밖, 이력서 뒤 후보. ③ 백엔드 "테스트 에러 API" — 프론트 프로젝트 소스맵 경로를 안 탄다.

## 구현 체크리스트 (이 순서)

### A. shared — 상수 1개
- `shared/src/lib/…` 에 `OPS_VISITOR_TEST_PREFIX = '[방문자 테스트'` 와 `buildVisitorTestTitle(code)` 를 export. **`nx build shared` 후 소비**(CLAUDE.md §2).

### B. 백엔드 — 폴러 필터 (+ 단위 테스트)
- `ops-poller.service.ts isPushTarget`: `issue.title.startsWith(OPS_VISITOR_TEST_PREFIX)` → false. 파일 상단 데모 규칙 주석 표(`ops.controller.ts:29` 근처)에도 한 줄.
- `ops-poller.service.spec.ts`: 접두어 이슈는 `notify` 대상에서 빠진다 1건. 로컬 jest 는 메모리 `backend_jest_local_run`(인라인 config + `jest/bin/jest.js`).
- 목록·상세·분석은 손대지 않는다(방문자 이슈가 **보여야** 한다).

### C. 프론트 — 페이지 + 메뉴
- `frontend/src/app/(admin)/admin/ops-app/page.tsx`(클라이언트 컴포넌트) + `AdminSidebar.tsx NAV_ITEMS` 에 `{ href: '/admin/ops-app', label: '운영 앱' }`(감사 로그 아래).
- 페이지 구성(위에서 아래로):
  1. 한 단락: 운영 앱(Ops Companion)이 무엇인지 + 이 페이지에서 실제 Sentry 연동을 직접 확인할 수 있다는 것.
  2. **앱 설치**: 링크 + QR(링크는 세션 시작 시 `ops-companion/README.md` "설치해서 써 보기" 절에서 읽는다 — 빌드마다 바뀜) + "데모 계정으로 체험하기" 안내. QR 은 외부 라이브러리 없이 `https://api.qrserver.com` 같은 외부 이미지 대신 **정적 PNG 를 `public/` 에 두거나 링크만** — 외부 도메인 이미지는 CSP(`img-src`) 확인 필요.
  3. **테스트 에러 보내기** 버튼: 누르면 코드 생성 → `Sentry.withScope(scope => { scope.setFingerprint([...]); scope.setTag('visitor_test','true'); scope.setLevel('error'); Sentry.captureException(err) })` → 화면에 코드·보낸 시각(KST)·"약 2분 뒤 앱 목록을 당겨 새로고침" 안내. 60초 쿨다운. 에러 객체는 `function raiseVisitorTestError(code)` 처럼 **이름 있는 함수**에서 만들어 스택 최상단 프레임이 이 파일이 되게.
  4. **진행 추적기**(결정 ⑨): 버튼 직후 3단계 표시(보냄 ✓ / Sentry 수집 중… / 앱 목록 노출). `authClient.get('/ops/incidents')` 를 20초 간격으로 최대 3분(9회) — 응답 `items[].title` 에 내 코드가 포함된 항목이 있으면 3단계 ✓ + `firstSeen`(KST) 표시, 3분 지나면 "아직 안 보이면 앱에서 당겨서 새로고침" 안내. 응답 타입은 `@shopping-mall/shared` 의 `IncidentSummary` 재사용. 페이지를 떠나면 폴링 중단(cleanup).
  5. **앱에서 열기**(결정 ⑩): 노출 확인 후 `<a href={`opscompanion://incidents/${id}`}>` 버튼. `navigator.userAgent` 로 모바일이 아니면 버튼 대신 "폰에서 이 페이지를 열면 앱으로 바로 이동합니다" 한 줄.
  6. **앱에서 할 일** 4단계: 목록에서 `[방문자 테스트 XXXX]` 찾기(또는 위 버튼으로 바로) → 상세의 첫 발생 시각 비교 → AI 분석(새 분석은 시간당 6건, 방문자 합산 — 한도면 이미 분석된 다른 인시던트로) → 평가 탭에서 채점 → 분석 화면에서 "내 판정" 확인.
- `DemoAccountGuard` 대상 아님(백엔드 호출이 없다). `AdminGuard` 는 layout 이 이미 건다.
- Sentry DSN 이 없는 로컬(`NEXT_PUBLIC_SENTRY_DSN` 미설정)에서는 `captureException` 이 no-op — 페이지에 "이 환경은 Sentry 가 꺼져 있습니다" 를 `Sentry.getClient()` 유무로 표시.

### D. 앱 — 한 줄 + EAS Update
- `ReviewSummaryCard.tsx:14`: `if (!summary || (summary.reviews === 0 && !summary.mine)) return null;` + reviews 0·mine 있음일 때 문구("사람 채점 · 아직 없음 — 내 판정: …").
- S4 안내 문구는 그대로. `yarn typecheck` → 머지·백엔드 배포 후 `cd ops-companion && eas update --channel preview --message "S4 내 판정 표시"`(JS 만 바뀜, 재빌드 없음).

### E. 문서
- `ops-companion/README.md` "설치해서 써 보기" 에 0단계 "웹에서 에러 내기: 웹 로그인 → 관리자 페이지 체험하기 → 앱 연동 테스트" + 표에 "방문자 테스트 이슈" 행.
- 설계 `docs/roadmap/ops-companion-design.md` §9 "웹 → 앱 연동 확인" 절의 ⏳ → ✅ + 실측(버튼→앱 표시까지 걸린 시간).
- `docs/learning/ops-companion/appendix-public-demo.md` 에 절 하나(왜 백엔드 API 가 아니라 브라우저에서 던지는가 · fingerprint · 폴러 필터).
- CLAUDE.md §5 외부 배포 줄에 한 문장. `_next-session-readme.md` 의 Ops Companion 절 제안에 "웹에서 에러 내기" 한 줄 추가.

### F. 사용자 콘솔 작업 (코드로 못 함 — 세션 끝에 한 번에 요청)
- Sentry 알림 규칙(Slack `#sentry-errors`): 조건에 "issue title does not contain `[방문자 테스트`".
- Sentry 프론트 프로젝트 설정 → Auto Resolve: 14 days(방문자 이슈 정리).
- 배포: 백엔드 이미지 2태그 빌드 → push → EC2 pull/up/reload → health 버전(SSH 는 auto 모드에서 차단 — 명령을 적어 준다). main 머지 = Vercel 자동 배포. 그 다음 `eas update`.

## DoD (운영에서 확인)

1. 운영 웹 → 데모 로그인 → 운영 앱 페이지 → 버튼 → 웹 추적기가 **3분 이내** "앱 목록 노출 ✓" + 첫 발생 시각 표시 → 앱(데모 계정) 목록에도 `[방문자 테스트 XXXX]` 표시, 상세의 첫 발생 시각 = 버튼 시각. 폰에서 "앱에서 열기"를 누르면 앱이 그 인시던트 상세로 열린다(딥링크 매핑 실기기 확인 — 안 되면 결정 ⑩ 대안).
2. 그 인시던트 AI 분석 → v3.1 이 `frontend/src/app/(admin)/admin/app-test/page.tsx` 를 읽는다(**전제: 머지 + Vercel 배포로 release 커밋에 그 파일이 있어야** 소스 리더가 GitHub raw 에서 읽는다. 배포 전 커밋을 읽으면 404 → `{ok:false}`).
3. 평가 탭에서 채점 → S4 에 "내 판정" 표시(비데모 채점 0건인데도).
4. 폴러 단위 테스트 통과 · 사용자 폰에 푸시 없음 · Slack 알림 없음(규칙 적용 후).
5. 관리자 계정 24h 목록에도 보임(허용 — 관리자는 무엇이 들어왔는지 알아야 한다).

## 함정 / 유의

- **Sentry 수집 지연 + 캐시 60s** → 안내는 "최대 2분". 앱은 당겨서 새로고침해야 캐시 만료 후 재조회.
- 로컬 디스크: C 드라이브 여유 ~9.7GB, Docker VHDX 는 자동 축소 안 됨 → 이미지 빌드 전 `docker system df` + `docker builder prune -a -f`. 엔진이 500/파이프 오류면 PowerShell `Stop-Process` 로 docker 프로세스 0개까지 → 재실행(메모리 `ops_companion_track`).
- `yarn nx serve backend` 는 옛 `dist/main.js` 로 먼저 뜬다(메모리 `ops_public_demo` 함정 ①) — e2e 전 4000 PID 생성 시각 vs 번들 mtime.
- 병렬 Bash 는 cwd 공유 — 절대경로. 긴 한글 문서는 Write 도구.
- 프론트 `instrumentation-client.ts` 에 `beforeSend` 없음 — 테스트 이벤트가 걸러질 일은 없다. 다만 `tracesSampleRate` 는 무관(에러 이벤트는 100%).
- `[방문자 테스트` 접두어를 바꾸면 폴러 필터·Sentry 알림 규칙·README 셋을 같이 바꾼다 — 상수 하나로 묶은 이유.

## 범위 밖

- 서버 측 "테스트 에러 API" · 방문자별 세션 분리 · iOS · 웹에서 분석 결과 보기(앱의 몫) · 채점 집계 규칙 변경(데모 제외 유지).

---

## 다음 세션 시작 프롬프트 (복사해서 붙여넣기)

```
docs/roadmap/_next-session-web-app-link.md 를 읽고 그대로 진행해 줘.

목표: 웹 관리자 메뉴에 "운영 앱" 페이지(/admin/ops-app)를 만들어, 방문자가 버튼 한 번으로 실제 에러를 내고 → 웹 추적기가 앱과 같은 엔드포인트로 "앱 목록 노출 ✓"를 보여주고 → "앱에서 열기" 딥링크로 앱의 그 인시던트로 이동해 분석·채점한 뒤 "내 판정"까지 보게 한다.

진행 규칙:
- 브랜치 `feat/ops-web-app-link` 를 main 에서 만든다(feat/ops-public-demo 가 아직 안 머지됐으면 그 위에서). `.yarn/install-state.gz`·`PR_DRAFT.md` 는 커밋하지 않는다.
- 문서의 "결정" 표는 확정이다 — 다시 묻지 말고 구현한다. 구현 순서는 "구현 체크리스트" A→E.
- 파일·라인은 문서에 적힌 것을 먼저 열어 사실을 확인하고 시작한다(라인 번호는 2026-09-23 기준).
- 검증: 백엔드 폴러 단위 테스트 1건 추가·통과, 프론트 tsc, 앱 typecheck. 로컬 jest 우회법은 메모리 `backend_jest_local_run`.
- 끝나면: PR_DRAFT.md 갱신(제목·요약·검증·배포), 사용자 콘솔 작업(F 절)과 EC2 배포 명령을 한 번에 정리해서 알려 준다. docker push 는 시도해 보고, SSH 배포는 명령만 적는다.
- 답변은 한국어.
```
