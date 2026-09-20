# 다음 세션 프롬프트 — Ops Companion Phase 2

> 이 파일은 **다음 컨텍스트에 붙여 넣을 프롬프트**다. 아래 `---` 사이를 그대로 복사해 쓰면 된다.
> 작성: 2026-09-20 (Phase 1 종료 시점, `feat/ops-pager` = `f247aba`)
> Phase 2 가 끝나면 이 파일은 지운다.

---

# 작업: Ops Companion Phase 2 — 관측성 심화 + 보안 UX

## 먼저 읽어라 (이 순서로)
1. `CLAUDE.md` §5 의 "RN Ops Companion" 항목 — 지금 어디까지 됐는지
2. `docs/roadmap/ops-companion-design.md`
   - §9 **Phase 1 진행 표와 실기기 통과 기록** ← 직전 세션의 결과. 남은 DoD 1건이 여기 적혀 있다
   - §9 Phase 2 (이번 목표) · §6 Sentry 계측 계획(소스맵·Release Health·beforeSend·태그)
   - §4.3 S1 의 생체 인증 설명(**DB 변경 없음**이 핵심) · §5.3 의 생체 인증 주의 문단
   - §7 보안 원칙 · §10 작업 지침(배포 절차) · §11·§11-1 물려받은 전제
3. `docs/learning/ops-companion/02-push-and-deeplink.md` — 특히 **6장 함정 11건**(그대로 다시 밟지 마라)
   과 7장 실행·진단법. 1편은 필요할 때만 참조한다.
4. `ops-companion/README.md` — 실행·개발 빌드·FCM 절차

앱 코드와 백엔드 `ops` 모듈은 이미 있다. 새로 만들지 말고 지금 코드에서 출발하라.

## 현재 상태 (2026-09-20 기준)

**브랜치**: `feat/ops-pager` = `f247aba` (원격에 푸시됨, PR 미생성). main 은 `6352975`.
직전 세션에서 이 브랜치를 재사용하며 force-push 했다(옛 커밋 5개는 PR #31 squash 로 main 에 들어가 있다).

**Phase 1 결과**: DoD 사실상 통과. 실기기(안드로이드 개발 빌드 + 로컬 백엔드)에서
로그인 → 알림 권한 → 토큰 등록 → `푸시 발송: 이슈 1건 → 알림 1통` → **폰 수신 → 탭 → 인시던트 상세 진입** 확인.

**Phase 1 에서 남은 2건 — Phase 2 의 앞머리에서 처리한다**
1. **cold start 확인**(앱 완전 종료 후 알림 탭 → 상세 직행). 개발 빌드는 종료 후 재실행 때 PC 의
   Metro 에서 번들을 다시 받으므로 이 장면을 정직하게 찍을 수 없다. **preview 빌드**가 필요하고,
   preview 는 `eas.json` env 로 **운영 백엔드**를 가리키므로 **백엔드 운영 배포가 선행**이다.
2. **미로그인 pending deep link** 확인(로그아웃 상태에서 알림 탭 → 로그인 → 그 상세로 이동).
   코드는 `ops-companion/src/features/push/usePushRouting.ts` 에 있고 실기기 확인만 안 했다.

**운영 배포가 아직 안 됐다** — Phase 1 백엔드(상세 API·기기 등록·폴러·마이그레이션 3표)는 **로컬에만** 적용돼 있다.
운영 EC2 는 `f54ba5e` 이미지로 돌고 있어서 `/v1/ops/incidents/:id` 와 `/v1/ops/devices` 가 없다.
배포에는 **마이그레이션 실행이 포함**된다(`OpsPushTables1789877464959`).

**인프라 상태**
- 앱: EAS 프로젝트 `@ansmoon/ops-companion`, projectId `b8880be3-f41f-481e-86b1-fcbc8690a60f`.
  개발 빌드 APK 가 실기기에 설치돼 있다(빌드 `422363c5`). Firebase 프로젝트 `ops-companion`,
  FCM V1 서비스 계정 키는 expo.dev 에 업로드 완료(푸시 발송 성공이 증거).
- ⚠ 사용자가 expo.dev 의 Android identifier 를 한 번 삭제했다가 `eas credentials` 로 키스토어를 재생성했다.
  그래서 **다음에 만든 APK 는 기존 앱을 삭제한 뒤 설치해야 한다**(서명 불일치).
- 앱 `.env` 의 `EXPO_PUBLIC_API_BASE_URL` 이 **로컬 백엔드(`http://172.30.1.85:4000/v1`)** 를 가리킨다.
  운영 주소는 그 위에 주석으로 있다. 운영 확인 때 되돌려라.
- 로컬 백엔드가 4000 에 떠 있을 수 있다(로그: 임시 폴더의 `backend.log`). Metro 도 8081 에 떠 있을 수 있다.
- 로컬 DB 관리자 = `demo-admin@portfolio.local`(루트 `.env` 의 `DEMO_ADMIN_PASSWORD`).
  운영 DB 관리자 = `kirianir@naver.com`. **로컬과 운영은 별개 DB** — 운영 계정은 로컬에 없다.

## 이번 범위 (설계 §9 Phase 2)

- **소스맵 업로드** — 지금 인시던트 상세의 스택은 `chunks/5585-2589ad.js:1:55048` 처럼 압축된 좌표다.
  Hermes 소스맵을 Sentry 에 올려 원본 파일·줄로 복원되게 한다. EAS Build 와 연동해 자동화한다.
  ⚠ `@sentry/react-native` 의 Expo 플러그인이 `app.json` 에 org·project 설정이 없다고 경고 중이다
  (빌드 때마다 로그에 뜬다). 이것부터 채워야 소스맵 업로드가 성립한다.
- **Release Health** — 릴리즈 태깅 → crash-free sessions. S2 목록 화면 상단 요약 카드의 데이터 원천.
  카드는 Phase 0 에서 "실데이터가 생길 때 추가"로 미뤄 둔 것이다(설계 §4.3 S2).
- **beforeSend** — 노이즈 필터 + PII 마스킹. 쿼터 방어 장치다(앱과 쇼핑몰이 조직 공용 월 5,000건을 나눠 쓴다).
  쇼핑몰 프론트 리포터에 이미 넣은 중복 억제(60초 1건 + 탭당 10건)와 같은 취지다.
- **태그** — `screen`, `appVersion`, 로그인 사용자 id(마스킹 규칙 적용)
- **생체 인증** — 저장된 세션을 지문·얼굴로 잠금 해제. **서버·DB 와 무관하다**(설계 §4.3 S1):
  대조는 기기 보안 칩에서만 일어나고 앱은 true/false 만 받는다. "사용 여부" 설정은 기기 로컬에만 둔다.
  **DB 컬럼·테이블 추가 금지.**
- DoD: 프로덕션 빌드의 에러가 Sentry 에서 **원본 파일:라인**으로 복원되어 보인다.
  릴리즈별 crash-free 수치가 Sentry 대시보드와 앱 요약 카드 양쪽에 표시된다.

## 범위 밖
- Phase 3 이후 전부(AI 분석 화면, 평가 루프)
- Slack `#sentry-errors` 복구(설계 §3.3 💡 — 폴링 루프에 얹을 수 있다. 제안만 하라)
- iOS 빌드·스토어 배포(설계 §9 비목표)

## 진행 방식
- 사용자는 **RN 초보**다. 새 개념이 처음 나올 때 한 줄로 설명하라(예: 소스맵, 세션, 릴리즈).
  개념 질문에는 웹 Claude 처럼 자세히 답하고, 문서와 실제 코드를 짝지어 설명하라.
- 설계 §10-2 대로 **작게 나눠** 단계마다 사용자가 실기기로 확인하게 하라. 이전 단계 확인 없이
  다음 단계 코드를 쌓지 마라.
- 패키지는 `npx expo install` 로 설치한다(`npm install` 로 최신을 깔지 마라). 설치 뒤 `npx expo-doctor` 를 돌려라.
- DB 스키마는 마이그레이션으로만. `migrations/index.ts` 에 **명시 등록** 필수(CLAUDE.md §3).
  단, 이번 Phase 는 DB 변경이 없어야 정상이다(생체 인증은 서버와 무관).
- **커밋 전에 반드시 `git branch` 로 브랜치를 확인하라.** 직전 세션에서 사용자가 main 으로 옮겨 둔 것을
  모르고 main 에 직접 푸시한 사고가 있었다. 커밋 메시지 초안을 먼저 보여주고 승인을 받아라.
- ⚠ **main 에 푸시하면 Vercel 이 프론트를 자동 운영 배포한다.**
- 커밋 메시지는 `git commit -F <파일>` 로 넘겨라. Bash 도구에서 PowerShell here-string(`@'…'@`)을 쓰면
  메시지 앞에 `@` 가 붙는다(직전 세션에서 실제로 겪어 amend 했다).

## 운영 배포 (이번 Phase 앞머리에 필요)
반드시 사용자 승인을 받고 진행하라. 절차는 설계 §10-6 / `03-infra-nginx-runbook.md` §10:
로컬에서 이미지 2태그 빌드(`:latest` + `:<sha>`) → push → EC2 `pull` →
**마이그레이션 실행**(`docker compose -f docker-compose.prod.yaml run --rm backend node backend/dist/migrate.js`
— 기존 컨테이너 `exec` 가 아니다) → `up -d` → **`nginx -t && nginx -s reload`(빠뜨리면 502)** →
`/v1/health` 의 `version` 단언. 배포 후 `GET /v1/ops/incidents/:id` 200 과
`POST /v1/ops/devices` 201 을 실제로 확인하라.
운영 `.env` 에 푸시 관련 env 4개(`OPS_PUSH_ENABLED`·`OPS_PUSH_PROJECTS`·`OPS_PUSH_COOLDOWN_HOURS`·
`EXPO_ACCESS_TOKEN`)는 없어도 기본값으로 동작한다. 넣으려면 백업 후 추가하라.
⚠ 운영 배포 직후 폴러가 첫 주기에 커서를 심고(발송 없음) 그 다음 주기부터 발송한다.
운영 Sentry 에 error 이슈가 쌓여 있으면 커서가 심긴 이후 **새로 갱신된 것만** 울린다.

## 로컬 환경 함정 (메모리에도 있다)
- 백엔드 jest 는 Node 22 에서 `jest.config.ts` 파싱이 실패한다. 인라인 config 우회법은 메모리
  `backend_jest_local_run`. 프론트는 `nx test frontend --testPathPatterns=`(복수형), backend-e2e 는
  `--testPathPattern` 을 줘도 전 스위트가 돈다.
- 백엔드 eslint 는 Nx 그래프 때문에 로컬에서 20분 넘게 걸린다. 급하면 `tsc` 로 본다.
- `tsc -p backend/tsconfig.app.json` 에는 원래 있던 오류가 38줄 있다. 바뀐 파일만 걸러 보라.
- backend-e2e 는 서버를 띄우지 않는다. postgres·redis + `nx serve backend` 가 떠 있어야 한다.
  로그인은 IP 당 10회/5분 — 프로브를 반복하면 429 가 된다. ioredis 로 `rate:login:*`·`login:attempts:*`
  를 지우면 즉시 풀린다.
- `nx serve backend` 를 백그라운드로 띄울 때 `| tail` 파이프를 물리면 로그가 버퍼에 갇혀 에러를 못 본다.
  **파일로 리다이렉트**해라. node 만 죽이면 watch-server 가 되살려 서버 트리가 둘이 된다(4000 포트 싸움).
- Docker Desktop 데몬이 멈춰 있으면 프로세스를 강제 종료하고 다시 켠다.
- gh CLI 가 없다. GitHub Actions 상태는 공개 API 를 curl 로 조회한다.
- 앱 흰 화면은 번들러 고장을 먼저 의심하라(학습 노트 2편 6-9 · 7-4 의 curl 한 줄).

## Phase 가 끝나면
학습 노트 3편(`docs/learning/ops-companion/03-observability-and-biometrics.md` 예정)을
`docs/learning/ops-companion/README.md` 의 "이어 쓰는 규칙" 대로 쓰고 목차 표를 채운다.
설계 문서 §9 Phase 2 에 진행·통과 기록을 남긴다. `docs/roadmap/_next-session-phase2.md`(이 파일)는 삭제한다.

---
